import type { ATPData, TPData, ATPUnitMappingData, Step07AutoRequest, Step07AutoRepairRun, Step07SemanticCheck, Step07RepairProgress } from '../types';
import type { MappingAnalysisResult } from './aiService';
import { applyMinimalAlignment, isMappingActionAutomatic, suggestMappingCopyedit, recordMappingBatch, type AlignmentAction } from './mappingAlignmentService';
import { computeStep07VerifiedFingerprint, computeMappingFingerprint } from './atpMappingActionApplyService';
import { validateATPUnitMappingCanonical } from './atpUnitMappingValidationService';
import { resolveATPUnitMappingReadiness } from './atpMappingReadinessService';
import { step07SourceKey, step07PersistedKey, validateStep07AutoExecution,normalizeStep07SourceEvidence,normalizeStep07VerificationSources,classifyStep07Failure,step07RepairProposalKey,type Step07RepairAttemptState } from './step07AutoExecutionPolicy';
import { getMappingAtpTpIds } from './atpMappingLineageService';
import { runHybridStep07Repair } from './step07HybridRepairService';
import type { Step07CheckpointContext,Step07Stage,Step07WorkStatus } from './step07CheckpointService';
import type { ATPUnitMappingValidationResult } from './atpUnitMappingValidationService';
import type { MappingReadiness } from './atpMappingReadinessService';
import {recordStep07Diagnostic,type Step07DiagnosticScope} from './step07DiagnosticsService';

export interface Step07RepairOptions {
  diagnosticContext?:Step07DiagnosticScope;
  checkpointContext?:Step07CheckpointContext;
  activeUnitId?:string;
  isolatedActions?:boolean;
  saveInitialProgress?:boolean;
  baselineUnits?:ATPUnitMappingData['units'];
  baselineIssueIds?:string[];
  repairState?:Step07RepairAttemptState;
  globalReconciliationOnly?:boolean;
  onWork?:(state:Step07WorkStatus)=>void;
  onCheckpoint?:(stage:Step07Stage,data:{mapping:ATPUnitMappingData;analysis?:MappingAnalysisResult;checks?:Step07SemanticCheck[];action?:AlignmentAction;actionId?:string;issues?:string[];success:boolean})=>void;
  mapping:ATPUnitMappingData; atp:ATPData; tp:TPData; persistedMapping?:ATPUnitMappingData;
  analyze:(mapping:ATPUnitMappingData,request:Step07AutoRequest,signal:AbortSignal)=>Promise<MappingAnalysisResult>;
  save:(mapping:ATPUnitMappingData)=>boolean;
  persist?:(mapping:ATPUnitMappingData)=>Promise<boolean>;
  isCurrent:()=>boolean;
  onStatus?:(status:'Menganalisis'|'Memperbaiki'|'Memvalidasi'|'Selesai')=>void;
  onProgress?:(progress:Step07RepairProgress)=>void;
  maxRequests?:number; maxInputCharacters?:number; maxResponseCharacters?:number;
  timeoutMs?:number; callTimeoutMs?:number;
}
export interface Step07RepairResult {
  mapping:ATPUnitMappingData;analysis?:MappingAnalysisResult;validation:ATPUnitMappingValidationResult;readiness:MappingReadiness;progress:Step07RepairProgress;
  outcome:Step07AutoRepairRun['outcome'];saved:boolean;persisted:boolean;stale:boolean;rounds:number;issues:string[];appliedActions:string[];
}
export const step07VerificationKey=computeStep07VerifiedFingerprint;
const readinessOf=(mapping:ATPUnitMappingData,options:Step07RepairOptions)=>resolveATPUnitMappingReadiness(mapping,options.atp,options.tp,undefined,{evaluateRepair:true});
function focusFor(mapping:ATPUnitMappingData,options:Step07RepairOptions,readiness:ReturnType<typeof readinessOf>,first:boolean):Step07AutoRequest['focus'] {
  const issues=readiness.repairIssues || [];
  return first?{unitIds:mapping.units.map(u=>u.id),materialIds:mapping.units.flatMap(u=>u.materials.map(m=>m.id)),tpIds:options.tp.items.map(t=>t.id),atpIds:options.atp.items.map(a=>a.id)}:
    {unitIds:[...new Set(issues.flatMap(i=>i.unitId?[i.unitId]:[]))],materialIds:[...new Set(issues.flatMap(i=>i.materialId?[i.materialId]:[]))],tpIds:[...new Set(issues.flatMap(i=>i.tpIds || []))],atpIds:[...new Set(issues.flatMap(i=>i.atpIds || []))]};
}
const inFocus=(action:AlignmentAction,focus:Step07AutoRequest['focus'],round:number)=>round===1||focus.unitIds.includes(action.targetUnitId)||focus.unitIds.includes(action.sourceUnitId || '')||focus.materialIds.includes(action.targetMaterialId || '')||action.linkedTpIds.some(id=>focus.tpIds.includes(id));

/** Readiness-driven orchestration; resource guards checkpoint only validated safe progress. */
export async function runStep07AutoRepair(options:Step07RepairOptions):Promise<Step07RepairResult> {
  if(options.checkpointContext)return runHybridStep07Repair(options,child=>runStep07AutoRepair({...child,checkpointContext:undefined}));
  const initial=structuredClone(options.mapping),canonicalKey=JSON.stringify({atp:options.atp,tp:options.tp});
  const previous=initial.step07AutoRepair;
  const continuing=!!previous&&!previous.undone&&previous.outcome!=='COMPLETE'&&previous.resultFingerprint===computeMappingFingerprint(initial.units,options.atp,options.tp);
  const beforeUnits=structuredClone(options.baselineUnits || (continuing?previous!.beforeUnits:initial.units));
  let current=structuredClone(initial),analysis:MappingAnalysisResult|undefined,rounds=0,saved=false,persisted=false,requests=0,inputCharacters=0;
  let readiness=readinessOf(current,options),repeatedIssues=0;
  const initialIssueIds=options.baselineIssueIds || (continuing&&previous!.initialIssueIds?.length?[...previous!.initialIssueIds]:[...new Set((readiness.repairIssues || []).map(i=>i.id))]);
  let progress:Step07RepairProgress;
  const reportProgress=()=>{
    const remaining=new Set((readiness.repairIssues || []).map(i=>i.id));
    progress={initial:initialIssueIds.length,resolved:initialIssueIds.filter(id=>!remaining.has(id)).length,remaining:remaining.size};
    options.onProgress?.({...progress});
  };
  reportProgress();
  const seenStates=new Set([computeMappingFingerprint(current.units,options.atp,options.tp)]);
  let outcome:Step07AutoRepairRun['outcome']='INCOMPLETE';
  const diagnosticScope=options.diagnosticContext || {yearPlanId:initial.academicSettingId};
  const issues:string[]=[],appliedActions:string[]=[];
  let executionStage:Step07Stage='ANALYZE';
  const deadline=Date.now()+Math.max(1,Math.min(options.timeoutMs ?? 120000,120000));
  // Request/input/output ceilings are cost proxies, not a fixed iteration limit.
  // A deliberate continuation starts a fresh bounded budget on the stored draft.
  const maxRequests=Math.max(1,Math.min(60,Math.floor(options.maxRequests ?? 24)));
  const maxInputCharacters=Math.max(1,Math.min(4000000,options.maxInputCharacters ?? 2000000));
  const maxResponseCharacters=Math.max(1,Math.min(500000,options.maxResponseCharacters ?? 300000));
  const fresh=()=>options.isCurrent()&&canonicalKey===JSON.stringify({atp:options.atp,tp:options.tp});
  const failure=(phase:Step07Stage,actionId:string,reasons:string[])=>{
    for(const reason of reasons){const category=classifyStep07Failure(reason);recordStep07Diagnostic(diagnosticScope,{kind:'ACTION_FAILURE',phase,unitId:options.activeUnitId || 'GLOBAL',category,reason:`action=${actionId}; ${reason}`,success:false});
      if(options.repairState&&!options.repairState.failures.some(f=>f.actionId===actionId&&f.reason===reason&&f.phase===phase))options.repairState.failures.push({actionId,category,reason,phase});}
  };
  async function analyze(request:Step07AutoRequest) {
    if(!fresh())throw new Error('STEP07_STALE: data manual/konteks berubah; hasil tidak diterapkan.');
    if(Date.now()>=deadline)throw new Error('STEP07_TIMEOUT: batas waktu total terlampaui.');
    // Snapshot/CAS/progress metadata is local execution state, not pedagogical input.
    const aiMapping={...current,step07AutoRepair:undefined};
    const size=JSON.stringify({mapping:aiMapping,atp:options.atp,tp:options.tp,request}).length;
    if(requests>=maxRequests||inputCharacters+size>maxInputCharacters)throw new Error('STEP07_BUDGET_LIMIT: anggaran permintaan/ukuran input tercapai. Lanjutkan Perbaikan untuk meneruskan progres aman.');
    requests++;inputCharacters+=size;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const result=await Promise.race([options.analyze(structuredClone(aiMapping),request,controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('STEP07_TIMEOUT: batas waktu analisis terlampaui.'));},Math.max(1,Math.min(options.callTimeoutMs ?? 30000,deadline-Date.now())));})]);
      if(JSON.stringify(result).length>maxResponseCharacters)throw new Error('STEP07_BUDGET_LIMIT: respons AI melampaui batas ukuran; respons tidak diterapkan.');
      return result;
    }
    finally{if(timer)clearTimeout(timer);}
  }
  try {
    for(let round=1;;round++){
      rounds=round;if(Date.now()>=deadline)throw new Error('STEP07_TIMEOUT: batas waktu total terlampaui.');
      readiness=readinessOf(current,options);reportProgress();
      if(readiness.canProceed){outcome='COMPLETE';break;}
      if(options.activeUnitId&&!(readiness.repairIssues || []).some(issue=>issue.unitId===options.activeUnitId))break;
      const repair=options.repairState;
      if(repair){
        const sourceKey=step07SourceKey(options.activeUnitId?current.units.filter(u=>u.id===options.activeUnitId):current.units,options.atp,options.tp);
        if(repair.sourceKey!==sourceKey)Object.assign(repair,{sourceKey,attempts:0,seen:[],failures:[],status:undefined});
        if(repair.status==='NEEDS_TEACHER_REVIEW'||repair.attempts>=2){outcome='NEEDS_TEACHER_REVIEW';repair.status=outcome;issues.push('NEEDS_TEACHER_REVIEW: batas perbaikan aman pada sumber yang sama tercapai; ubah draft/sumber berdasarkan tinjauan guru sebelum mencoba lagi.');break;}
      }
      const before=readiness.validationResult!,beforeIssues=new Set((readiness.repairIssues || []).map(i=>i.id));
      const focus=focusFor(current,options,readiness,round===1&&!continuing);
      if(options.activeUnitId){focus.unitIds=[options.activeUnitId];focus.materialIds=current.units.find(u=>u.id===options.activeUnitId)?.materials.map(m=>m.id) || [];}
      const validation={canProceed:readiness.canProceed,issues:readiness.repairIssues || [],rejectedActions:[...new Set(issues)]};
      const repairRequest=repair?{attempt:repair.attempts+1,strategy:(repair.failures.some(f=>f.category==='SEMANTIC_MISMATCH')?'REVISE_MATERIAL':repair.failures.some(f=>f.category==='STRUCTURAL_CONFLICT')?'CORRECT_STRUCTURE':repair.failures.some(f=>f.category==='EVIDENCE_INVALID')?'CHECK_EVIDENCE':'TARGET_REMAINING') as NonNullable<Step07AutoRequest['repair']>['strategy'],failures:repair.failures,rejectedFingerprints:repair.seen}:undefined;
      options.onStatus?.('Menganalisis');
      executionStage='PROPOSE';
      analysis=await analyze({scope:'STEP07_AUTO_REPAIR',phase:'PROPOSE',round,focus,validation,repair:repairRequest});
      options.onCheckpoint?.('PROPOSE',{mapping:current,analysis,success:true});
      const proposalKey=step07RepairProposalKey(analysis);
      if(repair&&repair.seen.includes(proposalKey)){outcome='NEEDS_TEACHER_REVIEW';repair.status=outcome;failure('PROPOSE','proposal-set',['NO_PROGRESS: proposal identik mengulang tindakan ditolak tanpa perubahan sumber atau solusi.']);issues.push('NEEDS_TEACHER_REVIEW: proposal identik; verifikasi/apply tidak diulang.');break;}
      if(analysis.analysisNotice)issues.push(analysis.analysisNotice);
      for(const proposal of (analysis.alignmentProposals || []).slice(0,200).filter(p=>p.validationStatus==='REJECTED'))issues.push(...(proposal.validationIssues?.length?proposal.validationIssues:[proposal.reason]));
      for(const proposal of (analysis.alignmentProposals || []).slice(0,200)){
        if(proposal.validationStatus==='REJECTED'){const reasons=proposal.validationIssues?.length?proposal.validationIssues:[proposal.reason];failure('PROPOSE',proposal.actionId || proposal.id,reasons);options.onCheckpoint?.('PROPOSE',{mapping:current,actionId:proposal.actionId || proposal.id,issues:reasons,success:false});}
        if(proposal.sourceEvidenceRepairs?.length)recordStep07Diagnostic(diagnosticScope,{kind:'EVIDENCE_NORMALIZED',phase:'PROPOSE',unitId:proposal.targetUnitId,reason:`action=${proposal.actionId || proposal.id}; ${proposal.sourceEvidenceRepairs.join('; ')}`,success:true});
      }
      if(!fresh())throw new Error('STEP07_STALE: perubahan manual/konteks dipertahankan.');
      const materialGaps=new Set((readiness.repairIssues || []).flatMap(g=>g.materialId?[g.materialId]:[]));
      const candidates=(analysis.alignmentProposals || []).slice(0,200).filter(p=>p.validationStatus==='READY'&&p.action).map(p=>p.action!).filter(action=>{
        if(options.globalReconciliationOnly&&(!action.sourceUnitId||action.sourceUnitId===action.targetUnitId)){const reasons=['STRUCTURAL_CONFLICT: GLOBAL tidak memperbaiki ulang tindakan lokal; tinjau Bab terkait.'];failure('FILTER',action.id,reasons);options.onCheckpoint?.('FILTER',{mapping:current,action,issues:reasons,success:false});return false;}
        if(options.activeUnitId&&(action.targetUnitId!==options.activeUnitId||(action.sourceUnitId||action.targetUnitId)!==options.activeUnitId)){
          options.onCheckpoint?.('FILTER',{mapping:current,action,issues:['GLOBAL_RECONCILIATION: tindakan lintas Bab ditunda ke rekonsiliasi global.'],success:false});return false;
        }
        if(!inFocus(action,focus,round))return false;
        const unit=current.units.find(u=>u.id===action.targetUnitId),material=current.units.flatMap(u=>u.materials).find(m=>m.id===action.targetMaterialId);
        const text=action.type==='EDIT_UNIT_TITLE'?unit?.title:material?.title;
        if(text&&action.after===suggestMappingCopyedit(text)&&action.after!==text)return true;
        if(action.linkedTpIds.some(id=>before.uncoveredTpIds.includes(id)))return true;
        // A reviewed material may still need a supported additional relation to
        // resolve a Bab's local coverage gap, even when global coverage is full.
        const resolvesLocalCoverage=(readiness.repairIssues || []).some(g=>{
          if(!g.id.startsWith('coverage:')||g.unitId!==action.targetUnitId)return false;
          const ids=[...(g.tpIds || []),...options.atp.items.filter(a=>g.atpIds?.includes(a.id)).flatMap(getMappingAtpTpIds)];
          return action.linkedTpIds.some(id=>ids.includes(id));
        });
        if(resolvesLocalCoverage)return true;
        if(action.targetMaterialId)return materialGaps.has(action.targetMaterialId);
        return (readiness.repairIssues || []).some(g=>g.unitId===action.targetUnitId);
      }).map(action=>{const normalized=normalizeStep07SourceEvidence(action,current.units,options.tp);if(normalized.notes.length)recordStep07Diagnostic(diagnosticScope,{kind:'EVIDENCE_NORMALIZED',phase:'PROPOSE',unitId:action.targetUnitId,reason:`action=${action.id}; ${normalized.notes.join('; ')}`,success:true});return normalized.action;});
      const substantial=candidates.filter(action=>!isMappingActionAutomatic(action,current.units,options.tp));
      let checks:Step07SemanticCheck[]=[];
      if(substantial.length){
        executionStage='VERIFY';
        const verified=await analyze({scope:'STEP07_AUTO_REPAIR',phase:'VERIFY',round,focus,actions:substantial,validation,repair:repairRequest});
        if(verified.analysisNotice)issues.push(verified.analysisNotice);
        checks=Array.isArray(verified.step07SemanticChecks)?verified.step07SemanticChecks.slice(0,200):[];
        const exactChecks=normalizeStep07VerificationSources(checks,substantial,current.units,options.tp);
        if(JSON.stringify(exactChecks)!==JSON.stringify(checks))recordStep07Diagnostic(diagnosticScope,{kind:'EVIDENCE_NORMALIZED',phase:'VERIFY',unitId:options.activeUnitId || 'GLOBAL',reason:'Kutipan sumber diperbaiki; verdict, kompetensi, konteks, dan missingEvidence tidak diubah.',success:true});
        checks=exactChecks;
        options.onCheckpoint?.('VERIFY',{mapping:current,checks,success:true});
      }
      if(!fresh())throw new Error('STEP07_STALE: perubahan manual/konteks dipertahankan.');
      const permit={scope:'STEP07_AUTO_REPAIR' as const,sourceKey:step07SourceKey(current.units,options.atp,options.tp),checks};
      const priority=['LINK_TP','EDIT_MATERIAL','EDIT_UNIT_TITLE','MOVE_MATERIAL','RESTRUCTURE_UNIT','ADD_MATERIAL'];
      const chosen:AlignmentAction[]=[],targets=new Set<string>();
      executionStage='FILTER';
      for(const action of candidates.sort((a,b)=>priority.indexOf(a.type)-priority.indexOf(b.type))){
        const errors=validateStep07AutoExecution(current.units,[action],options.atp,options.tp,permit,a=>isMappingActionAutomatic(a,current.units,options.tp));
        if(errors.length){issues.push(...errors);failure('VERIFY',action.id,errors);options.onCheckpoint?.('VERIFY',{mapping:current,action,issues:errors,success:false});continue;}
        const target=action.targetMaterialId || `${action.targetUnitId}:${action.type==='ADD_MATERIAL'?action.after:'unit'}`;
        if(targets.has(target)){options.onCheckpoint?.('FILTER',{mapping:current,action,issues:['CONFLICT: alternatif untuk target yang sama; satu tindakan dipilih.'],success:false});continue;}
        if(action.type==='ADD_MATERIAL'&&chosen.some(existing=>existing.type!=='ADD_MATERIAL'&&existing.linkedTpIds.some(id=>action.linkedTpIds.includes(id))))continue;
        targets.add(target);chosen.push(action);
      }
      options.onStatus?.('Memperbaiki');
      executionStage='APPLY';
      let changed=false;
      if(chosen.length){
        const batches=options.isolatedActions?chosen.map(a=>[a]):[chosen];
        for(const batch of batches){
          const candidate=applyMinimalAlignment(current.units,batch,options.atp,options.tp,{...permit,sourceKey:step07SourceKey(current.units,options.atp,options.tp)});
          if(candidate.success&&candidate.nextUnits){
            const didChange=JSON.stringify(candidate.nextUnits)!==JSON.stringify(current.units);
            const next={...current,units:candidate.nextUnits};
            current=next;changed ||= didChange;if(didChange)appliedActions.push(...batch.map(a=>a.id));
            options.onCheckpoint?.('APPLY',{mapping:current,action:batch[0],success:true});
          }else{issues.push(...candidate.issues);for(const action of batch)failure('APPLY',action.id,candidate.issues);options.onCheckpoint?.('APPLY',{mapping:current,action:batch[0],issues:candidate.issues,success:false});}
        }
      }
      options.onStatus?.('Memvalidasi');
      executionStage='VALIDATE';
      readiness=readinessOf(current,options);reportProgress();
      options.onCheckpoint?.('VALIDATE',{mapping:current,issues:readiness.blockers,success:readiness.canSaveDraft});
      if(readiness.canProceed){outcome='COMPLETE';break;}
      if(options.activeUnitId&&!(readiness.repairIssues || []).some(issue=>issue.unitId===options.activeUnitId))break;
      const afterIssues=new Set((readiness.repairIssues || []).map(i=>i.id));
      const resolved=[...beforeIssues].some(id=>!afterIssues.has(id));
      repeatedIssues=resolved?0:repeatedIssues+1;
      const state=computeMappingFingerprint(current.units,options.atp,options.tp);
      if(repair&&!resolved){
        if(analysis.engine==='pedagogical_engine'||issues.some(i=>classifyStep07Failure(i)==='API_FAILURE')){const reason='API_FAILURE: verifikasi semantik AI/fallback tidak tersedia; progres aman dipertahankan.';failure('PROPOSE','analysis',[reason]);issues.push(reason);outcome='INCOMPLETE';break;}
        repair.attempts++;repair.seen.push(proposalKey);
        if(!repair.failures.length)failure('VALIDATE','proposal-set',['NO_PROGRESS: masalah readiness belum berkurang; diperlukan strategi revisi yang berbeda.']);
        if(repair.attempts>=2){outcome='NEEDS_TEACHER_REVIEW';repair.status=outcome;issues.push('NEEDS_TEACHER_REVIEW: dua upaya pada sumber yang sama belum menghasilkan perbaikan aman.');break;}
        issues.push('REPAIR_RETRY: gunakan alasan per tindakan; revisi materi/konteks, bukan mengulang LINK_TP tanpa dukungan.');options.onCheckpoint?.('VALIDATE',{mapping:current,issues:['REPAIR_RETRY: kegagalan spesifik tersimpan untuk strategi berikutnya.'],success:false});continue;
      }
      // History-only semantic confirmation can make real readiness progress while
      // the graph stays identical. It is not a cycle when an issue was resolved.
      if(!changed){outcome='STAGNATED';issues.push('STEP07_STAGNATED: tidak ada tindakan aman yang menghasilkan kemajuan.');break;}
      if(!resolved&&(seenStates.has(state)||repeatedIssues>=2)){outcome='REPEATED_ISSUES';issues.push('STEP07_REPEATED_ISSUES: kondisi/masalah berulang tanpa penyelesaian; progres aman dipertahankan.');break;}
      seenStates.add(state);
    }
  } catch(error){const message=error instanceof Error?error.message:String(error);issues.push(message);failure(executionStage,'analysis', [message]);outcome=message.includes('STEP07_TIMEOUT')?'TIMEOUT':message.includes('STEP07_BUDGET_LIMIT')?'BUDGET_LIMIT':'INCOMPLETE';if(fresh())try{options.onCheckpoint?.(executionStage,{mapping:current,issues:[message],success:false});}catch(logError){issues.push(String(logError));}}
  const stale=!fresh();
  if(stale)issues.push('STEP07_STALE: draft aktif tidak boleh diganti oleh hasil lama.');
  readiness=readinessOf(current,options);reportProgress();
  const validation=readiness.validationResult!;
  if(outcome!=='COMPLETE')issues.push(...readiness.blockers);
  const existingIds=new Set(beforeUnits.flatMap(u=>u.materials.map(m=>m.id)));
  const meta:Step07AutoRepairRun={scope:'STEP07_AUTO_REPAIR',version:1,runId:`step07-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,beforeUnits,
    verifiedFingerprint:outcome==='COMPLETE'?step07VerificationKey(current.units,options.atp,options.tp):undefined,
    resultFingerprint:computeMappingFingerprint(current.units,options.atp,options.tp),
    expectedStoredFingerprint:options.persistedMapping?step07PersistedKey(options.persistedMapping,options.atp,options.tp):'NONE',
    addedMaterialIds:current.units.flatMap(u=>u.materials.filter(m=>!existingIds.has(m.id)).map(m=>m.id)),rounds:rounds+(continuing?previous!.rounds:0),outcome,issues:[...new Set(issues)],initialIssueIds,progress:progress!,requests,inputCharacters};
  current={...current,step07AutoRepair:meta};
  const hasProgress=JSON.stringify(current.units)!==JSON.stringify(initial.units);
  if(!stale&&readiness.canSaveDraft&&(outcome==='COMPLETE'||hasProgress||options.saveInitialProgress)){
    try{if(!fresh())throw new Error('STEP07_STALE');if(!await (options.persist?options.persist(structuredClone(current)):options.save(structuredClone(current))))throw new Error('Penyimpanan atomik ditolak.');persisted=true;saved=outcome==='COMPLETE';if(saved)options.onStatus?.('Selesai');}
    catch(error){outcome='SAVE_FAILED';meta.outcome=outcome;const message=error instanceof Error?error.message:String(error);meta.issues.push(message);if(fresh())try{options.onCheckpoint?.('SAVE',{mapping:current,issues:[message],success:false});}catch(logError){meta.issues.push(String(logError));}}
  }
  recordStep07Diagnostic(diagnosticScope,{kind:'PASS_RESULT',unitId:options.activeUnitId || 'GLOBAL',phase:executionStage,category:outcome,success:saved,persisted,reason:`rounds=${rounds}; initial=${progress!.initial}; resolved=${progress!.resolved}; remaining=${progress!.remaining}; ${meta.issues.join('; ')}`});
  return {mapping:current,analysis,validation,readiness:resolveATPUnitMappingReadiness(current,options.atp,options.tp),progress:progress!,outcome,saved,persisted,stale,rounds,issues:meta.issues,appliedActions};
}

export function step07RepairColor(units:ATPUnitMappingData['units'],run:Step07AutoRepairRun|undefined,unitId:string,materialId?:string):'red'|'green'|'pink'|undefined {
  if(!run)return undefined;
  const unit=units.find(u=>u.id===unitId),entity=materialId?unit?.materials.find(m=>m.id===materialId):unit;
  if(!entity)return undefined;
  const before=materialId?run.beforeUnits.flatMap(u=>u.materials).find(m=>m.id===materialId):run.beforeUnits.find(u=>u.id===unitId);
  if(materialId&&!before&&run.addedMaterialIds.includes(materialId))return 'pink';
  return before?.title===entity.title?'green':'red';
}

export function undoStep07AutoRepair(mapping:ATPUnitMappingData,atp:ATPData,tp:TPData,persistedMapping:ATPUnitMappingData|null=mapping) {
  const run=mapping.step07AutoRepair;
  if(!run)return {success:false,issues:['Snapshot auto-repair tidak tersedia.']};
  if(run.undone)return {success:true,issues:[],mapping:structuredClone(mapping)};
  if(run.resultFingerprint?run.resultFingerprint!==computeMappingFingerprint(mapping.units,atp,tp):run.verifiedFingerprint!==step07VerificationKey(mapping.units,atp,tp))return {success:false,issues:['Undo ditolak: redaksi, relasi, struktur atau sumber berubah setelah auto-repair. Edit manual dipertahankan.']};
  const validation=validateATPUnitMappingCanonical({...mapping,units:run.beforeUnits},atp,tp);
  if(!validation.isValid)return {success:false,issues:validation.issues};
  const units=recordMappingBatch(mapping.units,run.beforeUnits,'Guru membatalkan auto-repair dan memulihkan snapshot awal.',true);
  const next={...mapping,units,step07AutoRepair:{...run,runId:`undo-${run.runId}`,undone:true,expectedStoredFingerprint:persistedMapping?step07PersistedKey(persistedMapping,atp,tp):'NONE',verifiedFingerprint:undefined,resultFingerprint:computeMappingFingerprint(units,atp,tp),outcome:'INCOMPLETE' as const,issues:['Auto-repair dibatalkan. Snapshot awal dipulihkan ke draft; simpan untuk menyimpan.']}};
  return {success:true,issues:[],mapping:next};
}

import type { ATPData, TPData, ATPUnitMappingData, Step07AutoRequest, Step07AutoRepairRun, Step07SemanticCheck, Step07RepairProgress } from '../types';
import type { MappingAnalysisResult } from './aiService';
import { applyMinimalAlignment, isMappingActionAutomatic, suggestMappingCopyedit, recordMappingBatch, type AlignmentAction } from './mappingAlignmentService';
import { computeStep07VerifiedFingerprint, computeMappingFingerprint } from './atpMappingActionApplyService';
import { validateATPUnitMappingCanonical } from './atpUnitMappingValidationService';
import { resolveATPUnitMappingReadiness } from './atpMappingReadinessService';
import { step07SourceKey, step07PersistedKey, validateStep07AutoExecution } from './step07AutoExecutionPolicy';
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
  onWork?:(state:Step07WorkStatus)=>void;
  onCheckpoint?:(stage:Step07Stage,data:{mapping:ATPUnitMappingData;analysis?:MappingAnalysisResult;checks?:Step07SemanticCheck[];action?:AlignmentAction;issues?:string[];success:boolean})=>void;
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
      const before=readiness.validationResult!,beforeIssues=new Set((readiness.repairIssues || []).map(i=>i.id));
      const focus=focusFor(current,options,readiness,round===1&&!continuing);
      if(options.activeUnitId){focus.unitIds=[options.activeUnitId];focus.materialIds=current.units.find(u=>u.id===options.activeUnitId)?.materials.map(m=>m.id) || [];}
      const validation={canProceed:readiness.canProceed,issues:readiness.repairIssues || [],rejectedActions:[...new Set(issues)]};
      options.onStatus?.('Menganalisis');
      executionStage='PROPOSE';
      analysis=await analyze({scope:'STEP07_AUTO_REPAIR',phase:'PROPOSE',round,focus,validation});
      options.onCheckpoint?.('PROPOSE',{mapping:current,analysis,success:true});
      if(analysis.analysisNotice)issues.push(analysis.analysisNotice);
      for(const proposal of (analysis.alignmentProposals || []).slice(0,200).filter(p=>p.validationStatus==='REJECTED'))issues.push(...(proposal.validationIssues?.length?proposal.validationIssues:[proposal.reason]));
      if(!fresh())throw new Error('STEP07_STALE: perubahan manual/konteks dipertahankan.');
      const materialGaps=new Set((readiness.repairIssues || []).flatMap(g=>g.materialId?[g.materialId]:[]));
      const candidates=(analysis.alignmentProposals || []).slice(0,200).filter(p=>p.validationStatus==='READY'&&p.action).map(p=>p.action!).filter(action=>{
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
      });
      const substantial=candidates.filter(action=>!isMappingActionAutomatic(action,current.units,options.tp));
      let checks:Step07SemanticCheck[]=[];
      if(substantial.length){
        executionStage='VERIFY';
        const verified=await analyze({scope:'STEP07_AUTO_REPAIR',phase:'VERIFY',round,focus,actions:substantial,validation});
        if(verified.analysisNotice)issues.push(verified.analysisNotice);
        checks=Array.isArray(verified.step07SemanticChecks)?verified.step07SemanticChecks.slice(0,200):[];
        options.onCheckpoint?.('VERIFY',{mapping:current,checks,success:true});
      }
      if(!fresh())throw new Error('STEP07_STALE: perubahan manual/konteks dipertahankan.');
      const permit={scope:'STEP07_AUTO_REPAIR' as const,sourceKey:step07SourceKey(current.units,options.atp,options.tp),checks};
      const priority=['LINK_TP','EDIT_MATERIAL','EDIT_UNIT_TITLE','MOVE_MATERIAL','RESTRUCTURE_UNIT','ADD_MATERIAL'];
      const chosen:AlignmentAction[]=[],targets=new Set<string>();
      executionStage='FILTER';
      for(const action of candidates.sort((a,b)=>priority.indexOf(a.type)-priority.indexOf(b.type))){
        const errors=validateStep07AutoExecution(current.units,[action],options.atp,options.tp,permit,a=>isMappingActionAutomatic(a,current.units,options.tp));
        if(errors.length){issues.push(...errors);options.onCheckpoint?.('VERIFY',{mapping:current,action,issues:errors,success:false});continue;}
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
          }else{issues.push(...candidate.issues);options.onCheckpoint?.('APPLY',{mapping:current,action:batch[0],issues:candidate.issues,success:false});}
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
      // History-only semantic confirmation can make real readiness progress while
      // the graph stays identical. It is not a cycle when an issue was resolved.
      if(!changed){outcome='STAGNATED';issues.push('STEP07_STAGNATED: tidak ada tindakan aman yang menghasilkan kemajuan.');break;}
      if(!resolved&&(seenStates.has(state)||repeatedIssues>=2)){outcome='REPEATED_ISSUES';issues.push('STEP07_REPEATED_ISSUES: kondisi/masalah berulang tanpa penyelesaian; progres aman dipertahankan.');break;}
      seenStates.add(state);
    }
  } catch(error){const message=error instanceof Error?error.message:String(error);issues.push(message);outcome=message.includes('STEP07_TIMEOUT')?'TIMEOUT':message.includes('STEP07_BUDGET_LIMIT')?'BUDGET_LIMIT':'INCOMPLETE';if(fresh())try{options.onCheckpoint?.(executionStage,{mapping:current,issues:[message],success:false});}catch(logError){issues.push(String(logError));}}
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

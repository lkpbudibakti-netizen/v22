import type { ATPData, TPData, ATPUnitMappingData, Step07AutoRequest, Step07AutoRepairRun, Step07SemanticCheck } from '../types';
import type { MappingAnalysisResult } from './aiService';
import { applyMinimalAlignment, isMappingActionAutomatic, hasTeacherMaterialSupport, suggestMappingCopyedit, recordMappingBatch, type AlignmentAction } from './mappingAlignmentService';
import { computeStep07VerifiedFingerprint, computeMappingFingerprint } from './atpMappingActionApplyService';
import { validateATPUnitMappingCanonical } from './atpUnitMappingValidationService';
import { resolveATPUnitMappingReadiness } from './atpMappingReadinessService';
import { step07SourceKey, step07PersistedKey, validateStep07AutoExecution } from './step07AutoExecutionPolicy';
import { checkMappingSemanticEvidence } from '../../server/mappingSemanticEvidence';

export interface Step07RepairOptions {
  mapping:ATPUnitMappingData; atp:ATPData; tp:TPData; persistedMapping?:ATPUnitMappingData;
  analyze:(mapping:ATPUnitMappingData,request:Step07AutoRequest,signal:AbortSignal)=>Promise<MappingAnalysisResult>;
  save:(mapping:ATPUnitMappingData)=>boolean;
  isCurrent:()=>boolean;
  onStatus?:(status:'Menganalisis'|'Memperbaiki'|'Memvalidasi'|'Selesai')=>void;
  maxRounds?:number; timeoutMs?:number; callTimeoutMs?:number;
}
export const step07VerificationKey=computeStep07VerifiedFingerprint;
const validationOf=(mapping:ATPUnitMappingData,options:Step07RepairOptions)=>validateATPUnitMappingCanonical(mapping,options.atp,options.tp);
const semanticGaps=(mapping:ATPUnitMappingData,options:Step07RepairOptions)=>mapping.units.flatMap(unit=>unit.materials.filter(material=>material.linkedTpIds.length>0&&(!hasTeacherMaterialSupport(unit,material,options.tp)||checkMappingSemanticEvidence({label:unit.title,tpItems:options.tp.items.filter(t=>material.linkedTpIds.includes(t.id))}).hardConflict)).map(material=>({unitId:unit.id,materialId:material.id,title:material.title,tpIds:material.linkedTpIds})));
const gapScore=(validation:ReturnType<typeof validateATPUnitMappingCanonical>)=>validation.materialsWithoutLineage.length+validation.unitsWithoutLineage.length+validation.unmappedAtpIds.length+validation.uncoveredTpIds.length+validation.materialCoverageGaps.reduce((sum,gap)=>sum+gap.tpIds.length+gap.atpItemIds.length,0)+Number(!validation.isValid);
function focusFor(mapping:ATPUnitMappingData,options:Step07RepairOptions,round:number):Step07AutoRequest['focus'] {
  const v=validationOf(mapping,options);
  const semantic=semanticGaps(mapping,options);
  return round===1?{unitIds:mapping.units.map(u=>u.id),materialIds:mapping.units.flatMap(u=>u.materials.map(m=>m.id)),tpIds:options.tp.items.map(t=>t.id),atpIds:options.atp.items.map(a=>a.id)}:
    {unitIds:[...new Set([...v.unitsWithoutLineage,...v.materialCoverageGaps.map(g=>g.unitId),...v.materialsWithoutLineage.map(m=>m.unitId),...semantic.map(m=>m.unitId)])],materialIds:[...new Set([...v.materialsWithoutLineage.map(m=>m.materialId),...semantic.map(m=>m.materialId)])],tpIds:[...new Set([...v.uncoveredTpIds,...v.materialCoverageGaps.flatMap(g=>g.tpIds)])],atpIds:[...new Set([...v.unmappedAtpIds,...v.materialCoverageGaps.flatMap(g=>g.atpItemIds)])]};
}
const inFocus=(action:AlignmentAction,focus:Step07AutoRequest['focus'],round:number)=>round===1||focus.unitIds.includes(action.targetUnitId)||focus.unitIds.includes(action.sourceUnitId || '')||focus.materialIds.includes(action.targetMaterialId || '')||action.linkedTpIds.some(id=>focus.tpIds.includes(id));

/** Bounded orchestration over the existing engine and validators; no partial storage writes. */
export async function runStep07AutoRepair(options:Step07RepairOptions) {
  const initial=structuredClone(options.mapping),beforeUnits=structuredClone(initial.units),canonicalKey=JSON.stringify({atp:options.atp,tp:options.tp});
  let current=structuredClone(initial),analysis:MappingAnalysisResult|undefined,rounds=0,saved=false;
  let outcome:Step07AutoRepairRun['outcome']='INCOMPLETE';
  const issues:string[]=[],appliedActions:string[]=[];
  const deadline=Date.now()+Math.max(1,Math.min(options.timeoutMs ?? 120000,120000));
  const maxRounds=Math.max(1,Math.min(3,Math.floor(options.maxRounds || 3)));
  const fresh=()=>options.isCurrent()&&canonicalKey===JSON.stringify({atp:options.atp,tp:options.tp});
  async function analyze(request:Step07AutoRequest) {
    if(!fresh())throw new Error('STEP07_STALE: data manual/konteks berubah; hasil tidak diterapkan.');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([options.analyze(structuredClone(current),request,controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('STEP07_TIMEOUT: batas waktu analisis terlampaui.'));},Math.max(1,Math.min(options.callTimeoutMs ?? 30000,deadline-Date.now())));})]);}
    finally{if(timer)clearTimeout(timer);}
  }
  try {
    for(let round=1;round<=maxRounds;round++){
      rounds=round;if(Date.now()>=deadline)throw new Error('STEP07_TIMEOUT: batas waktu total terlampaui.');
      const before=validationOf(current,options),beforeScore=gapScore(before)+semanticGaps(current,options).length,focus=focusFor(current,options,round);
      options.onStatus?.('Menganalisis');
      analysis=await analyze({scope:'STEP07_AUTO_REPAIR',phase:'PROPOSE',round,focus});
      if(analysis.analysisNotice)issues.push(analysis.analysisNotice);
      for(const proposal of (analysis.alignmentProposals || []).slice(0,200).filter(p=>p.validationStatus==='REJECTED'))issues.push(...(proposal.validationIssues?.length?proposal.validationIssues:[proposal.reason]));
      if(!fresh())throw new Error('STEP07_STALE: perubahan manual/konteks dipertahankan.');
      const materialGaps=new Set([...before.materialsWithoutLineage.map(g=>g.materialId),...semanticGaps(current,options).map(g=>g.materialId)]);
      const candidates=(analysis.alignmentProposals || []).slice(0,200).filter(p=>p.validationStatus==='READY'&&p.action).map(p=>p.action!).filter(action=>{
        if(!inFocus(action,focus,round))return false;
        const unit=current.units.find(u=>u.id===action.targetUnitId),material=current.units.flatMap(u=>u.materials).find(m=>m.id===action.targetMaterialId);
        const text=action.type==='EDIT_UNIT_TITLE'?unit?.title:material?.title;
        if(text&&action.after===suggestMappingCopyedit(text)&&action.after!==text)return true;
        if(action.linkedTpIds.some(id=>before.uncoveredTpIds.includes(id)))return true;
        if(action.targetMaterialId)return materialGaps.has(action.targetMaterialId);
        return before.unitsWithoutLineage.includes(action.targetUnitId)||before.materialCoverageGaps.some(g=>g.unitId===action.targetUnitId)||semanticGaps(current,options).some(g=>g.unitId===action.targetUnitId);
      });
      const substantial=candidates.filter(action=>!isMappingActionAutomatic(action,current.units,options.tp));
      let checks:Step07SemanticCheck[]=[];
      if(substantial.length){
        const verified=await analyze({scope:'STEP07_AUTO_REPAIR',phase:'VERIFY',round,focus,actions:substantial});
        if(verified.analysisNotice)issues.push(verified.analysisNotice);
        checks=Array.isArray(verified.step07SemanticChecks)?verified.step07SemanticChecks.slice(0,200):[];
      }
      if(!fresh())throw new Error('STEP07_STALE: perubahan manual/konteks dipertahankan.');
      const permit={scope:'STEP07_AUTO_REPAIR' as const,sourceKey:step07SourceKey(current.units,options.atp,options.tp),checks};
      const priority=['LINK_TP','EDIT_MATERIAL','EDIT_UNIT_TITLE','MOVE_MATERIAL','RESTRUCTURE_UNIT','ADD_MATERIAL'];
      const chosen:AlignmentAction[]=[],targets=new Set<string>();
      for(const action of candidates.sort((a,b)=>priority.indexOf(a.type)-priority.indexOf(b.type))){
        const errors=validateStep07AutoExecution(current.units,[action],options.atp,options.tp,permit,a=>isMappingActionAutomatic(a,current.units,options.tp));
        if(errors.length){issues.push(...errors);continue;}
        const target=action.targetMaterialId || `${action.targetUnitId}:${action.type==='ADD_MATERIAL'?action.after:'unit'}`;
        if(targets.has(target))continue;
        if(action.type==='ADD_MATERIAL'&&chosen.some(existing=>existing.type!=='ADD_MATERIAL'&&existing.linkedTpIds.some(id=>action.linkedTpIds.includes(id))))continue;
        targets.add(target);chosen.push(action);
      }
      options.onStatus?.('Memperbaiki');
      let changed=false;
      if(chosen.length){
        const candidate=applyMinimalAlignment(current.units,chosen,options.atp,options.tp,permit);
        if(candidate.success&&candidate.nextUnits){changed=JSON.stringify(candidate.nextUnits)!==JSON.stringify(current.units);current={...current,units:candidate.nextUnits};if(changed)appliedActions.push(...chosen.map(a=>a.id));}
        else issues.push(...candidate.issues);
      }
      options.onStatus?.('Memvalidasi');
      const validation=validationOf(current,options);
      if(validation.isValid&&validation.isComplete&&!semanticGaps(current,options).length){
        const readiness=resolveATPUnitMappingReadiness({...current,step07AutoRepair:undefined},options.atp,options.tp);
        if(!readiness.canProceed){issues.push(...readiness.blockers);break;}
        outcome='COMPLETE';break;
      }
      if(!changed||gapScore(validation)+semanticGaps(current,options).length>=beforeScore){outcome='STAGNATED';issues.push('STEP07_STAGNATED: tidak ada kemajuan lineage/coverage/bukti semantik; proses dihentikan.');break;}
    }
  } catch(error){const message=error instanceof Error?error.message:String(error);issues.push(message);outcome=message.includes('STEP07_TIMEOUT')?'TIMEOUT':'INCOMPLETE';}
  const stale=!fresh();
  if(stale)issues.push('STEP07_STALE: draft aktif tidak boleh diganti oleh hasil lama.');
  const validation=validationOf(current,options);
  if(outcome!=='COMPLETE')issues.push(...validation.issues);
  if(outcome!=='COMPLETE')issues.push(...semanticGaps(current,options).map(gap=>`SEMANTIC_EVIDENCE_MISSING: materi '${gap.title}' (${gap.materialId}) di Bab ${gap.unitId}, TP [${gap.tpIds.join(', ')}] belum memiliki dukungan kompetensi/substansi terverifikasi.`));
  const existingIds=new Set(beforeUnits.flatMap(u=>u.materials.map(m=>m.id)));
  const meta:Step07AutoRepairRun={scope:'STEP07_AUTO_REPAIR',version:1,runId:`step07-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,beforeUnits,
    verifiedFingerprint:outcome==='COMPLETE'?step07VerificationKey(current.units,options.atp,options.tp):undefined,
    resultFingerprint:computeMappingFingerprint(current.units,options.atp,options.tp),
    expectedStoredFingerprint:options.persistedMapping?step07PersistedKey(options.persistedMapping,options.atp,options.tp):'NONE',
    addedMaterialIds:current.units.flatMap(u=>u.materials.filter(m=>!existingIds.has(m.id)).map(m=>m.id)),rounds,outcome,issues:[...new Set(issues)]};
  current={...current,step07AutoRepair:meta};
  if(outcome==='COMPLETE'&&!stale){
    try{if(!fresh())throw new Error('STEP07_STALE');if(!options.save(structuredClone(current)))throw new Error('Penyimpanan atomik ditolak.');saved=true;options.onStatus?.('Selesai');}
    catch(error){outcome='SAVE_FAILED';meta.outcome=outcome;meta.issues.push(error instanceof Error?error.message:String(error));}
  }
  return {mapping:current,analysis,validation,outcome,saved,stale,rounds,issues:meta.issues,appliedActions};
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

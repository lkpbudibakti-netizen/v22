import type { ATPData, TPData, ATPUnitMapping, ATPUnitMappingData, Step07SemanticCheck, MappingChangeRecord } from '../types';
import type { AlignmentAction } from './mappingAlignmentService';
import type {MappingAnalysisResult} from './aiService';
import { deriveMappingAtpIds } from './atpMappingLineageService';

export interface Step07AutoPermit {
  scope:'STEP07_AUTO_REPAIR';
  sourceKey:string;
  checks?:Step07SemanticCheck[]; // Legacy history only; no second AI verification.
  activeUnitId?:string;
}
export const STEP07_SEMANTIC_POLICY_VERSION='STRUCTURAL_MAPPING_V2';
export type Step07FailureCategory='EVIDENCE_INVALID'|'SEMANTIC_MISMATCH'|'STRUCTURAL_CONFLICT'|'API_FAILURE'|'NO_PROGRESS';
export interface Step07ActionFailure {actionId:string;category:Step07FailureCategory;reason:string;phase:string;}
export interface Step07RepairAttemptState {sourceKey:string;attempts:number;seen:string[];failures:Step07ActionFailure[];status?:'NEEDS_TEACHER_REVIEW';}
export function step07RepairProposalKey(result:MappingAnalysisResult):string {
  return JSON.stringify((result.alignmentProposals || []).map(p=>{const a=p.action;return {type:a?.type || p.proposalType,unit:p.targetUnitId,source:a?.sourceUnitId,material:p.targetMaterialId,before:p.before,after:p.after,tp:[...(a?.linkedTpIds || p.tpIds || [])].sort()};}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function classifyStep07Failure(reason:string):Step07FailureCategory {
  if(/API_|AI_UNAVAILABLE|AI_NOT_CONFIGURED|TIMEOUT|NETWORK|ABORT/i.test(reason))return 'API_FAILURE';
  if(/EVIDENCE_|kutipan|bukti sumber|tidak dapat ditelusuri|sumber.*bukti.*lengkap/i.test(reason))return 'EVIDENCE_INVALID';
  if(/SEMANTIC|NEEDS_REVIEW|kompetensi|substansi|konteks|pedagog|hard.conflict|CONTENT_CHANGE/i.test(reason))return 'SEMANTIC_MISMATCH';
  if(/CONFLICT|MISMATCH|ID |ID_|fiktif|duplikat|duplicate|tidak ditemukan|struktur|source.changed|stale|BEFORE_/i.test(reason))return 'STRUCTURAL_CONFLICT';
  return 'NO_PROGRESS';
}
/** Legacy receipt helpers retained for backup/history compatibility only.
 * Source citations are pointers, not semantic approval. Never repair a stale before,
 * fabricated ID, verdict, competence/context claim, missingEvidence, or material scope. */
export function normalizeStep07SourceEvidence(action:AlignmentAction,units:ATPUnitMapping[],tp:TPData):{action:AlignmentAction;notes:string[]} {
  const copy=structuredClone(action),notes:string[]=[];
  const unit=units.find(u=>u.id===action.targetUnitId),source=units.find(u=>u.id===(action.sourceUnitId || action.targetUnitId));
  const material=source?.materials.find(m=>m.id===action.targetMaterialId);
  const original=action.type==='EDIT_UNIT_TITLE'?unit?.title:action.type==='ADD_MATERIAL'?action.after:action.type==='RESTRUCTURE_UNIT'?source?.materials.map(m=>m.title).join('; '):material?.title;
  if(!unit||!source||!original||!action.linkedTpIds.length||action.linkedTpIds.some(id=>tp.items.filter(t=>t.id===id).length!==1))return {action:copy,notes};
  if(action.type!=='ADD_MATERIAL'&&action.type!=='RESTRUCTURE_UNIT'&&action.before!==original){
    if(typeof action.before!=='string'||normalized(action.before)!==normalized(original))return {action:copy,notes};
    copy.before=original;notes.push('BEFORE_SOURCE_NORMALIZED: hanya Unicode/spasi/kapital, bukan substansi.');
  }
  const old=Array.isArray(copy.evidence)?copy.evidence:[];
  copy.evidence=action.linkedTpIds.map(id=>{
    const item=tp.items.find(t=>t.id===id)!,prior=old.find(e=>e.tpId===id);
    if(prior?.tpQuote!==item.statement||prior?.materialQuote!==original)notes.push(`SOURCE_CITATION_REPAIRED:${id}: kutipan exact diambil dari ID sumber, belum merupakan verifikasi semantik.`);
    return {tpId:id,tpQuote:item.statement,materialQuote:original};
  });
  return {action:copy,notes};
}
export function normalizeStep07VerificationSources(checks:Step07SemanticCheck[],actions:AlignmentAction[],units:ATPUnitMapping[],tp:TPData):Step07SemanticCheck[] {
  return checks.map(check=>{
    const action=actions.find(a=>a.id===check.actionId);if(!action)return structuredClone(check);
    const repaired=normalizeStep07SourceEvidence(action,units,tp).action,copy=structuredClone(check);
    // Retain missing/negative semantic decisions. Only replace existing evidence
    // source-quote fields; never synthesize a SUPPORTED finding or semantic evidence.
    if(Array.isArray(copy.evidence))for(const evidence of copy.evidence){const exact=repaired.evidence?.find(e=>e.tpId===evidence.tpId);if(exact){evidence.tpQuote=exact.tpQuote;evidence.materialQuote=exact.materialQuote;}}
    const target=units.find(u=>u.id===action.targetUnitId);
    if(target&&['ADD_MATERIAL','MOVE_MATERIAL'].includes(action.type)&&typeof copy.targetUnitQuote==='string'&&copy.targetUnitQuote.trim())copy.targetUnitQuote=target.title;
    return copy;
  });
}
export function step07ActionDependency(action:AlignmentAction,units:ATPUnitMapping[],atp:ATPData,tp:TPData):string {
  const unit=units.find(u=>u.id===action.targetUnitId),source=units.find(u=>u.id===(action.sourceUnitId || action.targetUnitId));
  const material=source?.materials.find(m=>m.id===action.targetMaterialId);
  const ids=new Set([...action.linkedTpIds,...(action.replaceTpIds?material?.linkedTpIds || []:[])]);
  return JSON.stringify({unit:unit?.title,source:source?.title,material:material&&{id:material.id,title:material.title,tp:material.linkedTpIds,atp:material.linkedAtpItemIds},structure:['ADD_MATERIAL','MOVE_MATERIAL','RESTRUCTURE_UNIT'].includes(action.type)?[unit?.materials.map(m=>[m.id,m.title,m.order,m.linkedTpIds]),source?.materials.map(m=>[m.id,m.title,m.order,m.linkedTpIds])]:undefined,tp:tp.items.filter(t=>ids.has(t.id)),atp:atp.items.filter(a=>(a.linkedTpIds || (a.tpId?[a.tpId]:[])).some(id=>ids.has(id)))});
}
export const step07SourceKey=(units:ATPUnitMapping[],atp:ATPData,tp:TPData)=>JSON.stringify({units,atp,tp});
export function step07PersistedKey(mapping:ATPUnitMappingData,atp:ATPData,tp:TPData):string {
  const meta=mapping.step07AutoRepair;
  // Exclude the previous compare key itself, avoiding recursively growing snapshots.
  const normalized=meta?{...mapping,step07AutoRepair:{...meta,expectedStoredFingerprint:undefined}}:mapping;
  return JSON.stringify({mapping:normalized,atp,tp});
}
const normalized=(value:string)=>value.normalize('NFC').toLocaleLowerCase('id').trim().replace(/\s+/g,' ');
const contains=(text:string,quote:unknown,min:number)=>typeof quote==='string'&&quote.trim().length>=Math.min(min,text.trim().length)&&!!quote.trim()&&normalized(text).includes(normalized(quote));

/** Source citations are not a pedagogical explanation. The independent verifier
 * must explain substantive scope/competence relevance, without inventing lessons. */
export function hasStep07LinkRationale(evidence:Step07SemanticCheck['evidence'][number]):boolean {
  return typeof evidence.relationshipReason==='string' && evidence.relationshipReason.trim().length>=24;
}
const legacyLiteralProof=(title:string,quote:string,competence:string)=>contains(title,quote,4)&&competence.split(/[,;]/).some(v=>v.trim()&&normalized(quote).includes(normalized(v.trim())));

/** Recheck persisted proof against current canonical sources; IDs or a verdict alone
 * are insufficient to unlock scoped readiness after reload. */
export function hasStep07StoredSemanticSupport(record:MappingChangeRecord,material:ATPUnitMapping['materials'][number],tp:TPData):boolean {
  const check=record.semanticVerification;
  if(!check||check.verdict!=='SUPPORTED'||typeof check.reason!=='string'||!check.reason.trim()||(check.missingEvidence!==undefined&&(!Array.isArray(check.missingEvidence)||check.missingEvidence.length>0))||!Array.isArray(check.evidence)||!record.reviewedTpIds?.length)return false;
  return record.reviewedTpIds.every(id=>{
    const objective=tp.items.find(t=>t.id===id),entries=check.evidence.filter(e=>e?.tpId===id);
    if(!objective||!entries.length)return false;
    // One canonical TP may contain several competencies. Preserve and validate
    // every source-bound proof; never discard a failing secondary proof.
    return entries.every(e=>{
    const original=record.kind==='REALIGN'?material.title:(record.before || material.title);
    if(!contains(objective.statement,e.tpQuote,12)||!contains(original,e.materialQuote,8)||!contains(objective.statement,e.competenceQuote,4)||!contains(original,e.contextQuote,8)||!contains(material.title,e.contextQuote,8))return false;
    // Older literal proofs remain valid; implicit titles need a source-bound rationale.
    return legacyLiteralProof(material.title,e.competenceQuote,objective.competence || '')||hasStep07LinkRationale(e);
    });
  });
}

/** Single-response AI execution: identity, source and canonical relationships only. */
export function validateStep07AutoExecution(units:ATPUnitMapping[],actions:AlignmentAction[],atp:ATPData,tp:TPData,permit:Step07AutoPermit,_legacyAutomatic:(action:AlignmentAction)=>boolean=()=>false):string[] {
  if(permit.scope!=='STEP07_AUTO_REPAIR'||permit.sourceKey!==step07SourceKey(units,atp,tp))return ['STEP07_SOURCE_CHANGED: sumber atau canonical berubah setelah analisis.'];
  const issues:string[]=[],seen=new Set<string>();
  const allowed=['LINK_TP','EDIT_MATERIAL','EDIT_UNIT_TITLE','ADD_MATERIAL','MOVE_MATERIAL','RESTRUCTURE_UNIT'];
  for(const action of actions){
    const fail=(reason:string)=>issues.push(action.id+': '+reason);
    if(!action.id||seen.has(action.id)||!allowed.includes(action.type)){fail('STRUCTURAL_CONFLICT: ID/jenis tindakan tidak sah atau duplikat.');continue;}seen.add(action.id);
    const unit=units.find(u=>u.id===action.targetUnitId),source=units.find(u=>u.id===(action.sourceUnitId || action.targetUnitId));
    if(!unit||!source){fail('STRUCTURAL_CONFLICT: Bab sumber/target tidak ditemukan.');continue;}
    if(permit.activeUnitId&&(unit.id!==permit.activeUnitId||source.id!==permit.activeUnitId)){fail('TARGET_UNIT_CONFLICT: tindakan di luar Bab aktif.');continue;}
    if(!action.reason?.trim())fail('Alasan relevansi pemetaan wajib tersedia.');
    if(!Array.isArray(action.linkedTpIds)||!action.linkedTpIds.length||new Set(action.linkedTpIds).size!==action.linkedTpIds.length){fail('Subset TP wajib eksplisit, tidak kosong/duplikat.');continue;}
    issues.push(...deriveMappingAtpIds(action.linkedTpIds,atp,tp).issues.map(reason=>action.id+': '+reason));
    if(action.type==='EDIT_UNIT_TITLE'){if(action.before!==unit.title||!action.after?.trim())fail('BEFORE_MISMATCH: judul Bab/sumber tidak valid.');}
    else if(action.type==='ADD_MATERIAL'){if(!action.after?.trim())fail('Judul materi baru kosong.');}
    else if(action.type!=='RESTRUCTURE_UNIT'){
      const material=source.materials.find(m=>m.id===action.targetMaterialId);
      if(!material||action.before!==material.title)fail('BEFORE_MISMATCH: materi sumber berubah atau tidak ditemukan.');
      if(action.type==='EDIT_MATERIAL'&&!action.after?.trim())fail('Judul hasil kosong.');
    }
  }
  return [...new Set(issues)];
}

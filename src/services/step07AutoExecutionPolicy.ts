import type { ATPData, TPData, ATPUnitMapping, ATPUnitMappingData, Step07SemanticCheck, MappingChangeRecord } from '../types';
import type { AlignmentAction } from './mappingAlignmentService';
import type {MappingAnalysisResult} from './aiService';
import { checkMappingSemanticEvidence } from '../../server/mappingSemanticEvidence';

export interface Step07AutoPermit {
  scope:'STEP07_AUTO_REPAIR';
  sourceKey:string;
  checks:Step07SemanticCheck[];
}
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
/** Source citations are pointers, not semantic approval. Never repair a stale before,
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
 * must explain the activity-to-competence relationship for implicit short titles. */
export function hasStep07LinkRationale(evidence:Step07SemanticCheck['evidence'][number]):boolean {
  return typeof evidence.relationshipReason==='string' && evidence.relationshipReason.trim().length>=24;
}

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
    if(!(objective.competence || '').split(/[,;]/).some(v=>v.trim()&&normalized(e.competenceQuote).includes(normalized(v.trim()))))return false;
    return contains(material.title,e.competenceQuote,4)||(record.kind==='REALIGN'&&hasStep07LinkRationale(e));
    });
  });
}

/** A scoped authority check, not a replacement semantic engine or canonical validator. */
export function validateStep07AutoExecution(units:ATPUnitMapping[],actions:AlignmentAction[],atp:ATPData,tp:TPData,permit:Step07AutoPermit,isExistingAutomatic:(action:AlignmentAction)=>boolean=()=>false):string[] {
  const issues:string[]=[];
  if(permit.scope!=='STEP07_AUTO_REPAIR'||!Array.isArray(permit.checks)||permit.sourceKey!==step07SourceKey(units,atp,tp)) return ['STEP07_SOURCE_CHANGED: sumber atau canonical berubah setelah verifikasi.'];
  for(const action of actions){
    const fail=(reason:string)=>issues.push(`${action.id}: ${reason}`);
    if(action.type!=='LINK_TP'&&isExistingAutomatic(action))continue;
    const unit=units.find(u=>u.id===action.targetUnitId),source=units.find(u=>u.id===(action.sourceUnitId||action.targetUnitId));
    const material=source?.materials.find(m=>m.id===action.targetMaterialId);
    const matches=permit.checks.filter(check=>check?.actionId===action.id);
    const check=matches[0];
    if(!unit||!source){fail('STRUCTURAL_CONFLICT: Bab sumber/target tidak ditemukan.');continue;}
    if(matches.length!==1||check?.verdict!=='SUPPORTED'||typeof check.reason!=='string'||!check.reason.trim()||(check.missingEvidence!==undefined&&(!Array.isArray(check.missingEvidence)||check.missingEvidence.length>0))){fail('NEEDS_REVIEW: verifikasi semantik independen belum mendukung tindakan.');continue;}
    if(action.replaceTpIds){
      const removed=(material?.linkedTpIds || []).filter(id=>!action.linkedTpIds.includes(id));
      for(const id of removed){
        const objective=tp.items.find(t=>t.id===id),evidence=Array.isArray(check.removedRelations)?check.removedRelations.filter(e=>e?.tpId===id):[];
        if(!material||!objective||evidence.length!==1||typeof evidence[0].reason!=='string'||!evidence[0].reason.trim()||!contains(objective.statement,evidence[0].tpQuote,12)||!contains(material.title,evidence[0].materialQuote,8)||!checkMappingSemanticEvidence({label:material.title,tpItems:[objective]}).hardConflict)fail(`Relasi '${id}' tidak boleh dilepas: bukti konflik sumber yang eksplisit belum tersedia.`);
      }
    }
    const before=action.type==='EDIT_UNIT_TITLE'?unit.title:action.type==='ADD_MATERIAL'?action.after:action.type==='RESTRUCTURE_UNIT'?unit.materials.map(m=>m.title).join('; '):material?.title;
    const after=action.type==='EDIT_UNIT_TITLE'||action.type==='EDIT_MATERIAL'||action.type==='ADD_MATERIAL'?action.after:before;
    if(typeof before!=='string'||typeof after!=='string'||!Array.isArray(action.linkedTpIds)||!action.linkedTpIds.length||!Array.isArray(check.evidence)){fail('Sumber, hasil, TP atau bukti tidak lengkap.');continue;}
    if(['ADD_MATERIAL','MOVE_MATERIAL'].includes(action.type)&&check.targetUnitQuote!==unit.title){fail('Konteks Bab tujuan belum diverifikasi.');continue;}
    if(action.type==='ADD_MATERIAL'&&(check.additionNecessary!==true||action.linkedTpIds.every(id=>units.some(u=>u.materials.some(m=>m.linkedTpIds.includes(id)))))){fail('Materi baru hanya untuk TP yang belum terwakili oleh materi existing.');continue;}
    for(const id of action.linkedTpIds){
      const objective=tp.items.find(t=>t.id===id),entries=check.evidence.filter(e=>e?.tpId===id);
      if(!objective){fail(`STRUCTURAL_CONFLICT: TP canonical '${id}' tidak ditemukan.`);continue;}
      if(!entries.length){fail(`Bukti sumber materi/TP '${id}' tidak dapat ditelusuri.`);continue;}
      for(const evidence of entries){
      if(!contains(objective.statement,evidence.tpQuote,12)||!contains(before,evidence.materialQuote,8)){fail(`Bukti sumber materi/TP '${id}' tidak dapat ditelusuri.`);continue;}
      const competence=(objective.competence || '').split(/[,;]/).map(value=>value.trim()).filter(Boolean);
      if(!contains(objective.statement,evidence.competenceQuote,4)||(action.type!=='LINK_TP'&&!contains(after,evidence.competenceQuote,4))||!competence.some(verb=>normalized(evidence.competenceQuote).includes(normalized(verb)))) fail(`Kompetensi TP '${id}' belum dinyatakan pada materi/hasil yang diusulkan; kesamaan kata bukan bukti.`);
      if(action.type==='LINK_TP'&&!contains(after,evidence.competenceQuote,4)&&!hasStep07LinkRationale(evidence))fail(`SEMANTIC_MISMATCH: TP '${id}' memerlukan penjelasan spesifik hubungan kompetensi dengan aktivitas materi, bukan kemiripan kata.`);
      const context=action.type==='ADD_MATERIAL'?unit.title:before;
      if(!contains(context,evidence.contextQuote,8)||!contains(after,evidence.contextQuote,8))fail(`Konteks substansi asli untuk TP '${id}' belum dipertahankan.`);
      if(checkMappingSemanticEvidence({label:after,tpItems:[objective]}).hardConflict)fail(`Konflik substansi eksplisit untuk TP '${id}'.`);
      if(checkMappingSemanticEvidence({label:action.type==='EDIT_UNIT_TITLE'?after:unit.title,tpItems:[objective]}).hardConflict)fail(`Konflik konteks Bab untuk TP '${id}'.`);
      }
    }
  }
  return issues;
}

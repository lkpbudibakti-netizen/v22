import type { ATPData, TPData, ATPUnitMapping, ATPUnitMappingData, Step07SemanticCheck } from '../types';
import type { AlignmentAction } from './mappingAlignmentService';
import { checkMappingSemanticEvidence } from '../../server/mappingSemanticEvidence';

export interface Step07AutoPermit {
  scope:'STEP07_AUTO_REPAIR';
  sourceKey:string;
  checks:Step07SemanticCheck[];
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

/** A scoped authority check, not a replacement semantic engine or canonical validator. */
export function validateStep07AutoExecution(units:ATPUnitMapping[],actions:AlignmentAction[],atp:ATPData,tp:TPData,permit:Step07AutoPermit,isExistingAutomatic:(action:AlignmentAction)=>boolean=()=>false):string[] {
  const issues:string[]=[];
  if(permit.scope!=='STEP07_AUTO_REPAIR'||!Array.isArray(permit.checks)||permit.sourceKey!==step07SourceKey(units,atp,tp)) return ['STEP07_SOURCE_CHANGED: sumber atau canonical berubah setelah verifikasi.'];
  for(const action of actions){
    const fail=(reason:string)=>issues.push(`${action.id}: ${reason}`);
    if(isExistingAutomatic(action))continue;
    const unit=units.find(u=>u.id===action.targetUnitId),source=units.find(u=>u.id===(action.sourceUnitId||action.targetUnitId));
    const material=source?.materials.find(m=>m.id===action.targetMaterialId);
    const matches=permit.checks.filter(check=>check?.actionId===action.id);
    const check=matches[0];
    if(!unit||!source||matches.length!==1||check?.verdict!=='SUPPORTED'||typeof check.reason!=='string'||!check.reason.trim()||(check.missingEvidence!==undefined&&(!Array.isArray(check.missingEvidence)||check.missingEvidence.length>0))){fail('NEEDS_REVIEW: verifikasi semantik independen belum mendukung tindakan.');continue;}
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
      const objective=tp.items.find(t=>t.id===id),evidence=check.evidence.find(e=>e?.tpId===id);
      if(!objective||!evidence||!contains(objective.statement,evidence.tpQuote,12)||!contains(before,evidence.materialQuote,8)){fail(`Bukti sumber materi/TP '${id}' tidak dapat ditelusuri.`);continue;}
      const competence=(objective.competence || '').split(/[,;]/).map(value=>value.trim()).filter(Boolean);
      if(!contains(objective.statement,evidence.competenceQuote,4)||!contains(after,evidence.competenceQuote,4)||!competence.some(verb=>normalized(evidence.competenceQuote).includes(normalized(verb)))) fail(`Kompetensi TP '${id}' belum dinyatakan pada materi/hasil yang diusulkan; kesamaan kata bukan bukti.`);
      const context=action.type==='ADD_MATERIAL'?unit.title:before;
      if(!contains(context,evidence.contextQuote,8)||!contains(after,evidence.contextQuote,8))fail(`Konteks substansi asli untuk TP '${id}' belum dipertahankan.`);
      if(checkMappingSemanticEvidence({label:after,tpItems:[objective]}).hardConflict)fail(`Konflik substansi eksplisit untuk TP '${id}'.`);
      if(checkMappingSemanticEvidence({label:action.type==='EDIT_UNIT_TITLE'?after:unit.title,tpItems:[objective]}).hardConflict)fail(`Konflik konteks Bab untuk TP '${id}'.`);
    }
  }
  return issues;
}

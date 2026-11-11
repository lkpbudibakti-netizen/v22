import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ATPUnitMappingManager} from '../src/components/ATPUnitMappingManager';
import {applyMinimalAlignment,hasTeacherMaterialSupport,type AlignmentAction} from '../src/services/mappingAlignmentService';
import {finalizeTeacherReviewedMapping,resolveATPUnitMappingReadiness} from '../src/services/atpMappingReadinessService';
import {createReadyV21WorkflowFixture} from './fixtures/v21ReadyWorkflowFixture';
import {saveStorageV5,getATPUnitMappingV5,saveATPUnitMappingV5} from '../src/services/storageV5';
import {resolveStep07CheckpointContext,writeStep07Checkpoint,step07CanonicalKey,step07UnitKey} from '../src/services/step07CheckpointService';
import {sanitizeMappingAnalysisResult} from '../server/mappingAnalysis';
import {initializer,evaluateExpression} from './helpers/uiContractHarness';
import {deriveMappingAtpIds} from '../src/services/atpMappingLineageService';
import {undoStep07AutoRepair} from '../src/services/step07AutoRepairService';
import type {ATPUnitMappingData,ATPData,TPData} from '../src/types';
const raw=JSON.parse(readFileSync('scripts/fixtures/pjokClass6RealProjectEvidence.json','utf8')) as {mapping:ATPUnitMappingData;atp:ATPData;tp:TPData};
const memory=new Map<string,string>();
(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)};
function seed(){memory.clear();const f=structuredClone(raw),s=createReadyV21WorkflowFixture();s.annualData.tp=[{yearPlanId:'y',value:f.tp}];s.annualData.atp=[{yearPlanId:'y',value:f.atp}];s.annualData.atpUnitMappings=[{yearPlanId:'y',value:f.mapping}];saveStorageV5(s);return f;}
const noop=()=>{};
function html(f:typeof raw){return renderToStaticMarkup(React.createElement(ATPUnitMappingManager,{...f,onSaveMapping:()=>true,onNextStep:noop,onBackToATP:noop}));}
const f=seed();
assert(!resolveATPUnitMappingReadiness(f.mapping,f.atp,f.tp).canProceed);
assert.strictEqual(finalizeTeacherReviewedMapping(f.mapping,f.atp,f.tp),f.mapping);
assert(html(f).includes('data-teacher-guidance='));assert(html(f).includes('ACC penyelarasan judul/relasi ke draf dan catat bukti guru'));
const declared=structuredClone(f);declared.mapping.units[0].linkedTpIds.push(f.tp.items[4].id);declared.mapping.units[0].linkedAtpItemIds=deriveMappingAtpIds(declared.mapping.units[0].linkedTpIds,f.atp,f.tp).atpItemIds;
assert(html(declared).includes('data-unit-coverage-guidance='));assert(html(declared).includes('Klaim Bab belum didukung materi'));
console.log('PASS 1: unresolved material exposes the existing teacher review form; merely linked IDs cannot finalize readiness');

const unit=f.mapping.units[0],material=unit.materials[0],ids=material.linkedTpIds.length?material.linkedTpIds:unit.linkedTpIds;
const action:AlignmentAction={id:'guide-test',type:'EDIT_MATERIAL',targetUnitId:unit.id,targetMaterialId:material.id,before:material.title,after:material.title+' — usulan perlu ditinjau',linkedTpIds:ids,reason:'Simulated proposal explaining the activity to review.',evidence:ids.map(id=>({tpId:id,tpQuote:f.tp.items.find(t=>t.id===id)!.statement,materialQuote:material.title}))};
const proposal=sanitizeMappingAnalysisResult({alignmentProposals:[action]},{currentMapping:f.mapping,atpData:f.atp,tpData:f.tp});
const context=resolveStep07CheckpointContext('y');
writeStep07Checkpoint({schemaVersion:1,revision:0,context,canonical:step07CanonicalKey(f.atp,f.tp),units:{[unit.id]:{source:step07UnitKey(unit),dependency:step07CanonicalKey(f.atp,f.tp),status:'NEEDS_TEACHER_REVIEW',stage:'VERIFY',proposal,applied:[],events:[{stage:'VERIFY',actionId:action.id,success:false,reason:'Perlu aktivitas konkret, bukan hanya kata kerja pada judul.'}]}},beforeUnits:f.mapping.units,baseStoredKey:'fixture',mode:'REPAIR'});
const guided=html(f);assert(guided.includes('usulan perlu ditinjau'));assert(guided.includes('Perlu aktivitas konkret'));assert(guided.includes('belum dinyatakan valid'));
const stale=structuredClone(f);stale.mapping.units[0].materials[0].title+=' manual edit';assert(!html(stale).includes('usulan perlu ditinjau'));
const canonical=structuredClone(f);canonical.tp.items[0].statement+=' sumber berubah';assert(!html(canonical).includes('usulan perlu ditinjau'));
console.log('PASS 2: saved proposals/rejections remain visible after reload; source/canonical drift hides stale advice');

let reviewed=structuredClone(f.mapping);
for(const original of f.mapping.units)for(const mat of original.materials){
  if(hasTeacherMaterialSupport(original,mat,f.tp))continue;
  const linkedTpIds=[...new Set([...mat.linkedTpIds,...original.linkedTpIds])];
  if(!linkedTpIds.length)linkedTpIds.push(f.tp.items[0].id);
  const a:AlignmentAction={id:'teacher-'+mat.id,type:'LINK_TP',targetUnitId:original.id,targetMaterialId:mat.id,before:mat.title,linkedTpIds,reason:'SIMULATION: teacher describes and confirms the activity supporting each selected canonical competence.',evidence:linkedTpIds.map(id=>({tpId:id,tpQuote:f.tp.items.find(t=>t.id===id)!.statement,materialQuote:mat.title}))};
  const result=applyMinimalAlignment(reviewed.units,[a],f.atp,f.tp,'TEACHER');assert(result.success,result.issues.join('; '));reviewed={...reviewed,units:result.nextUnits!};
}
assert(resolveATPUnitMappingReadiness(reviewed,f.atp,f.tp,undefined,{evaluateRepair:true}).canProceed);
assert(!resolveATPUnitMappingReadiness(reviewed,f.atp,f.tp).canProceed,'unfinished AI certificate remains blocked until explicit save');
let saved:ATPUnitMappingData|undefined,meta:any;
const save=evaluateExpression(initializer('src/components/ATPUnitMappingManager.tsx','handleSave'),{buildCurrentMappingDraft:()=>reviewed,finalizeTeacherReviewedMapping,atp:f.atp,tp:f.tp,academicSetting:undefined,resolveATPUnitMappingReadiness,validateATPUnitMappingCanonical:()=>resolveATPUnitMappingReadiness(reviewed,f.atp,f.tp).validationResult,onSaveMapping:(m:ATPUnitMappingData)=>{saved=m;saveATPUnitMappingV5('y',m);return true;},setAutoRepair:(v:any)=>meta=v,setHasChanges:noop,setSaveSuccessNotice:noop,setSaveErrorNotice:noop,setLocalValidationNotice:noop,setTimeout:noop});
assert(save());assert(meta?.outcome==='COMPLETE');assert(saved);assert(resolveATPUnitMappingReadiness(getATPUnitMappingV5('y'),f.atp,f.tp).canProceed);
assert.equal(saved.step07AutoRepair?.resultFingerprint,f.mapping.step07AutoRepair?.resultFingerprint || 'TEACHER_REVIEW_LEGACY_UNDO_UNAVAILABLE');assert(!undoStep07AutoRepair(saved,f.atp,f.tp).success,'old AI undo must not overwrite teacher edits');
const legacy=structuredClone(reviewed);delete legacy.step07AutoRepair!.resultFingerprint;assert(!undoStep07AutoRepair(finalizeTeacherReviewedMapping(legacy,f.atp,f.tp),f.atp,f.tp).success);
assert(!html({...f,mapping:getATPUnitMappingV5('y')!}).includes('data-teacher-guidance='));
console.log('PASS 3: actual Save handler closes a fully evidenced teacher review without AI; V5 reload enables Step08');

const changed=structuredClone(saved!);changed.units[0].materials[0].title+=' cakupan baru tanpa bukti';
assert(!resolveATPUnitMappingReadiness(finalizeTeacherReviewedMapping(changed,f.atp,f.tp),f.atp,f.tp).canProceed);
const gap=structuredClone(reviewed);gap.units[0].linkedTpIds.push('unknown-tp');
assert.strictEqual(finalizeTeacherReviewedMapping(gap,f.atp,f.tp),gap);assert(!resolveATPUnitMappingReadiness(gap,f.atp,f.tp).canProceed);
console.log('PASS 4: changed substance and invalid canonical references remain blocked; no fake completion');
console.log('PASS 4 teacher guidance scenarios. Teacher decisions and AI proposals are simulated; no live Gemini claim.');

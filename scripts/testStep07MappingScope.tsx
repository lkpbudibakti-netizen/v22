import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ATPUnitMappingManager} from '../src/components/ATPUnitMappingManager';
import {applyMinimalAlignment,hasTeacherMaterialSupport,type AlignmentAction} from '../src/services/mappingAlignmentService';
import {runStep07AutoRepair} from '../src/services/step07AutoRepairService';
import {step07SourceKey,STEP07_SEMANTIC_POLICY_VERSION} from '../src/services/step07AutoExecutionPolicy';
import {resolveATPUnitMappingReadiness,finalizeTeacherReviewedMapping} from '../src/services/atpMappingReadinessService';
import {validateATPUnitMappingCanonical} from '../src/services/atpUnitMappingValidationService';
import {deriveMappingAtpIds} from '../src/services/atpMappingLineageService';
import {buildMappingAnalysisPrompt,sanitizeMappingAnalysisResult} from '../server/mappingAnalysis';
import {checkMappingSemanticEvidence} from '../server/mappingSemanticEvidence';
import {saveStorageV5,saveATPUnitMappingV5,getATPUnitMappingV5} from '../src/services/storageV5';
import {resolveStep07CheckpointContext,readStep07Checkpoint,writeStep07Checkpoint,step07UnitKey,step07CanonicalKey} from '../src/services/step07CheckpointService';
import {createReadyV21WorkflowFixture} from './fixtures/v21ReadyWorkflowFixture';
import {createEmptyUnitExecutionPlanData} from '../src/services/unitExecutionPlanService';
import {createEmptyLearningPlan} from '../src/services/learningPlanService';
import type {ATPUnitMappingData,ATPData,TPData,Step07SemanticCheck} from '../src/types';
const f=JSON.parse(readFileSync('scripts/fixtures/pjokClass6RealProjectEvidence.json','utf8')) as {mapping:ATPUnitMappingData;atp:ATPData;tp:TPData};
const canonical=JSON.stringify([f.atp,f.tp]),originalTitles=f.mapping.units.map(u=>[u.title,...u.materials.map(m=>m.title)]);
// Explicit simulated teacher decisions prepare all other materials, not a live pedagogical verdict.
let mapping=structuredClone(f.mapping);
for(const u of f.mapping.units)for(const m of u.materials){
  if(hasTeacherMaterialSupport(u,m,f.tp))continue;
  const ids=[...new Set([...m.linkedTpIds,...u.linkedTpIds])];if(!ids.length)ids.push(f.tp.items[0].id);
  const a:AlignmentAction={id:'teacher-'+m.id,type:'LINK_TP',targetUnitId:u.id,targetMaterialId:m.id,before:m.title,linkedTpIds:ids,reason:'SIMULATED teacher review: the material scope and subject context are relevant to the selected canonical competencies.',evidence:ids.map(id=>({tpId:id,tpQuote:f.tp.items.find(t=>t.id===id)!.statement,materialQuote:m.title}))};
  const r=applyMinimalAlignment(mapping.units,[a],f.atp,f.tp,'TEACHER');assert(r.success,r.issues.join(';'));mapping.units=r.nextUnits!;
}
mapping=finalizeTeacherReviewedMapping(mapping,f.atp,f.tp);assert(resolveATPUnitMappingReadiness(mapping,f.atp,f.tp).canProceed);
const unit=mapping.units.find(u=>u.materials.some(m=>m.title==='Teknik dasar meluncur'))!,material=unit.materials.find(m=>m.title==='Teknik dasar meluncur')!;
const ids=f.tp.items.filter(t=>['E1-SKG-01','E1-SKG-02'].includes(t.code)).map(t=>t.id);assert.equal(ids.length,2);
unit.actionHistory=unit.actionHistory?.filter(h=>h.materialId!==material.id);material.titleHistory=[];material.linkedTpIds=[];material.linkedAtpItemIds=[];
unit.linkedTpIds=[...new Set([...unit.linkedTpIds,...ids])];unit.linkedAtpItemIds=deriveMappingAtpIds(unit.linkedTpIds,f.atp,f.tp).atpItemIds;
const before=structuredClone(mapping);
const action:AlignmentAction={id:'link-meluncur',type:'LINK_TP',targetUnitId:unit.id,targetMaterialId:material.id,before:material.title,linkedTpIds:ids,reason:'Teknik meluncur berada dalam cakupan keterampilan dan konsep gerak di air, relevan dengan kedua TP pada konteks PJOK Fase C.',evidence:ids.map(id=>({tpId:id,tpQuote:f.tp.items.find(t=>t.id===id)!.statement,materialQuote:material.title}))};
const check:Step07SemanticCheck={actionId:action.id,verdict:'SUPPORTED',reason:'Simulated independent relevance review: the scope of gliding is movement skill and movement concepts in water, within these canonical objectives.',missingEvidence:[],evidence:ids.map(id=>{const t=f.tp.items.find(t=>t.id===id)!;return {tpId:id,tpQuote:t.statement,materialQuote:material.title,competenceQuote:t.statement.includes('menginvestigasi')?'menginvestigasi':'menyesuaikan',contextQuote:material.title,relationshipReason:`Materi teknik meluncur termasuk keterampilan gerak di air dan konsep gerak yang mendasarinya. Cakupan ini relevan dengan TP ${t.code} dalam Bab olahraga air pada PJOK; tidak mencakup tujuan di luar konsep/keterampilan gerak.`};})};
const apply=(a=action,c=check)=>applyMinimalAlignment(before.units,[a],f.atp,f.tp,{scope:'STEP07_AUTO_REPAIR',sourceKey:step07SourceKey(before.units,f.atp,f.tp),checks:[c]});
assert(apply().success,apply().issues.join(';'));assert.equal(apply().nextUnits!.find(u=>u.id===unit.id)!.materials.find(m=>m.id===material.id)!.title,'Teknik dasar meluncur');
for(const verdict of ['CONFLICT','NEEDS_REVIEW'] as const){assert(!apply(action,{...check,verdict}).success);}
const badQuote=structuredClone(check);badQuote.evidence[0].competenceQuote='kompetensi palsu';assert(!apply(action,badQuote).success);
const absentReason=structuredClone(check);absentReason.evidence.forEach(e=>delete e.relationshipReason);assert(!apply(action,absentReason).success);
assert(!apply(action,{...check,missingEvidence:['Cakupan materi belum dapat dipastikan.']}).success);
// Actual substantive edit with no TP verb still needs independent relevance and exact source context.
assert(apply({...action,id:'edit-scope',type:'EDIT_MATERIAL',after:material.title+' dalam air'},{...check,actionId:'edit-scope'}).success);
console.log('PASS 1: meluncur ↔ E1-SKG-01/02 and a relevant edit pass with source-bound rationale, no activity or literal competence in title; incomplete/negative/forged proof fails');

const memory=new Map<string,string>();(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)};
Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_k:string,_o:any,cb:any)=>cb({})}});
const state=createReadyV21WorkflowFixture();state.annualData.tp=[{yearPlanId:'y',value:f.tp}];state.annualData.atp=[{yearPlanId:'y',value:f.atp}];state.annualData.atpUnitMappings=[{yearPlanId:'y',value:before}];saveStorageV5(state);
const context=resolveStep07CheckpointContext('y');let calls=0;
writeStep07Checkpoint({schemaVersion:1,revision:0,context,canonical:step07CanonicalKey(f.atp,f.tp),mode:'REPAIR',baseStoredKey:'legacy',beforeUnits:before.units,workingMapping:before,units:{[unit.id]:{source:step07UnitKey(unit),baseSource:step07UnitKey(unit),dependency:step07CanonicalKey(f.atp,f.tp),status:'NEEDS_TEACHER_REVIEW',stage:'VERIFY',applied:[],events:[{stage:'VERIFY',success:false,reason:'Legacy policy demanded concrete activity.'}],repairState:{sourceKey:step07SourceKey([unit],f.atp,f.tp),attempts:9,seen:['old-proposal'],failures:[],status:'NEEDS_TEACHER_REVIEW'}}}});
const result=await runStep07AutoRepair({mapping:before,persistedMapping:before,atp:f.atp,tp:f.tp,targetUnitId:unit.id,checkpointContext:context,isCurrent:()=>true,save:m=>{saveATPUnitMappingV5('y',m);return true;},analyze:async(m,r)=>{calls++;assert.equal(r.execution?.activeUnitId,unit.id);assert.equal(m.units.length,1);return r.phase==='VERIFY'?{summary:{} as any,atpFindings:[],materialFindings:[],step07SemanticChecks:[check]}:sanitizeMappingAnalysisResult({alignmentProposals:[action]},{currentMapping:m,atpData:f.atp,tpData:f.tp,step07Auto:r});}});
assert(result.saved,result.issues.join(';'));assert.equal(calls,2);assert(resolveATPUnitMappingReadiness(getATPUnitMappingV5('y'),f.atp,f.tp).canProceed);
assert.deepEqual(result.mapping.units.filter(u=>u.id!==unit.id),before.units.filter(u=>u.id!==unit.id));assert.equal(readStep07Checkpoint(context)!.units[unit.id].status,'DONE');
assert.equal(readStep07Checkpoint(context)!.units[unit.id].semanticPolicyVersion,STEP07_SEMANTIC_POLICY_VERSION);
assert(readStep07Checkpoint(context)!.invalidated?.some(i=>i.unitId===unit.id&&i.reason.includes('Kriteria relevansi')));assert(!readStep07Checkpoint(context)!.units[unit.id].events.some(e=>e.reason.includes('Legacy policy demanded')));
assert.deepEqual(result.mapping.units.map(u=>[u.title,...u.materials.map(m=>m.title)]),originalTitles);assert.equal(JSON.stringify([f.atp,f.tp]),canonical);
const execution=createEmptyUnitExecutionPlanData(result.mapping);assert.deepEqual(execution.units.map(u=>u.unitId),result.mapping.units.map(u=>u.id));assert(execution.units.every(u=>!u.meetings.length));
const learning=createEmptyLearningPlan({academicSetting:{id:'sp1'} as any,unitId:unit.id,tpIds:ids,atpItemIds:deriveMappingAtpIds(ids,f.atp,f.tp).atpItemIds,title:unit.title,topic:material.title,context:{tp:f.tp,atp:f.atp}});
assert.deepEqual(learning.tpIds,ids);assert.equal(learning.objectives.length,2);assert(!learning.learningExperiences.length);assert(!learning.learningSteps.core.length);assert(result.mapping.units.every(u=>u.materials.every(m=>!('activities' in m))));
const mismatch=structuredClone(result.mapping);const bad=mismatch.units.find(u=>u.id===unit.id)!.materials.find(m=>m.id===material.id)!;bad.linkedAtpItemIds=[f.atp.items.find(a=>!deriveMappingAtpIds(ids,f.atp,f.tp).atpItemIds.includes(a.id))!.id];assert(!validateATPUnitMappingCanonical(mismatch,f.atp,f.tp).isValid);assert(!resolveATPUnitMappingReadiness(mismatch,f.atp,f.tp).canProceed);
console.log('PASS 2: scoped PROPOSE/VERIFY/APPLY/SAVE, V5 reload, checkpoint and Step08 readiness stay consistent; other Bab and all titles/canonical sources unchanged; ATP mismatch fails');

const prompt=buildMappingAnalysisPrompt({currentMapping:before,atpData:f.atp,tpData:f.tp,subject:'PJOK',grade:'6',phase:'C',step07Auto:{scope:'STEP07_AUTO_REPAIR',phase:'VERIFY',actions:[action]} as any});
assert(prompt.includes('Subject: PJOK'));assert(prompt.includes('Aktivitas dirumuskan')||prompt.includes('aktivitas dirumuskan'));assert(!prompt.includes('jelaskan aktivitas konkret'));assert(!prompt.includes('EDIT/MOVE/ADD wajib juga terdapat pada hasil'));
const screen=renderToStaticMarkup(React.createElement(ATPUnitMappingManager,{mapping:before,atp:f.atp,tp:f.tp,onSaveMapping:()=>true,onNextStep:()=>{},onBackToATP:()=>{}}));assert(screen.includes('Alasan relevansi pemetaan'));assert(!screen.includes('Jelaskan aktivitas yang menunjukkan kompetensi TP'));
assert(checkMappingSemanticEvidence({label:'Teknik dasar meluncur',unitTitle:unit.title,tpItems:f.tp.items.filter(t=>ids.includes(t.id))}).ambiguous);
assert(checkMappingSemanticEvidence({label:'Penjumlahan pecahan',tpItems:[{statement:'Mempraktikkan teknik renang',contentScope:'renang'}]}).hardConflict);
console.log('PASS 3: prompt includes subject/Bab/canonical context; UI asks mapping relevance, lexical checker cannot reject an implicit title alone, explicit unrelated domains still conflict');
console.log('PASS 3 mapping-scope scenarios. Semantic verdicts and teacher decisions are mocked; Gemini live NOT VERIFIED.');

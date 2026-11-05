import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
// Schema enum values need no SDK/network dependencies in this isolated test.
const Type = { OBJECT:'OBJECT', ARRAY:'ARRAY', STRING:'STRING', NUMBER:'NUMBER', BOOLEAN:'BOOLEAN' };
import { validateGraduateProfileDimensions } from '../src/constants/graduateProfileDimensions';
import { generateLearningPlanWithAI } from '../src/services/aiService';
import React from 'react';
import { createAIDraftLearningPlan, isSubstantiveLearningPlanChange, validateLearningPlan } from '../src/services/learningPlanService';
import { validateLearningPlanActivityMeetings, updateLearningPlanActivityMeeting } from '../src/services/learningPlanActivityMeetingService';
// Execute the actual backend validator/schema without starting Express/Vite or loading unrelated broken dependencies.
const serverSource = readFileSync('server.ts', 'utf8');
const backendSource = serverSource.slice(serverSource.indexOf('function normalizeExperiencePhase('), serverSource.indexOf("app.post('/api/ai/generate-learning-plan'"));
assert(backendSource.includes('export function validateAILearningPlanPayload'));
const backendExports: any = {};
runInNewContext(ts.transpileModule(backendSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: backendExports, Type, validateGraduateProfileDimensions, validateLearningPlanActivityMeetings });
const { validateAILearningPlanPayload, learningPlanResponseSchema, buildLearningPlanRepairPrompt } = backendExports;
assert(serverSource.includes('validateAILearningPlanPayload(parsed, meetings, academicSetting)'));
assert(serverSource.includes('validateAILearningPlanPayload(repairedParsed, meetings, academicSetting)'));
const meetings = [3,1,2].map(order=>({meetingId:'meeting-'+order, order, title:'Same title', jp:2}));
const ids=meetings.map(m=>m.meetingId);
const academicSetting:any={id:'sem',curriculumType:'KURIKULUM_MERDEKA',grade:'7',level:'SMP',subject:'PJOK',academicYear:'2025/2026'};
const payload: any = {
  title:'Unit', initialCompetency:'Prasyarat', graduateProfileDimensions:['Kemandirian'], resources:[{title:'Buku'}], learningModel:'Praktik',
  learningExperiences:['UNDERSTAND','APPLY','REFLECT'].map((phase,i)=>({id:'exp'+i,phase,description:'Aktivitas '+ids[i], learningMeetingId:ids[i]})),
  learningSteps:{
    opening:ids.map((id,i)=>({id:'open'+i,learningMeetingId:id,description:'Awal '+id,durationMinutes:10})),
    core:ids.map(id=>({id:'step'+id.split('-')[1],learningMeetingId:id,description:'Praktik khusus '+id,durationMinutes:60})),
    closing:ids.map((id,i)=>({id:'close'+i,learningMeetingId:id,description:'Akhir '+id,durationMinutes:10})),
  },
  assessmentPlan:Object.fromEntries(['initial','formative','summative'].map(type=>[type,[{type:type.toUpperCase(),description:'Asesmen '+type,linkedTpIds:['tp']}]])),
};
assert(validateAILearningPlanPayload(structuredClone(payload),meetings,academicSetting).isValid);
for(const value of ['dangling','meeting-1 ',1,null,undefined]) {
  const bad=structuredClone(payload);bad.learningExperiences[0].learningMeetingId=value;
  assert(!validateAILearningPlanPayload(bad,meetings,academicSetting).isValid,String(value));
}
const badStep=structuredClone(payload);badStep.learningSteps.core[0].learningMeetingId='other-unit';
assert(!validateAILearningPlanPayload(badStep,meetings,academicSetting).isValid);
const missing=structuredClone(payload);missing.learningExperiences.splice(0,1);
assert(!validateLearningPlanActivityMeetings(missing,ids,true).isValid);
assert('learningMeetingId' in learningPlanResponseSchema.properties.learningExperiences.items.properties);
for(const phase of ['opening','core','closing'] as const) assert('learningMeetingId' in learningPlanResponseSchema.properties.learningSteps.properties[phase].items.properties);
const repair=buildLearningPlanRepairPrompt({parsed:payload,tps:[],failedGroups:[],meetings});
assert(ids.every(id=>repair.includes(id)) && repair.includes('learningMeetingId EXACT'));

const create = (aiDraft:any, learningMeetingIds:string[]=ids)=>createAIDraftLearningPlan({academicSetting,curriculumType:'KURIKULUM_MERDEKA',unitId:'unit',learningMeetingIds,meetings:learningMeetingIds.length ? meetings : [],tpIds:['tp'],aiDraft});
const savedFetch=globalThis.fetch;
let responsePayload=payload;
let sent:any;
globalThis.fetch=async (_url, options)=>{sent=JSON.parse(String(options?.body));return new Response(JSON.stringify({data:structuredClone(responsePayload)}),{status:200,headers:{'Content-Type':'application/json'}});};
try {
  const result=await generateLearningPlanWithAI({academicSetting,tps:[{id:'tp'} as any],meetings});
  assert.deepEqual(sent.meetings,meetings.map(m=>({...m,minutesPerJP:40,durationMinutes:80})));
  const draft=create(JSON.parse(JSON.stringify(result)));
  assert.deepEqual(draft.learningExperiences!.map(e=>[e.description,e.learningMeetingId]),payload.learningExperiences.map((e:any)=>[e.description,e.learningMeetingId]));
  assert.equal(draft.learningSteps!.core![0].learningMeetingId,'meeting-3');
  assert.deepEqual(JSON.parse(JSON.stringify(draft)).learningExperiences.map((e:any)=>e.learningMeetingId),ids);
  responsePayload=structuredClone(payload);responsePayload.learningExperiences[0].learningMeetingId='dangling';
  await assert.rejects(()=>generateLearningPlanWithAI({academicSetting,tps:[{id:'tp'} as any],meetings}),/learningMeetingId/);
  assert.throws(()=>create(responsePayload),/learningMeetingId/);
  let manual={...draft,...updateLearningPlanActivityMeeting(draft,'experience',draft.learningExperiences![0].id,'meeting-2',ids)};
  assert.equal(manual.learningExperiences![0].learningMeetingId,'meeting-2');
  manual={...manual,...updateLearningPlanActivityMeeting(manual,'core','step1','meeting-3',ids)};
  assert.equal(JSON.parse(JSON.stringify(manual)).learningSteps.core.find((s:any)=>s.id==='step1').learningMeetingId,'meeting-3');
  assert(isSubstantiveLearningPlanChange(draft,manual));
  const unlinked={...manual,...updateLearningPlanActivityMeeting(manual,'experience',manual.learningExperiences![0].id,undefined,ids)};
  assert(!('learningMeetingId' in unlinked.learningExperiences![0]));
  assert.equal(unlinked.learningExperiences!.length,draft.learningExperiences!.length);
  assert.throws(()=>updateLearningPlanActivityMeeting(manual,'core','step1','dangling',ids));
  assert.throws(()=>updateLearningPlanActivityMeeting(manual,'core','step1','meeting-2',[]));
} finally {globalThis.fetch=savedFetch;}
const legacy=structuredClone(payload);
for(const e of legacy.learningExperiences) delete e.learningMeetingId;
delete legacy.learningSteps;
assert(validateAILearningPlanPayload(structuredClone(legacy)).isValid);
assert(validateLearningPlanActivityMeetings(legacy,ids).isValid);
const missingStepId = structuredClone(payload);
delete missingStepId.learningSteps.core[0].id;
const withStepId = create(missingStepId);
assert(withStepId.learningSteps!.core![0].id);
assert.equal(withStepId.learningSteps!.core![0].learningMeetingId, 'meeting-3');
const legacyDraft=create(legacy,[]);
assert(legacyDraft.learningExperiences!.every(e=>e.learningMeetingId===undefined));
assert.equal(legacyDraft.learningExperiences!.length,3);
const invalidManual = {...legacyDraft, learningExperiences:[{...legacyDraft.learningExperiences![0],learningMeetingId:'dangling'}]};
assert(validateLearningPlan(invalidManual,{}).errors.some(e=>e.includes('learningMeetingId')));
assert(!validateLearningPlan(legacyDraft,{}).errors.some(e=>e.includes('learningMeetingId')));
const editor=readFileSync('src/components/administration/LearningPlanManager.tsx','utf8');
for(const group of ['experience','opening','core','closing']) assert(editor.includes(`renderActivityMeetingSelector('${group}',`));
assert(editor.includes('handleUpdateActivePlan(updateLearningPlanActivityMeeting('));
assert(editor.includes('Global / Unit (tanpa pertemuan)'));
// Exercise the real JSX selector handler and the real onSavePlan path in isolation.
const editorExports: any = {};
const editorStart=editor.indexOf('  const handleUpdateActivePlan =');
const editorEnd=editor.indexOf('  const resolveSingleAtpForTp',editorStart);
const editorCode=editor.slice(editorStart,editorEnd).replace('  const renderActivityMeetingSelector =','  export const renderActivityMeetingSelector =');
const editorContext: any = {
  exports:editorExports, React, activePlan:create(payload),
  semesterScopes:[{unitId:'unit',learningMeetingIds:ids,meetings}],
  updateLearningPlanActivityMeeting,isSubstantiveLearningPlanChange,
  showNotification:()=>{}, onSavePlan:(candidate:any)=>{editorContext.activePlan=candidate;},
};
runInNewContext(ts.transpileModule(editorCode,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,editorContext);
let selection=editorExports.renderActivityMeetingSelector('experience',editorContext.activePlan.learningExperiences[0]);
selection.props.onChange({target:{value:'meeting-2'}});
assert.equal(editorContext.activePlan.learningExperiences[0].learningMeetingId,'meeting-2');
selection=editorExports.renderActivityMeetingSelector('core',editorContext.activePlan.learningSteps.core[0]);
selection.props.onChange({target:{value:'meeting-3'}});
assert.equal(editorContext.activePlan.learningSteps.core[0].learningMeetingId,'meeting-3');
selection=editorExports.renderActivityMeetingSelector('experience',editorContext.activePlan.learningExperiences[0]);
selection.props.onChange({target:{value:''}});
assert(!('learningMeetingId' in editorContext.activePlan.learningExperiences[0]));
assert.equal(editorContext.activePlan.learningExperiences.length,3);
console.log('PASS: 3-meeting AI linkage, invalid ID rejection, AI roundtrip, manual save/unlink, legacy global preservation and editor selector wiring.');

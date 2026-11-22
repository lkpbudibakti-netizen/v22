import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { validateLearningPlanActivityMeetings } from '../src/services/learningPlanActivityMeetingService';
import { createAIDraftLearningPlan, validateLearningPlan } from '../src/services/learningPlanService';
import { generateLearningPlanWithAI } from '../src/services/aiService';
import { createModulAjarRuntimeFixture } from './fixtures/modulAjarRuntimeFixture';
import { generateModulAjar } from '../src/services/documentEngine/generators/modulAjarGenerator';
import { validateGraduateProfileDimensions } from '../src/constants/graduateProfileDimensions';
import JSZip from 'jszip';
const meetings=[3,1,2].map(order=>({meetingId:'m'+order,jp:3,order,title:'Meeting '+order}));
const ids=meetings.map(m=>m.meetingId);
const context=createModulAjarRuntimeFixture();
Object.assign(context.academicSetting,{level:'SD',grade:'3',academicYear:'2025/2026'});
const plan=context.learningPlans[0];
plan.allocatedJP=9;context.learningMeetingSchedules[0].schedule.entries.forEach((entry:any)=>entry.jp=3);
context.atp.totalJP=9;context.atp.items[0].jp=6;context.atp.items[1].jp=3;
for(const [phase,duration] of [['opening',15],['core',75],['closing',15]] as const) {
  plan.learningSteps[phase]=meetings.map(m=>({id:phase+m.meetingId,learningMeetingId:m.meetingId,description:phase+' khusus '+m.meetingId,durationMinutes:duration}));
}
// Experiences approach the core; their optional durations do not add to the 105 minute step budget.
plan.learningExperiences=meetings.map((m,i)=>({id:'exp'+m.meetingId,learningMeetingId:m.meetingId,phase:['UNDERSTAND','APPLY','REFLECT'][i],description:'Pendekatan khusus '+m.meetingId,durationMinutes:75}));
assert(validateLearningPlanActivityMeetings(plan,ids,true,meetings,context.academicSetting).isValid);
assert(validateLearningPlan(plan,{...context}).valid);
for(const phase of ['opening','core','closing'] as const) {
  const bad=structuredClone(plan);bad.learningSteps[phase]=bad.learningSteps[phase].filter((step:any)=>step.learningMeetingId!=='m2');
  const result=validateLearningPlanActivityMeetings(bad,ids,true,meetings,context.academicSetting);
  assert(!result.isValid);assert(result.reason?.includes(phase) && result.reason.includes('m2'));
}
for(const value of [0,-1,NaN,Infinity,undefined,'15']) {
  const bad=structuredClone(plan);bad.learningSteps.opening[0].durationMinutes=value;
  assert(!validateLearningPlanActivityMeetings(bad,ids,true,meetings,context.academicSetting).isValid);
}
for(const mutation of [
  (bad:any)=>bad.learningSteps.opening[0].description=' ',
  (bad:any)=>bad.learningSteps.core[0].learningMeetingId='dangling',
  (bad:any)=>bad.learningSteps.closing[0].learningMeetingId=undefined,
  (bad:any)=>bad.learningSteps.core[0].durationMinutes=105,
  (bad:any)=>bad.learningSteps.closing=[],
  (bad:any)=>bad.learningSteps={core:bad.learningSteps.core},
  (bad:any)=>{delete bad.learningSteps;},
]) {
  const bad=structuredClone(plan);mutation(bad);
  assert(!validateLearningPlanActivityMeetings(bad,ids,true,meetings,context.academicSetting).isValid);
}
const twoSteps = structuredClone(plan);
twoSteps.learningSteps.core[0].durationMinutes=105;
twoSteps.learningSteps.closing=twoSteps.learningSteps.closing.filter((step:any)=>step.learningMeetingId!=='m3');
assert(!validateLearningPlanActivityMeetings(twoSteps,ids,true,meetings,context.academicSetting).isValid,'15 + 105 cannot replace 15 + 75 + 15');
assert(!validateLearningPlanActivityMeetings(plan,ids,true).isValid,'No JP inference');
const noSteps=structuredClone(plan);delete noSteps.learningSteps;
assert(!validateLearningPlanActivityMeetings(noSteps,ids,true,meetings,context.academicSetting).isValid,'Experiences never substitute for steps');
const short=structuredClone(plan);short.learningSteps.core[0].durationMinutes=70;
assert(validateLearningPlanActivityMeetings(short,ids,true,meetings,context.academicSetting).reason?.includes('105 menit'));
// Unit-wide correct total cannot hide an incorrect individual meeting budget.
const shifted=structuredClone(plan);shifted.learningSteps.core[0].durationMinutes=70;shifted.learningSteps.core[1].durationMinutes=80;
assert(!validateLearningPlanActivityMeetings(shifted,ids,true,meetings,context.academicSetting).isValid);
const server=readFileSync('server.ts','utf8');const backend:any={};
const chunk=server.slice(server.indexOf('function normalizeExperiencePhase('),server.indexOf("app.post('/api/ai/generate-learning-plan'"));
runInNewContext(ts.transpileModule(chunk,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:backend,Type:{OBJECT:'OBJECT',ARRAY:'ARRAY',STRING:'STRING',NUMBER:'NUMBER',BOOLEAN:'BOOLEAN'},validateLearningPlanActivityMeetings,validateGraduateProfileDimensions,
});
assert(backend.learningPlanResponseSchema.required.includes('learningSteps'));
for(const phase of ['opening','core','closing']) {
 const schema=backend.learningPlanResponseSchema.properties.learningSteps;
 assert(schema.required.includes(phase));
 for(const field of ['learningMeetingId','description','durationMinutes']) assert(schema.properties[phase].items.required.includes(field));
}
assert(backend.validateAILearningPlanPayload(structuredClone(plan),meetings,context.academicSetting).isValid);
assert(!backend.validateAILearningPlanPayload(noSteps,meetings,context.academicSetting).isValid);
const savedFetch=globalThis.fetch;let response=plan;
globalThis.fetch=async()=>new Response(JSON.stringify({data:structuredClone(response)}),{headers:{'Content-Type':'application/json'}});
try {
 const ai=await generateLearningPlanWithAI({academicSetting:context.academicSetting,tps:context.tp.items,meetings});
 const draft=createAIDraftLearningPlan({academicSetting:context.academicSetting,unitId:'unit',learningMeetingIds:ids,meetings,tpIds:plan.tpIds,aiDraft:ai});
 assert(validateLearningPlanActivityMeetings(draft,ids,true,meetings,context.academicSetting).isValid);
 response=short;
 await assert.rejects(()=>generateLearningPlanWithAI({academicSetting:context.academicSetting,tps:context.tp.items,meetings}),/105 menit/);
 assert.throws(()=>createAIDraftLearningPlan({academicSetting:context.academicSetting,learningMeetingIds:ids,meetings,tpIds:plan.tpIds,aiDraft:short}),/105 menit/);
} finally {globalThis.fetch=savedFetch;}
const doc=await generateModulAjar({...context,skipDownload:true});
const xml=await (await JSZip.loadAsync(await doc.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
const blocks=xml.slice(xml.indexOf('III. RENCANA PERTEMUAN'),xml.indexOf('IV. ASESMEN + KKTP'));
for(const order of [1,2,3]) {
 const start=blocks.indexOf('PERTEMUAN '+order+' —');const next=blocks.indexOf('PERTEMUAN '+(order+1)+' —');
 const block=blocks.slice(start,next<0?undefined:next);
 for(const label of ['Pendahuluan','Kegiatan Inti','Penutup']) assert((block.match(/<w:r>.*?<\/w:r>/gs) || []).some(run=>run.includes('<w:b/>') && run.includes('>'+label+'</w:t>')),label);
 for(const phase of ['opening','core','closing']) {
   assert(block.includes(phase+' khusus m'+order));
   for(const other of [1,2,3].filter(n=>n!==order)) assert(!block.includes(phase+' khusus m'+other));
 }
 assert(block.includes('Pendekatan khusus m'+order));
 assert.equal(block.split('75 Menit').length-1,1,'Experience approach is not displayed as a second time budget');
}
console.log('PASS: canonical 3 JP = 105, 15+75+15, missing/invalid phases, blank/dangling IDs, per-meeting budget isolation, server/client/factory validation and DOCX bold phase sections.');

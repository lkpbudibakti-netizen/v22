import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import JSZip from 'jszip';
import { createModulAjarRuntimeFixture } from './fixtures/modulAjarRuntimeFixture';
import { resolveLearningPlanMeetingBudgets, validateLearningPlanActivityMeetings } from '../src/services/learningPlanActivityMeetingService';
import { buildLearningPlanScopeUnits, createAIDraftLearningPlan, validateLearningPlan } from '../src/services/learningPlanService';
import { generateLearningPlanWithAI } from '../src/services/aiService';
import { resolveEffectiveSubjectSlots } from '../src/services/subjectScheduleService';
import { buildLearningMeetingScheduleData, resolveLearningMeetingSchedule } from '../src/services/learningMeetingScheduleService';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { generateModulAjar } from '../src/services/documentEngine/generators/modulAjarGenerator';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { validateGraduateProfileDimensions } from '../src/constants/graduateProfileDimensions';
import { createTwoSemesterAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { saveStorageV5, loadStorageV5, serializeBackupV5, parseBackupV5, STORAGE_KEY_V5 } from '../src/services/storageV5';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { importCompleteAdministrationProject } from '../src/services/administrationProjectImportService';
import { buildImportedProjectExportContext } from '../src/services/identityOnlyProjectExport';

// Actual Express route/schema/repair/validator code, with a deterministic provider boundary.
const source=readFileSync('server.ts','utf8');
const start=source.indexOf('function normalizeExperiencePhase(');
const routeStart=source.indexOf("app.post('/api/ai/generate-learning-plan'");
const routeEnd=source.indexOf('// 2. Endpoint: AI Assessment Package Generation',routeStart);
let route: any;let responses:any[]=[];const prompts:string[]=[];
const backend:any={};
const vm={exports:backend,Type:{OBJECT:'OBJECT',ARRAY:'ARRAY',STRING:'STRING',NUMBER:'NUMBER',BOOLEAN:'BOOLEAN'},
  console:{info:()=>{},warn:()=>{},error:()=>{}},validateGraduateProfileDimensions,validateLearningPlanActivityMeetings,resolveLearningPlanMeetingBudgets,
  app:{post:(_path:string,handler:any)=>{route=handler;}},resolveApiKey:()=> 'fixture-key',createAIClient:()=>({}),
  getCognitiveAdaptationProfile:()=>undefined,cleanAndParseJSON:(text:string)=>JSON.parse(text),
  generateContentWithRetry:async(_ai:any,request:any)=>{prompts.push(request.contents);return{text:JSON.stringify(responses.shift())};}};
runInNewContext(ts.transpileModule(source.slice(start,routeEnd),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,vm);
async function request(body:any) {let code=200,payload:any;await route({body},{status:(n:number)=>{code=n;return{json:(p:any)=>{payload=p;}};},json:(p:any)=>{payload=p;}});return{code,payload};}
const savedFetch=globalThis.fetch;
function fixture(level:string,grade:string,pattern:number[]) {
 const c=createModulAjarRuntimeFixture();Object.assign(c.academicSetting,{level,grade,academicYear:'2025/2026',subject:pattern.length===2?'Matematika':'PJOK'});
 const plan=c.learningPlans[0],weekly=pattern.reduce((a,b)=>a+b,0);
 c.unitExecutionPlan.semesterPlacement={mode:'CONTIGUOUS_BOUNDARY',semester1LastUnitId:'unit'};
 for(const m of c.unitExecutionPlan.units[0].meetings) delete m.jp;
 c.calendar={id:'calendar',academicSettingId:'sem',startDate:'2025-07-07',endDate:'2025-07-25',schoolDaysPerWeek:5,workflowStatus:'CONFIRMED',updatedAt:'calendar-stamp'};
 c.calendarDays=[];
 for(let i=0;i<19;i++){const d=new Date(Date.UTC(2025,6,7+i));if(d.getUTCDay()>0&&d.getUTCDay()<6)c.calendarDays.push({id:String(i),date:d.toISOString().slice(0,10),status:'EFFECTIVE_LEARNING'});}
 c.subjectWeeklySchedule={semesterPlanId:'sem',sessions:pattern.map((jp,i)=>({id:'session'+i,jp,order:i+1,dayOfWeek:1})),basedOnWeeklyJP:weekly,updatedAt:'schedule-stamp'};
 c.semesterJPSetting={semesterPlanId:'sem',actualScheduledWeeklyJP:weekly,source:'SEMESTER_OVERRIDE'};
 const slots=resolveEffectiveSubjectSlots({semesterPlanId:'sem',schedule:c.subjectWeeklySchedule,expectedWeeklyJP:weekly,calendar:c.calendar,calendarDays:c.calendarDays});assert(slots.isReady);
 const auto=resolveLearningMeetingSchedule({semesterPlanId:'sem',semester:1,mapping:c.atpUnitMapping,unitExecutionPlan:c.unitExecutionPlan,subjectSlotResult:slots});assert(auto.isComplete);
 c.learningMeetingSchedules=[{semesterPlanId:'sem',semester:1,schedule:buildLearningMeetingScheduleData({semesterPlanId:'sem',semester:1,mapping:c.atpUnitMapping,unitExecutionPlan:c.unitExecutionPlan,subjectWeeklySchedule:c.subjectWeeklySchedule,expectedWeeklyJP:weekly,calendar:c.calendar,autoResult:auto,manualOverrides:[]})}];
 const scope=buildLearningPlanScopeUnits(c)[0];assert(scope?.meetings?.length===3);
 const budgets=resolveLearningPlanMeetingBudgets(scope.meetings!,c.academicSetting);assert(budgets.isValid);
 plan.learningMeetingIds=scope.learningMeetingIds;plan.allocatedJP=scope.jp;
 for(const phase of ['opening','core','closing'])plan.learningSteps[phase]=budgets.meetings.map(m=>({id:phase+m.meetingId,learningMeetingId:m.meetingId,description:phase+' '+m.meetingId,durationMinutes:phase==='core'?m.durationMinutes-20:10}));
 plan.learningExperiences=budgets.meetings.map((m,i)=>({id:'exp'+i,learningMeetingId:m.meetingId,phase:['UNDERSTAND','APPLY','REFLECT'][i],description:'Pendekatan '+m.meetingId,durationMinutes:m.durationMinutes-20}));
 return{c,plan,scope,budgets};
}

try {
 for(const [level,grade,pattern,first] of [['SD','3',[3],105],['SMP','7',[3],120],['SMA','10',[2],90],['SD','3',[3,2],105]] as const) {
  const {c,plan,scope,budgets}=fixture(level,grade,[...pattern]);const before=JSON.stringify(c);
  assert.equal(budgets.meetings[0].durationMinutes,first);
  if(pattern.length===2){assert.equal(budgets.meetings[1].durationMinutes,70);assert.equal(scope.meetings![0].date,scope.meetings![1].date);assert.notEqual(scope.meetings![0].meetingId,scope.meetings![1].meetingId);}
  assert(validateLearningPlan(plan,c).valid,validateLearningPlan(plan,c).errors.join(';'));
  responses=[plan];prompts.length=0;
  let sent:any;
  globalThis.fetch=async(_url,options)=>{sent=JSON.parse(String(options?.body));const result=await request(sent);return new Response(JSON.stringify(result.payload),{status:result.code,headers:{'Content-Type':'application/json'}});};
  const response=await generateLearningPlanWithAI({academicSetting:c.academicSetting,tps:c.tp.items,meetings:scope.meetings});
  assert.deepEqual(sent.meetings,budgets.meetings);
  for(const m of budgets.meetings){assert(prompts[0].includes(m.meetingId));assert(prompts[0].includes(`anggaran durasi: ${m.durationMinutes} menit`));}
  const draft=createAIDraftLearningPlan({academicSetting:c.academicSetting,unitId:'unit',learningMeetingIds:scope.learningMeetingIds,meetings:scope.meetings,tpIds:plan.tpIds,aiDraft:response});
  assert(validateLearningPlanActivityMeetings(draft,scope.learningMeetingIds,true,scope.meetings,c.academicSetting).isValid);
  const bad=structuredClone(plan);bad.learningSteps.core[0].durationMinutes--;
  responses=[bad,bad];prompts.length=0;
  await assert.rejects(()=>generateLearningPlanWithAI({academicSetting:c.academicSetting,tps:c.tp.items,meetings:scope.meetings}),new RegExp(first+' menit'));
  assert.equal(prompts.length,2,'one existing provider repair attempt');assert(prompts[1].includes('durationMinutes')&&prompts[1].includes(String(first)));
  const validation=validateLearningPlan(bad,c);assert.equal(validation.needsReview,true);assert(validation.errors.some(e=>e.includes(first+' menit')));
  assert(!buildModulAjarProjection({...c,learningPlans:[bad]}).isReady);
  const projection=buildModulAjarProjection(c);assert(projection.isReady,projection.error);assert.equal(projection.meetings![0].durationMinutes,first);
  assert(projection.meetings!.every(m=>m.activityLines.filter(line=>line.includes('Pendekatan ')).every(line=>!line.includes('Menit')&&line.includes('pendekatan kegiatan inti'))),'experiences never add a second duration budget in PDF');
  const doc=await generateModulAjar({...c,skipDownload:true});const xml=await(await JSZip.loadAsync(await doc.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
  assert(xml.includes(first+' Menit'));
  const pdf=await generatePdfDocument('MODUL_AJAR',{...c,skipDownload:true});const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(await pdf.blob.arrayBuffer()),useSystemFonts:true});const parsed=await task.promise;let text='';
  for(let p=1;p<=parsed.numPages;p++)text+=(await(await parsed.getPage(p)).getTextContent()).items.map((i:any)=>i.str||'').join(' ');
  assert(text.includes(first+' Menit'));if(pattern.length===2){assert(xml.includes('70 Menit'));assert(text.includes('70 Menit'));}await task.destroy();
  assert.equal(JSON.stringify(c),before,'AI, validation and document generation preserve content');
  const offSlot=structuredClone(c);offSlot.calendarDays[1].status='HOLIDAY';assert(validateLearningPlan(plan,offSlot).valid);
  const holiday=structuredClone(c);holiday.calendarDays[0].status='HOLIDAY';assert.equal(validateLearningPlan(plan,holiday).needsReview,true);
  const changedJP=structuredClone(c);changedJP.learningMeetingSchedules[0].schedule.entries[0].jp++;
  assert.equal(validateLearningPlan(plan,changedJP).needsReview,true);
  const stale=structuredClone(c);stale.subjectWeeklySchedule.updatedAt='new-schedule-stamp';assert.equal(validateLearningPlan(plan,stale).needsReview,true);
 }
 const {c,scope}=fixture('SD','3',[3]);
 for(const setting of [{...c.academicSetting,level:''},{...c.academicSetting,level:123},{...c.academicSetting,curriculum:123},{...c.academicSetting,level:'SMK'},{...c.academicSetting,level:'SMP'},{...c.academicSetting,academicYear:'2025/2027'}]) {
   const count=prompts.length;await assert.rejects(()=>generateLearningPlanWithAI({academicSetting:setting,tps:c.tp.items,meetings:scope.meetings}));assert.equal(prompts.length,count);
   assert.equal((await request({academicSetting:setting,tps:c.tp.items,meetings:scope.meetings})).code,400);
 }
 for(const jp of [NaN,Infinity,0,-1,1.5])assert.equal(resolveLearningPlanMeetingBudgets([{meetingId:'m',jp}],c.academicSetting).isValid,false);
 // A supplied numeric budget cannot override the server's curriculum calculation.
 responses=[c.learningPlans[0]];const forged=await request({academicSetting:c.academicSetting,tps:c.tp.items,meetings:scope.meetings!.map(m=>({...m,minutesPerJP:1,durationMinutes:3}))});assert.equal(forged.code,200);
 assert(prompts.at(-1)!.includes('anggaran durasi: 105 menit'));
} finally {globalThis.fetch=savedFetch;}

// Real V5 round-trip/import path: corrected SMP activities survive; old 35-minute activities need review only.
const memory=new Map<string,string>();let writes=0;
(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{writes++;memory.set(k,v);},removeItem:(k:string)=>memory.delete(k)};
const state=createTwoSemesterAdministrationImportFixture();Object.assign(state.yearPlans[0],{level:'SMP',grade:'Kelas 7',phase:'D'});
for(const entry of state.semesterData.learningPlan)for(const plan of entry.value)plan.learningSteps!.core!.forEach(a=>a.durationMinutes=60);
saveStorageV5(state);saveStorageV5(parseBackupV5(serializeBackupV5(loadStorageV5())));
let context=buildImportedProjectExportContext(loadStorageV5(),'y');assert(buildModulAjarProjection(context).isReady);
const zip=await readCompleteProjectZip(await createCompleteProjectZip(loadStorageV5(),'y'));
const imported=importCompleteAdministrationProject(zip,{mode:'CONTINUE_EDITING',targetProfileId:'p2',targetSchoolId:'s2',documentDate:'2026-10-31'});
context=buildImportedProjectExportContext(loadStorageV5(),imported.yearPlanId);assert(buildModulAjarProjection(context).isReady);
const importedDoc=await generateModulAjar({...context,skipDownload:true});
const importedXML=await(await JSZip.loadAsync(await importedDoc.blob!.arrayBuffer())).file('word/document.xml')!.async('string');assert(importedXML.includes('80 Menit'));
const importedPDF=await generatePdfDocument('MODUL_AJAR',{...context,skipDownload:true});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const importedTask=getDocument({data:new Uint8Array(await importedPDF.blob.arrayBuffer()),useSystemFonts:true});
const importedParsed=await importedTask.promise;let importedText='';for(let p=1;p<=importedParsed.numPages;p++)importedText+=(await(await importedParsed.getPage(p)).getTextContent()).items.map((i:any)=>i.str||'').join(' ');
assert(importedText.includes('80 Menit'));await importedTask.destroy();
const legacy=loadStorageV5();const sp=legacy.semesterPlans.find(s=>s.yearPlanId===imported.yearPlanId&&s.semester===1)!;
legacy.semesterData.learningPlan.find(e=>e.semesterPlanId===sp.id)!.value[0].learningSteps!.core![0].durationMinutes=50;
saveStorageV5(legacy);const snapshot=memory.get(STORAGE_KEY_V5),beforeWrites=writes;
context=buildImportedProjectExportContext(loadStorageV5(),imported.yearPlanId);
const invalid=buildModulAjarProjection(context);assert.equal(invalid.isReady,false);assert(invalid.error?.includes('80 menit'));
assert.equal(writes,beforeWrites);assert.equal(memory.get(STORAGE_KEY_V5),snapshot);
assert.equal(loadStorageV5().semesterData.learningPlan.find(e=>e.semesterPlanId===sp.id)!.value[0].status,'SIAP','review is derived; no automatic stored status rewrite');
console.log('PASS duration by level: actual slots → request → server prompt/repair → client/factory validation → shared DOCX/PDF, holidays/staleness and immutable V5 reload/ZIP import/export.');

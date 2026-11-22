import { withCP4Health } from './fixtures/cp4BackendHealth';
import { inspectCP4Draft,validateCP4Input,planCP4Repair,stageCP4Proposal,applyCP4Proposal } from '../src/services/cpAnalysisDraft';
import { newCP4RequestId, initialCP4Trace } from '../src/services/cpAnalysisRun';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import ts from 'typescript';
import { handleCPAnalysisAI, buildCPAnalysisRequest, parseCPAnalysisJSON } from '../server/cpAnalysisAI';
import { validateAnalysisAI, understandingIssue, validateStep4Understanding, getUnderstandingTargets, createInitialAnalysisDraft, createUnderstandingPatches, applyUnderstandingPatches } from '../src/services/cpAnalysisAIContract';
import { analyzeCPWithAI } from '../src/services/aiService';
import { CPAnalysisAIError, createCPAnalysisDiagnosis, formatCPAnalysisDiagnosis, copyCPAnalysisDiagnosis } from '../src/services/cpAnalysisAIDiagnostics';
import { validateCPAnalysisDataWorkflow } from '../src/services/cpWorkflowService';
import { createInitialStorageV5, saveStorageV5, loadStorageV5 } from '../src/services/storageV5';
import type { CPAnalysisItem, CPElem } from '../src/types';

const elements:CPElem[]=[{id:'e1',code:'E1',name:'Bilangan',content:'Murid menjelaskan hubungan bilangan pecahan dan membandingkan nilai pecahan.'},{id:'e2',code:'E2',name:'Gerak',content:'Murid mempraktikkan gerak keseimbangan dan koordinasi gerak tubuh.'}];
const full={generalSummary:'Analisis pecahan dan gerak.',items:elements.map((e,index)=>({elementId:e.id,elementName:'AI name ignored',cpText:'AI source ignored',scopeCode:index?'GK':'BP',cpCompetence:index?'Mempraktikkan':'Menjelaskan',materialScope:e.name,meaningfulUnderstanding:index?'Koordinasi gerak tubuh berkaitan dengan gerak keseimbangan.':'Hubungan bilangan pecahan membantu membandingkan nilai pecahan.',suggestedTp:'Murid mampu '+e.content}))};
const input={cpText:'',elements,subject:'Matematika',grade:'Kelas 7',phase:'D',curriculum:'Kurikulum Merdeka'};
const checked=validateAnalysisAI(full,elements);
assert.deepEqual(parseCPAnalysisJSON('```json\n'+JSON.stringify(full)+'\n```'),full);
assert.equal(parseCPAnalysisJSON('SECRET malformed provider payload'),null);
assert(checked.valid);
assert.equal(checked.items[0].cpText,elements[0].content);
assert.equal(checked.items[0].elementName,elements[0].name);
const built=buildCPAnalysisRequest(input);
assert(built.config.responseSchema.properties.items.items.required.includes('meaningfulUnderstanding'));
assert(built.config.responseSchema.properties.items.items.required.includes('elementId'));
assert(built.contents.includes('Jangan menambah topik'));
const complete=await handleCPAnalysisAI(input,async()=>full);
assert.equal(complete.status,200);assert.equal(complete.body.success,true);

const partial=structuredClone(full);partial.items[0].meaningfulUnderstanding=' ';
const part=await handleCPAnalysisAI(input,async()=>partial);
assert.equal(part.body.success,false);
assert(part.body.validation!.issues.some(i=>i.elementId==='e1'&&i.code==='MU_EMPTY'));
assert.equal(part.body.data!.items[1].meaningfulUnderstanding,full.items[1].meaningfulUnderstanding);
for(const value of [null,123,{},'', 'N/A','-', 'Topik astronomi membahas orbit planet dan galaksi.']) assert(understandingIssue(value,elements[0]));
assert.equal(understandingIssue('Bilangan pecahan berkaitan dengan orbit planet dan galaksi.',elements[0]),'MU_GROUNDING_REVIEW','CP overlap must not hide an unsupported topic');
assert.equal(understandingIssue(full.items[0].meaningfulUnderstanding,elements[0]),null);
assert.equal(understandingIssue(elements[0].content,elements[0]),'MU_INVALID','Copying the CP text is not an understanding');
const missing=validateAnalysisAI({items:[full.items[0]]},elements);
assert(missing.issues.some(i=>i.code==='ELEMENT_MISSING'&&i.elementId==='e2'));
const unknown=validateAnalysisAI({items:[...full.items,{elementId:'teacher@example.com'}]},elements);
assert(unknown.issues.some(i=>i.code==='CANONICAL_REFERENCE_INVALID'&&i.elementId===''));
assert.equal((await handleCPAnalysisAI(input)).body.success,false,'Local fallback may not pretend column 3 is complete');
assert.equal((await handleCPAnalysisAI({...input,elements:[]})).status,400);
assert.equal((await handleCPAnalysisAI({...input,elements:[null]})).status,400);
assert.equal((await handleCPAnalysisAI(input,async()=>{throw Error('SECRET provider text');})).body.code,'AI_PROVIDER_ERROR');
assert.equal((await handleCPAnalysisAI(input,async()=>{throw Error('timeout SECRET');})).status,504);
assert(!JSON.stringify(await handleCPAnalysisAI(input,async()=>{throw Error('SECRET');})).includes('SECRET'));
console.log('PASS: prompt/schema, per-element completeness/grounding, partial/missing/invalid responses, fallback and safe provider errors.');

const draft=createInitialAnalysisDraft(validateAnalysisAI(partial,elements),elements);
assert.equal(draft[0].meaningfulUnderstanding,'');
const old:CPAnalysisItem[]=[{...draft[0],id:'stable-1',cpCompetence:'Manual competence',materialScope:'Manual material',suggestedTp:'Manual TP'}, {...draft[1],id:'stable-2'}, {...draft[0],id:'manual-3',meaningfulUnderstanding:'Catatan manual guru'}];
const before=JSON.stringify(old);
const targets=getUnderstandingTargets(old,elements);
assert.deepEqual(targets.map(t=>t.itemId),['stable-1','manual-3']);
const retryInput={...input,retryTargets:targets};
assert.deepEqual(Object.keys(buildCPAnalysisRequest(retryInput).config.responseSchema.properties.items.items.properties).sort(),['elementId','itemId','meaningfulUnderstanding']);
const retried=validateAnalysisAI({items:targets.map(t=>({...t,cpCompetence:'Injected replacement',meaningfulUnderstanding:full.items[0].meaningfulUnderstanding}))},elements,targets);
assert(retried.valid);
const patches=createUnderstandingPatches(old,retried);
const partialRetry=validateAnalysisAI({items:[retried.items[0],{...retried.items[1],meaningfulUnderstanding:''}]},elements,targets);
assert(!partialRetry.valid);assert.equal(createUnderstandingPatches(old,partialRetry).length,1,'A failed sibling row in the same element must not discard a healthy retry');
assert.equal(patches.length,1,'Non-empty manual values must never be overwritten');
const applied=applyUnderstandingPatches(old,patches);
assert.equal(applied[0].id,'stable-1');assert.equal(applied[0].cpCompetence,'Manual competence');assert.equal(applied[0].suggestedTp,'Manual TP');assert.equal(applied[0].materialScope,'Manual material');
assert.deepEqual(applied[1],old[1]);assert.deepEqual(applied[2],old[2]);
assert.equal(JSON.stringify(old),before);
assert.equal(applyUnderstandingPatches([{...old[0],meaningfulUnderstanding:'Concurrent edit'}],patches)[0].meaningfulUnderstanding,'Concurrent edit');
assert(!validateAnalysisAI({items:[retried.items[0],retried.items[0]]},elements,targets).valid);
assert(!validateAnalysisAI({items:[{itemId:'unrelated',elementId:'e1',meaningfulUnderstanding:'bad'}]},elements,targets).valid);
assert.equal((await handleCPAnalysisAI(retryInput)).status,503);
assert.equal(validateStep4Understanding(applied,elements).length,0,'Legacy manual prose must not be subjected to AI vocabulary restrictions');
console.log('PASS: row-keyed retry, column isolation, canonical IDs, partial success, manual protection and concurrent edit guard.');

const originalFetch=globalThis.fetch;
try {
  globalThis.fetch=withCP4Health(async()=>new Response(JSON.stringify(complete.body),{headers:{'Content-Type':'application/json'}}));
  assert((await analyzeCPWithAI(input)).validation!.valid);
  globalThis.fetch=withCP4Health(async()=>new Response(JSON.stringify(part.body),{headers:{'Content-Type':'application/json'}}));
  assert(!(await analyzeCPWithAI(input)).validation!.valid);
  globalThis.fetch=withCP4Health(async()=>new Response('<html>SECRET</html>'));
  await assert.rejects(()=>analyzeCPWithAI(input),(e:any)=>e.code==='RESPONSE_INVALID'&&!e.message.includes('SECRET'));
  globalThis.fetch=withCP4Health(async()=>new Response(JSON.stringify({error:'SECRET API key token raw CP',code:'unknown'}),{status:500}));
  await assert.rejects(()=>analyzeCPWithAI(input),(e:any)=>e.code==='AI_API_ERROR'&&!e.message.includes('SECRET'));
  globalThis.fetch=withCP4Health(async()=>{throw Error('SECRET transport');});
  await assert.rejects(()=>analyzeCPWithAI(input),(e:any)=>e.code==='AI_API_ERROR'&&!e.message.includes('SECRET'));
  globalThis.fetch=withCP4Health(()=>new Promise<Response>(()=>{}));
  await assert.rejects(()=>analyzeCPWithAI(input,5),(e:any)=>e.code==='AI_TIMEOUT');
} finally {globalThis.fetch=originalFetch;}
console.log('PASS: actual client handles complete/partial payload, non-JSON, HTTP/network failure and bounded timeout without leaking provider text.');

const originalLocalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const persisted=new Map<string,string>();let writes=0;
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>persisted.get(key)??null,setItem:(key:string,value:string)=>{writes++;persisted.set(key,value);}}});
const state=createInitialStorageV5(),stamp='2026-10-29T00:00:00Z';
state.schools=[{id:'school',name:'Fixture school',npsn:'',address:'',village:'',district:'',regency:'',province:'',principalName:'',principalNip:'',createdAt:stamp,updatedAt:stamp}];
state.profiles=[{id:'teacher',name:'Fixture teacher',nip:'',status:'PNS',defaultSubject:'MAT',defaultLevel:'SMP',schoolId:'school',createdAt:stamp,updatedAt:stamp}];
state.yearPlans=[{id:'year-stable',profileId:'teacher',schoolId:'school',academicYear:'2026/2027',curriculumType:'KURIKULUM_MERDEKA',subject:'MAT',grade:'Kelas 7',phase:'D',level:'SMP',createdAt:stamp,updatedAt:stamp}];
state.workspaces=[{id:'workspace-stable',yearPlanId:'year-stable',profileId:'teacher',schoolId:'school',name:'Fixture workspace',createdAt:stamp,updatedAt:stamp}];
state.semesterPlans=[1,2].map(semester=>({id:`sp${semester}`,yearPlanId:'year-stable',semester:semester as 1|2,createdAt:stamp,updatedAt:stamp}));
state.annualData.cp=[{yearPlanId:'year-stable',value:{id:'cp-stable',academicSettingId:'year-stable',generalDescription:'',elements,updatedAt:stamp}}];
state.annualData.cpAnalysis=[{yearPlanId:'year-stable',value:{id:'analysis-stable',academicSettingId:'year-stable',cpId:'cp-stable',items:old,updatedAt:stamp}}];
state.annualData.tp=[{yearPlanId:'year-stable',value:{id:'tp-stable',items:[{id:'tp1',cpAnalysisId:'stable-1'}]} as any}];
state.annualData.atp=[{yearPlanId:'year-stable',value:{id:'atp-stable',items:[{id:'atp1',tpId:'tp1'}]} as any}];
saveStorageV5(state);const storedBefore=JSON.stringify([...persisted]),loadedBefore=loadStorageV5();writes=0;

// Run the actual component callbacks, not a duplicate implementation or substring contract.
const component=readFileSync('src/components/CPAnalysisManager.tsx','utf8');
const ast=ts.createSourceFile('component.tsx',component,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function handler(name:string,bindings:Record<string,any>) {
  let expression='';function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)expression=node.initializer!.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(expression,name);
  const js=ts.transpileModule(`return (${expression});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function(...Object.keys(bindings),js)(...Object.values(bindings));
}
function harness(rows:CPAnalysisItem[], answer:()=>Promise<any>) {
  const state:any={proposal:null,diagnoses:[],saved:[],items:rows,summary:'Manual summary'};
  const bindings:any={items:rows,approvedSuggestions:new Set(),aiProposal:null,generalSummary:'Manual summary',isAnalyzing:false,cp:{id:'cp-stable',generalDescription:'',elements,updatedAt:'2026-01-01'},cpAnalysis:{id:'analysis-stable',workspaceId:'workspace-stable',items:rows,needsReview:true,reviewReason:'Keep review',basedOnCpUpdatedAt:'2025-01-01'},
    reviewedSnapshot:'',context:input,academicSetting:{id:'year-stable'},activeAIRequest:{current:null},inspectCP4Draft,validateCP4Input,planCP4Repair,stageCP4Proposal,applyCP4Proposal,newCP4RequestId,initialCP4Trace,requestVersion:{current:0},latestItems:{current:rows},analyzeCPWithAI:answer,
    validateAnalysisAI,getUnderstandingTargets,createUnderstandingPatches,applyUnderstandingPatches,createInitialAnalysisDraft,CPAnalysisAIError,
    setAIProposal:(value:any)=>state.proposal=value,setItems:(value:any)=>state.items=value,reportAIError:(...args:any[])=>state.diagnoses.push(args),
    onSaveCPAnalysis:(value:any)=>state.saved.push(value)};
  for(const key of ['setApprovedSuggestions','setIsAnalyzing','setAnalysisError','setAIDiagnosis','setNotificationToast','setGeneralSummary','setHasUnsavedChanges','setIsReviewStale','setAIDraftEngine'])bindings[key]=()=>{};
  bindings.setGeneralSummary=(value:string)=>state.summary=value;
  return {state,bindings,run:()=>handler('executeAIAnalysis',bindings)(undefined,rows.length?'repair':'full')};
}
const aiRetry={items:retried.items,generalSummary:'Do not replace summary',engine:'gemini',validation:retried};
const existing=harness(old,async()=>aiRetry);await existing.run();
assert.equal(existing.state.saved.length,0);assert.deepEqual(existing.state.items,old);
handler('handleApplyAIProposal',{...existing.bindings,aiProposal:existing.state.proposal})();
assert.deepEqual(existing.state.items.slice(0,old.length),applied);assert(existing.state.items.slice(old.length).every((row:any)=>elements.some(e=>e.id===row.elementId)));assert.equal(existing.state.saved.length,0);
const initial=harness([],async()=>({...full,engine:'gemini',validation:checked}));await initial.run();
assert.equal(initial.state.items.length,0);assert(initial.state.proposal.items.length===2);assert.equal(initial.state.saved.length,0);
handler('handleApplyAIProposal',{...initial.bindings,aiProposal:initial.state.proposal})();
assert.equal(initial.state.summary,'Manual summary');assert.equal(initial.state.saved.length,0);
const readySave=harness(initial.state.items,async()=>full);
const ready=handler('handleSave',{...readySave.bindings,cp:{...readySave.bindings.cp,source:{id:'source-stable',title:'CP Matematika',verificationStatus:'UNVERIFIED'}},cpAnalysis:undefined,aiDraftEngine:'gemini',isCPOutdated:false,validateCPAnalysisDataWorkflow,validateStep4Understanding,setShowSavedToast:()=>{},setTimeout:()=>0})();
assert.equal(ready,true);assert.equal(readySave.state.saved[0].workflowStatus,'SIAP');assert.equal(readySave.state.saved[0].generatedBy,'AI');
const emptySave=harness(initial.state.items.map((item:CPAnalysisItem,index:number)=>index?item:{...item,meaningfulUnderstanding:''}),async()=>full);
const emptyReady=handler('handleSave',{...emptySave.bindings,cp:{...emptySave.bindings.cp,source:{id:'source-stable',title:'CP Matematika',verificationStatus:'UNVERIFIED'}},cpAnalysis:undefined,aiDraftEngine:'gemini',isCPOutdated:false,validateCPAnalysisDataWorkflow,validateStep4Understanding,setShowSavedToast:()=>{},setTimeout:()=>0})();
assert.equal(emptyReady,false);assert.equal(emptySave.state.saved[0].workflowStatus,'PERLU_DILENGKAPI');assert(emptySave.state.diagnoses[0][2].some((issue:any)=>issue.code==='MU_EMPTY'&&issue.elementId==='e1'));
const stale=harness(old,async()=>{stale.bindings.latestItems.current=[{...old[0],meaningfulUnderstanding:'Edited while waiting'}];return aiRetry;});await stale.run();assert.equal(stale.state.proposal,null);assert.equal(stale.state.diagnoses[0][0],'DRAFT_CHANGED');
const contextChange=harness(old,async()=>{contextChange.bindings.requestVersion.current++;return aiRetry;});await contextChange.run();assert.equal(contextChange.state.proposal,null);
for(const code of ['AI_TIMEOUT','AI_API_ERROR','RESPONSE_INVALID']) {
  const failed=harness(old,async()=>{throw new CPAnalysisAIError(code,code==='RESPONSE_INVALID'?'response':'transport');});await failed.run();
  assert.equal(failed.state.saved.length,0);assert.equal(failed.state.diagnoses[0][0],code);assert(failed.state.diagnoses[0][2].length>=1);assert(failed.state.diagnoses[0][2].every((issue:any)=>elements.some(e=>e.id===issue.elementId)));
}
const partialUI=harness([],async()=>({...partial,validation:validateAnalysisAI(partial,elements)}));await partialUI.run();assert.equal(partialUI.state.diagnoses[0][0],'VALIDATION_FAILED');
const coverageUI=harness([],async()=>({...full,validation:{...checked,valid:false,issues:[{elementId:'e1',field:'items',code:'CP_COVERAGE_REVIEW'}]}}));await coverageUI.run();assert(coverageUI.state.proposal.issues.some((issue:any)=>issue.code==='CP_COVERAGE_REVIEW'),'Coverage findings must survive in reviewable draft instead of discarding valid elements');
const save=harness(applied,async()=>aiRetry);
const savedOk=handler('handleSave',{...save.bindings,generalSummary:'Preserved summary',aiDraftEngine:'gemini',isCPOutdated:true,validateCPAnalysisDataWorkflow,validateStep4Understanding,setShowSavedToast:()=>{},setTimeout:()=>0})();
assert.equal(savedOk,false);assert.equal(save.state.saved[0].id,'analysis-stable');assert.equal(save.state.saved[0].workspaceId,'workspace-stable');assert.equal(save.state.saved[0].needsReview,true);assert.equal(save.state.saved[0].basedOnCpUpdatedAt,'2025-01-01');assert.deepEqual(save.state.saved[0].items,applied);assert.equal(save.state.saved[0].workflowStatus,'PERLU_DILENGKAPI');
console.log('PASS: actual UI callbacks stage complete/partial results, require explicit apply/save, reject stale context/edit, retain analysis IDs/review metadata.');
assert.equal(writes,0);assert.equal(JSON.stringify([...persisted]),storedBefore);assert.deepEqual(loadStorageV5(),loadedBefore);
if(originalLocalStorage)Object.defineProperty(globalThis,'localStorage',originalLocalStorage);else Reflect.deleteProperty(globalThis,'localStorage');
console.log('PASS: persisted CP, existing analysis, canonical CPAnalysisItem/TP lineage, ATP, profile and both semesters survive AI/retry/draft application and reload without writes.');

const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
let removed=0,clipboardText='',fallbackText='';
try {
  for(const code of ['AI_API_ERROR','AI_TIMEOUT','RESPONSE_INVALID','VALIDATION_FAILED']) {
    const diagnosis=createCPAnalysisDiagnosis(input,2,code,'validation',[{elementId:'e1',field:'meaningfulUnderstanding',code:'MU_EMPTY'}]);
    const report=formatCPAnalysisDiagnosis(diagnosis);
    for(const label of ['Waktu:','Build:','Step:','Mapel:','Fase:','Kelas:','Kode error:','Tahapan gagal:','Jumlah elemen:','ID elemen bermasalah:','Pesan error:','Ringkasan validasi:'])assert(report.includes(label));
    assert(!report.includes(elements[0].content));
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async(value:string)=>{clipboardText=value;}}}});
    assert.equal(await copyCPAnalysisDiagnosis(report),'copied');assert.equal(clipboardText,report);
    const local={copied:'',manual:false};
    await handler('handleCopyDiagnosis',{aiDiagnosis:diagnosis,context:input,cp:{elements},formatCPAnalysisDiagnosis,createCPAnalysisDiagnosis,copyCPAnalysisDiagnosis,setCopyStatus:(value:string)=>local.copied=value,setManualDiagnosisCopy:(value:boolean)=>local.manual=value})();
    assert.equal(local.copied,'Diagnosis disalin.');
  }
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{throw Error('Denied');}}}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{activeElement:null,body:{appendChild:(area:any)=>fallbackText=area.value},createElement:()=>({value:'',style:{},setAttribute:()=>{},select:()=>{},remove:()=>removed++}),execCommand:()=>true}});
  assert.equal(await copyCPAnalysisDiagnosis('safe report'),'copied');assert.equal(fallbackText,'safe report');assert.equal(removed,1);
  (globalThis.document as any).execCommand=()=>false;
  assert.equal(await copyCPAnalysisDiagnosis('safe report'),'manual');assert.equal(removed,2);
  let manual=false;
  await handler('handleCopyDiagnosis',{aiDiagnosis:createCPAnalysisDiagnosis(input,2,'AI_TIMEOUT','transport'),context:input,cp:{elements},formatCPAnalysisDiagnosis,createCPAnalysisDiagnosis,copyCPAnalysisDiagnosis,setCopyStatus:()=>{},setManualDiagnosisCopy:(value:boolean)=>manual=value})();assert(manual);
  const safeReport=formatCPAnalysisDiagnosis(createCPAnalysisDiagnosis({subject:'teacher@example.com',phase:'SECRET CP',grade:'teacher name'},2,'secret provider error','secret stage',[{elementId:'token=SECRET',field:'meaningfulUnderstanding',code:'MU_EMPTY'}]));
  assert(!safeReport.includes('SECRET'));assert(!safeReport.includes('teacher@example.com'));assert(!safeReport.includes('teacher name'));
} finally {
  if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else Reflect.deleteProperty(globalThis,'navigator');
  if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');
}
console.log('PASS: copy diagnosis for API/timeout/response/validation errors, Clipboard API, denied fallback, manual fallback, cleanup and privacy.');

if(process.argv.includes('--http')) {
  const portProbe=createServer();
  await new Promise<void>(resolve=>portProbe.listen(0,'127.0.0.1',resolve));
  const port=(portProbe.address() as {port:number}).port;
  await new Promise<void>(resolve=>portProbe.close(()=>resolve()));
  const server=spawn(process.execPath,['dist/server.cjs'],{env:{...process.env,NODE_ENV:'production',PORT:String(port),GEMINI_API_KEY:''},stdio:'ignore',windowsHide:true});
  try {
    const root=`http://127.0.0.1:${port}`;
    let ready=false;
    for(let attempt=0;attempt<200;attempt++) {
      if(server.exitCode!==null) throw Error('Production server exited before readiness');
      try {if((await fetch(root+'/api/health')).ok){ready=true;break;}} catch {}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(ready,'Production server readiness');
    const post=(body:unknown)=>fetch(root+'/api/ai/analyze-cp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const response=await post(input), body=await response.json();
    assert.equal(response.status,200);assert.equal(body.engine,'pedagogical_engine');assert.equal(body.success,false);
    assert(body.validation.issues.some((issue:any)=>issue.code==='MU_EMPTY'));
    const retry=await post(retryInput);assert.equal(retry.status,503);assert.equal((await retry.json()).code,'AI_NOT_CONFIGURED');
    assert.equal((await post({...input,elements:[null]})).status,400);
    console.log('PASS: built production HTTP route returns diagnosed local fallback, safe retry failure and rejects malformed canonical input. No live provider used.');
  } finally {
    server.kill();
    if(server.exitCode===null)await new Promise<void>(resolve=>server.once('exit',()=>resolve()));
  }
}

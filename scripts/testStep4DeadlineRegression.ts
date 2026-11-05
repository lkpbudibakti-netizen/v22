import { withCP4Health } from './fixtures/cp4BackendHealth';
import { validateCP4Input,planCP4Repair,stageCP4Proposal,applyCP4Proposal } from '../src/services/cpAnalysisDraft';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { GoogleGenAI } from '@google/genai';
import { runCP4Provider, serveCP4Analysis, CP4DeadlineError } from '../server/cpAnalysisDeadline';
import { buildCPAnalysisRequest } from '../server/cpAnalysisAI';
import { CP4_RUN_POLICY, CP4_MODEL, newCP4RequestId, initialCP4Trace, sanitizeCP4Trace } from '../src/services/cpAnalysisRun';
import { analyzeCPWithAI, GEMINI_API_KEY_STORAGE_KEY } from '../src/services/aiService';
import { CPAnalysisAIError, createCPAnalysisDiagnosis, formatCPAnalysisDiagnosis, copyCPAnalysisDiagnosis } from '../src/services/cpAnalysisAIDiagnostics';
import { SD_CP_ENTRIES } from '../src/data/curriculum/cp/sd';
import { validateAnalysisAI, getUnderstandingTargets, createUnderstandingPatches, applyUnderstandingPatches, createInitialAnalysisDraft } from '../src/services/cpAnalysisAIContract';
import { createInitialStorageV5, saveStorageV5, loadStorageV5 } from '../src/services/storageV5';

const entry=SD_CP_ENTRIES.find(e=>e.subjectCode==='BINDO'&&e.phase==='A')!;
const elements=entry.elements.map((e,index)=>({...e,id:`canonical-${index+1}`,code:`E${index+1}`}));
assert.equal(elements.length,4);
const input={cpText:entry.generalDescription || '',elements,subject:'Bahasa Indonesia',phase:'A',grade:'Kelas 2',curriculum:'Kurikulum Merdeka'};
const understanding=['Pemahaman pesan lisan berkaitan dengan informasi media audio.','Pemahaman membaca kata-kata berkaitan dengan pembaca dan pemirsa.','Pemahaman volume dan intonasi berkaitan dengan konteks berbicara.','Pemahaman keterampilan menulis permulaan berkaitan dengan postur tubuh.'];
const payload={generalSummary:'Analisis CP Bahasa Indonesia Fase A.',items:elements.map((e,index)=>({elementId:e.id,elementName:e.name,cpCompetence:'Memahami',scopeCode:`B${index}`,materialScope:e.name,meaningfulUnderstanding:understanding[index],suggestedTp:e.content}))};
assert(validateAnalysisAI(payload,elements).valid);
const request=buildCPAnalysisRequest(input);
const response=()=>({text:JSON.stringify(payload)});
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const statusError=(status:number)=>Object.assign(new Error('DO NOT COPY provider payload'),{status});
const run=(ms=5000,controller=new AbortController())=>({requestId:newCP4RequestId(),deadlineAt:Date.now()+ms,signal:controller.signal,keySource:'server' as const});
const quick={attemptMs:1000,maxAttempts:2,retryDelayMs:2};
let calls=0;
const success=await runCP4Provider(request,async(_,attempt)=>{calls++;assert.equal(attempt.model,CP4_MODEL);assert(!attempt.signal.aborted);return response();},run(),quick);
assert.equal(calls,1);assert.equal(success.trace.attempt,1);assert.equal(success.trace.attempts[0].outcome,'success');
const slow=await runCP4Provider(request,async()=>{await wait(15);return response();},run(),quick);
assert(slow.trace.elapsedMs>=10);
for(const status of [429,503]) {
  let retries=0;
  const result=await runCP4Provider(request,async()=>{retries++;if(retries===1)throw statusError(status);return response();},run(),quick);
  assert.equal(retries,2);assert.deepEqual(result.trace.attempts.map(a=>a.outcome),[String(status),'success']);
}
for(const status of [400,401,403,404]) {
  let attempts=0;
  await assert.rejects(()=>runCP4Provider(request,async()=>{attempts++;throw statusError(status);},run(),quick),(error:any)=>error.code==='AI_PROVIDER_ERROR'&&error.trace.attempt===1);
  assert.equal(attempts,1,'No speculative model/key switch');
}
calls=0;
await assert.rejects(()=>runCP4Provider(request,async()=>{calls++;throw statusError(503);},run(),quick),(error:any)=>error.code==='AI_PROVIDER_ERROR'&&error.trace.attempts.length===2);
assert.equal(calls,2);
let providerSignal:AbortSignal|undefined,lateCalls=0;
await assert.rejects(()=>runCP4Provider(request,async(_,attempt)=>{providerSignal=attempt.signal;lateCalls++;await wait(60);return response();},run(),{...quick,attemptMs:12}),
  (error:any)=>error.code==='AI_TIMEOUT'&&error.trace.timeoutSource==='provider'&&error.trace.attempts[0].outcome==='provider_timeout');
assert(providerSignal?.aborted);await wait(65);assert.equal(lateCalls,1,'Provider timeout never starts another generation');
await assert.rejects(()=>runCP4Provider(request,()=>new Promise(()=>{}),run(15),quick),(error:any)=>error.trace.timeoutSource==='server');
calls=0;
await assert.rejects(()=>runCP4Provider(request,async()=>{calls++;return response();},run(-1),quick),(error:any)=>error.trace.timeoutSource==='server'&&error.trace.attempt===0);assert.equal(calls,0);
for(const duringBackoff of [false,true]) {
  const controller=new AbortController();let attempts=0;
  const pending=runCP4Provider(request,async()=>{attempts++;if(duringBackoff)throw statusError(429);return new Promise(()=>{});},run(500,controller),{...quick,retryDelayMs:100});
  setTimeout(()=>controller.abort(),8);
  await assert.rejects(()=>pending,(error:any)=>error.code==='AI_ABORTED'&&error.trace.lastStage==='aborted');assert.equal(attempts,1);
}
console.log('PASS simulated provider: four-element success/slow, 429/503 bounded retry, fatal status, provider/server deadline, abort during generation/backoff, no retry after timeout/late completion.');

// Exercise the production endpoint coordinator with disconnect and replay protection.
function facade(id=newCP4RequestId(),deadline=Date.now()+CP4_RUN_POLICY.totalMs) {
  const req:any=Object.assign(new EventEmitter(),{body:input,aborted:false,get:(name:string)=>({'X-CP4-Request-ID':id,'X-CP4-Deadline':String(deadline)}[name])});
  const res:any=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,statusCode:0,body:null,writes:0,
    status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;this.writes++;this.writableEnded=true;return this;}});
  return {req,res};
}
const expired=facade(undefined,Date.now()-1);calls=0;
await serveCP4Analysis(expired.req,expired.res,'test-key',async()=>{calls++;return response();});
assert.equal(expired.res.statusCode,504);assert.equal(expired.res.body.trace.timeoutSource,'server');assert.equal(calls,0);
const id=newCP4RequestId(),one=facade(id),two=facade(id);calls=0;
const active=serveCP4Analysis(one.req,one.res,'test-key',async()=>{calls++;return new Promise(()=>{});});
await wait(2);await serveCP4Analysis(two.req,two.res,'test-key',async()=>{calls++;return response();});
assert.equal(two.res.statusCode,409);assert.equal(calls,1);one.res.emit('close');await active;assert.equal(one.res.writes,0);
const replay=facade(id);await serveCP4Analysis(replay.req,replay.res,'test-key',async()=>{calls++;return response();});assert.equal(replay.res.statusCode,409);assert.equal(calls,1);
const bad=facade();bad.req.body={elements:[null]};await serveCP4Analysis(bad.req,bad.res,'test-key',async()=>{throw Error('must not call');});assert.equal(bad.res.statusCode,400);
const disconnected=facade();providerSignal=undefined;
const pendingDisconnect=serveCP4Analysis(disconnected.req,disconnected.res,'test-key',async(_,attempt)=>{providerSignal=attempt.signal;return new Promise(()=>{});});
await wait(2);disconnected.req.aborted=true;disconnected.req.emit('aborted');await pendingDisconnect;assert(providerSignal?.aborted);assert.equal(disconnected.res.writes,0);
console.log('PASS endpoint coordinator: expired deadline before provider, duplicate/replayed request IDs, malformed request, disconnect propagation and no late writes.');

// Execute the real server route callback and installed SDK against a fake SDK HTTP fetch.
// This proves retries do not multiply inside the SDK, not just in our injected provider runner.
const serverAST=ts.createSourceFile('server.ts',readFileSync('server.ts','utf8'),ts.ScriptTarget.Latest,true);
let routeExpression='';
function findRoute(node:ts.Node) {
  if(ts.isCallExpression(node)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/api/ai/analyze-cp')routeExpression=node.arguments[1].getText(serverAST);
  ts.forEachChild(node,findRoute);
}
findRoute(serverAST);assert(routeExpression);
let sdkCalls=0;
const sdk=new GoogleGenAI({apiKey:'sdk-fixture-secret',httpOptions:{fetch:async(url)=>{
  sdkCalls++;assert(String(url).includes(CP4_MODEL));
  if(sdkCalls===1)return new Response(JSON.stringify({error:{code:429,status:'RESOURCE_EXHAUSTED',message:'fixture'}}),{status:429,headers:{'Content-Type':'application/json'}});
  return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(payload)}]},finishReason:'STOP'}]}),{headers:{'Content-Type':'application/json'}});
}}});
const routeJS=ts.transpileModule('return ('+routeExpression+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const route=new Function('resolveApiKey','serveCP4Analysis','createAIClient',routeJS)(()=> 'sdk-fixture-secret',serveCP4Analysis,()=>sdk);
const sdkRoute=facade();await route(sdkRoute.req,sdkRoute.res);
assert.equal(sdkRoute.res.statusCode,200);assert.equal(sdkCalls,2);assert.equal(sdkRoute.res.body.trace.attempt,2);assert.deepEqual(sdkRoute.res.body.trace.attempts.map((a:any)=>a.outcome),['429','success']);
console.log('PASS actual server route + installed Gemini SDK with mocked HTTP: original primary model, exactly 2 app attempts, SDK retry disabled, same request deadline. No Google network call.');

const nativeFetch=globalThis.fetch,storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const store=new Map<string,string>();let storageWrites=0;
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{storageWrites++;store.set(key,value);}}});
try {
  let network=0,signal:AbortSignal|undefined,lateResolve:(value:Response)=>void=()=>{};
  globalThis.fetch=withCP4Health(async(_,options)=>{network++;signal=options?.signal as AbortSignal;return new Promise<Response>(resolve=>lateResolve=resolve);});
  const timeout=analyzeCPWithAI(input,12);
  await assert.rejects(()=>timeout,(error:any)=>error.code==='AI_TIMEOUT'&&error.trace.timeoutSource==='client'&&error.trace.requestId.startsWith('cp4-')&&error.trace.elapsedMs>=10);
  assert(signal?.aborted);lateResolve(new Response(JSON.stringify({data:payload,engine:'gemini'}),{headers:{'Content-Type':'application/json'}}));await wait(2);assert.equal(network,1);
  const canceled=new AbortController();canceled.abort();network=0;
  await assert.rejects(()=>analyzeCPWithAI(input,{signal:canceled.signal}),(error:any)=>error.code==='AI_ABORTED');assert.equal(network,0);
  const controller=new AbortController();
  const aborted=analyzeCPWithAI(input,{signal:controller.signal});await wait(2);controller.abort();await assert.rejects(()=>aborted,(error:any)=>error.code==='AI_ABORTED');assert(signal?.aborted);
  network=0;const requestId=newCP4RequestId();
  const first=analyzeCPWithAI(input,{requestId});await wait(2);
  await assert.rejects(()=>analyzeCPWithAI(input,{requestId}),(error:any)=>error.code==='AI_DUPLICATE_REQUEST');assert.equal(network,1);
  lateResolve(new Response(JSON.stringify({data:payload,engine:'gemini'}),{headers:{'Content-Type':'application/json'}}));assert((await first).validation!.valid);
  store.set(GEMINI_API_KEY_STORAGE_KEY,'fixture-secret-key');network=0;
  globalThis.fetch=withCP4Health(async(_,options)=>{network++;const h=new Headers(options?.headers);assert.equal(h.get('X-Gemini-API-Key'),'fixture-secret-key');return new Response(JSON.stringify({code:'AI_NOT_CONFIGURED',stage:'provider'}),{status:503,headers:{'Content-Type':'application/json'}});});
  await assert.rejects(()=>analyzeCPWithAI(input),(error:any)=>error.code==='AI_NOT_CONFIGURED');assert.equal(network,1);assert.equal(store.get(GEMINI_API_KEY_STORAGE_KEY),'fixture-secret-key');
  for(const code of [401,403,429]) {
    network=0;globalThis.fetch=withCP4Health(async()=>{network++;return new Response('{}',{status:code});});await assert.rejects(()=>analyzeCPWithAI(input));assert.equal(network,1);
  }
  for(const source of ['server','provider'] as const) {
    const lastStage=source==='server'?'validation':'provider';
    globalThis.fetch=withCP4Health(async(_,options)=>{
      const trace={...initialCP4Trace(new Headers(options?.headers).get('X-CP4-Request-ID')!,'request'),timeoutSource:source,lastStage,model:CP4_MODEL,attempt:1,elapsedMs:30};
      return new Response(JSON.stringify({code:'AI_TIMEOUT',stage:lastStage,trace}),{status:504,headers:{'Content-Type':'application/json'}});
    });
    await assert.rejects(()=>analyzeCPWithAI(input),(error:any)=>error.trace.timeoutSource===source&&error.trace.attempt===1&&error.trace.model===CP4_MODEL&&error.stage===lastStage);
  }
  console.log('PASS client: one fetch/key choice only, duplicate guard, no chained auth/fallback retries, abort before/during fetch, client/server/provider timeout attribution, late transport ignored.');

  // Real local HTTP transport with the production coordinator and simulated provider, no Express dependency.
  let httpCalls=0;let mode:'ok'|'deadline'|'retry-column'='ok';
  const http=createServer(async(req,res)=>{
    try {
      let text='';for await(const chunk of req)text+=chunk;
      const r:any=req;r.body=JSON.parse(text);r.get=(name:string)=>req.headers[name.toLowerCase()];
      const out:any=res;out.status=(status:number)=>{res.statusCode=status;return out;};out.json=(body:any)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return out;};
      await serveCP4Analysis(r,out,'http-fixture-key',async()=>{
        httpCalls++;if(mode==='deadline')return new Promise(()=>{});
        if(mode==='retry-column')return {text:JSON.stringify({items:r.body.retryTargets.map((t:any)=>({elementId:t.elementId,itemId:t.itemId,meaningfulUnderstanding:understanding[elements.findIndex(e=>e.id===t.elementId)]}))})};
        return response();
      });
    } catch {res.statusCode=500;res.end('{}');}
  });
  await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
  const root=`http://127.0.0.1:${(http.address() as {port:number}).port}`;
  try {
    globalThis.fetch=withCP4Health((_,options)=>{
      const headers=new Headers(options?.headers);
      if(mode==='deadline')headers.set('X-CP4-Deadline',String(Date.now()+CP4_RUN_POLICY.responseReserveMs+500));
      return nativeFetch(root+'/api/ai/analyze-cp',{...options,headers});
    });
    const realHTTP=await analyzeCPWithAI(input);assert(realHTTP.validation!.valid);assert.equal(realHTTP.trace!.model,CP4_MODEL);assert.equal(realHTTP.trace!.attempt,1);
    mode='retry-column';const retryTargets=[{itemId:'stable-row-1',elementId:elements[0].id,cpCompetence:'Manual',materialScope:'Manual'}];
    const retry=await analyzeCPWithAI({...input,retryTargets});assert(retry.validation!.valid);assert.equal((retry.items[0] as any).itemId,'stable-row-1');assert.equal(retry.items[0].cpCompetence,'Manual');
    mode='deadline';await assert.rejects(()=>analyzeCPWithAI(input),(error:any)=>error.trace.timeoutSource==='server'&&error.trace.attempt===1);assert.equal(httpCalls,3);
  } finally {http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()));}
  console.log('PASS real local HTTP + simulated Gemini: full analysis, targeted column-3 retry, request ID correlation and server deadline round trip.');

  const ast=ts.createSourceFile('CPAnalysisManager.tsx',readFileSync('src/components/CPAnalysisManager.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function callback(bindings:any) {
    let expression='';function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='executeAIAnalysis')expression=node.initializer!.getText(ast);ts.forEachChild(node,visit);}visit(ast);
    const js=ts.transpileModule('return ('+expression+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    return new Function(...Object.keys(bindings),js)(...Object.values(bindings));
  }
  const rows=createInitialAnalysisDraft(validateAnalysisAI(payload,elements),elements).map((item,index)=>index?item:{...item,id:'stable-row-1',meaningfulUnderstanding:'',cpCompetence:'Manual competence',suggestedTp:'Manual TP'});
  const state=createInitialStorageV5(),stamp='2026-10-29T00:00:00Z';
  state.schools=[{id:'s',name:'Fixture',npsn:'',address:'',village:'',district:'',regency:'',province:'',principalName:'',principalNip:'',createdAt:stamp,updatedAt:stamp}];
  state.profiles=[{id:'p',name:'Fixture',nip:'',status:'PNS',schoolId:'s',defaultSubject:'BINDO',defaultLevel:'SD',createdAt:stamp,updatedAt:stamp}];
  state.yearPlans=[{id:'y',profileId:'p',schoolId:'s',academicYear:'2026/2027',curriculumType:'KURIKULUM_MERDEKA',subject:'BINDO',grade:'Kelas 2',phase:'A',level:'SD',createdAt:stamp,updatedAt:stamp}];
  state.workspaces=[{id:'w',yearPlanId:'y',profileId:'p',schoolId:'s',name:'Fixture',createdAt:stamp,updatedAt:stamp}];
  state.semesterPlans=[1,2].map(semester=>({id:`sp${semester}`,yearPlanId:'y',semester:semester as 1|2,createdAt:stamp,updatedAt:stamp}));
  state.annualData.cp=[{yearPlanId:'y',value:{id:'cp',academicSettingId:'y',generalDescription:input.cpText,elements,updatedAt:stamp}}];
  state.annualData.cpAnalysis=[{yearPlanId:'y',value:{id:'analysis',academicSettingId:'y',items:rows,updatedAt:stamp}}];
  state.annualData.tp=[{yearPlanId:'y',value:{id:'tp',items:[{id:'tp1',cpAnalysisId:'stable-row-1'}]} as any}];
  state.annualData.atp=[{yearPlanId:'y',value:{id:'atp',items:[{id:'atp1',tpId:'tp1'}]} as any}];
  saveStorageV5(state);const before=JSON.stringify([...store]),loaded=loadStorageV5();storageWrites=0;
  function ui(answer:()=>Promise<any>) {
    const output:any={saved:0,proposal:null,errors:[],busy:[]};
    const bindings:any={isAnalyzing:false,items:rows,aiProposal:null,cp:state.annualData.cp[0].value,context:input,activeAIRequest:{current:null},requestVersion:{current:0},latestItems:{current:rows},
      validateCP4Input,planCP4Repair,stageCP4Proposal,applyCP4Proposal,newCP4RequestId,initialCP4Trace,analyzeCPWithAI:answer,CPAnalysisAIError,validateAnalysisAI,getUnderstandingTargets,createUnderstandingPatches,createInitialAnalysisDraft,
      reportAIError:(...args:any[])=>output.errors.push(args),setAIProposal:(value:any)=>output.proposal=value,onSaveCPAnalysis:()=>output.saved++,setIsAnalyzing:(value:boolean)=>output.busy.push(value),setItems:()=>{throw Error('AI must not write editor values');}};
    for(const setter of ['setApprovedSuggestions','setNotificationToast','setAnalysisError','setAIDiagnosis'])bindings[setter]=()=>{};
    return {output,bindings,execute:callback(bindings)};
  }
  let resolveUI:(value:any)=>void=()=>{},generations=0;
  const double=ui(()=>{generations++;return new Promise(resolve=>resolveUI=resolve);});
  const job=double.execute();await double.execute();assert.equal(generations,1);double.bindings.activeAIRequest.current.controller.abort();
  resolveUI({items:payload.items,validation:validateAnalysisAI(payload,elements)});await job;assert.equal(double.output.proposal,null);assert.equal(double.output.errors[0][0],'AI_ABORTED');
  const stale=ui(async()=>{stale.bindings.requestVersion.current++;stale.bindings.activeAIRequest.current=null;return {validation:validateAnalysisAI(payload,elements)};});await stale.execute();assert.equal(stale.output.proposal,null);assert(!stale.output.busy.includes(false),'Old completion must not clear a new request busy flag');
  for(const source of ['client','server','provider'] as const) {
    const timeoutUI=ui(async()=>{throw new CPAnalysisAIError('AI_TIMEOUT',source==='client'?'transport':'provider',{...initialCP4Trace(newCP4RequestId(),'server'),timeoutSource:source,elapsedMs:37});});await timeoutUI.execute();
    assert.equal(timeoutUI.output.errors[0][3].timeoutSource,source);assert.equal(timeoutUI.output.saved,0);assert.equal(timeoutUI.output.proposal,null);
  }
  const preserved=ui(async()=>{throw new CPAnalysisAIError('AI_TIMEOUT','transport');});
  const previousProposal={base:JSON.stringify(rows),patches:[],suggestions:[],summary:'Earlier successful AI result'};
  preserved.output.proposal=previousProposal;await preserved.execute();assert.deepEqual(preserved.output.proposal,previousProposal,'A timeout must retain even the previous unapplied AI proposal');
  assert.equal(storageWrites,0);assert.equal(JSON.stringify([...store]),before);assert.deepEqual(loadStorageV5(),loaded);
  assert.equal(rows[0].id,'stable-row-1');assert.equal(rows[0].cpCompetence,'Manual competence');assert.equal(rows[0].suggestedTp,'Manual TP');
  console.log('PASS actual UI callbacks/storage: rapid duplicate click, abort/late response, context change, old finally/new request, all timeout sources, manual/CP/analysis/TP/ATP/profile/semester preserved after reload.');
} finally {globalThis.fetch=nativeFetch;if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else Reflect.deleteProperty(globalThis,'localStorage');}

const trace={...initialCP4Trace(newCP4RequestId(),'server'),timeoutSource:'provider' as const,lastStage:'provider' as const,elapsedMs:35_000,model:CP4_MODEL,attempt:1,attempts:[{attempt:1,elapsedMs:35_000,outcome:'provider_timeout' as const}]};
const report=formatCPAnalysisDiagnosis(createCPAnalysisDiagnosis(input,4,'AI_TIMEOUT','provider',[],trace));
for(const value of [trace.requestId,'35000 ms','Sumber timeout: provider',CP4_MODEL,'Percobaan: 1/2','Tahap terakhir: provider'])assert(report.includes(value));
assert(!report.includes('fixture-secret-key'));assert(!report.includes(elements[0].content));
assert.equal(sanitizeCP4Trace({...trace,model:'SECRET model',authorization:'SECRET',payload:input})!.model,null);
const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');let copied='';
try {Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async(text:string)=>copied=text}}});assert.equal(await copyCPAnalysisDiagnosis(report),'copied');assert.equal(copied,report);} finally {if(nav)Object.defineProperty(globalThis,'navigator',nav);else Reflect.deleteProperty(globalThis,'navigator');}
console.log('PASS safe copied diagnosis: request ID, duration, source, model/attempt, last stage; no raw provider text, credentials or CP payload.');

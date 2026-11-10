import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {analyzeATPUnitMappingWithAI,GEMINI_API_KEY_STORAGE_KEY} from '../src/services/aiService';
import {readStep07AnalysisResponse,readStep07Diagnostics,recordStep07Diagnostic,redactStep07Diagnostic,redactStep07PrivateContext,Step07AnalysisResponseError,STEP07_DIAGNOSTIC_LIMIT,STEP07_DIAGNOSTIC_BYTES,step07DiagnosticKey} from '../src/services/step07DiagnosticsService';
import {buildStep07FullDiagnosticReport} from '../src/services/step07FullDiagnosticReport';
import {resolveStep07CheckpointContext,step07CheckpointKey} from '../src/services/step07CheckpointService';
import {createReadyV21WorkflowFixture} from './fixtures/v21ReadyWorkflowFixture';
import {saveStorageV5} from '../src/services/storageV5';
import {ATPUnitMappingManager} from '../src/components/ATPUnitMappingManager';
import {copyCPAnalysisDiagnosis} from '../src/services/cpAnalysisAIDiagnostics';
import {evaluateExpression,initializer,routeCallback} from './helpers/uiContractHarness';
import {fallbackAnalyzeMapping,buildMappingAnalysisPrompt,sanitizeMappingAnalysisResult} from '../server/mappingAnalysis';
const memory=new Map<string,string>();(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)};
const state=createReadyV21WorkflowFixture();saveStorageV5(state);
const mapping=state.annualData.atpUnitMappings![0].value,atp=state.annualData.atp[0].value,tp=state.annualData.tp[0].value,context=resolveStep07CheckpointContext('y');
const params={currentMapping:mapping,atpData:atp,tpData:tp};
let count=0;async function test(name:string,run:()=>Promise<void>|void){await run();console.log('PASS '+(++count)+'. '+name);}
await test('200/503 HTML is rejected before reading a body or JSON; metadata persists without HTML',async()=>{
  const original=globalThis.fetch;
  try{for(const status of [200,503]){
    let bodyReads=0;const response=new Response('<!doctype html> SECRET_RAW_BODY',{status,headers:{'content-type':'text/html','x-request-id':'request-html-'+status}});
    response.text=async()=>{bodyReads++;throw Error('Must not read HTML');};response.json=async()=>{bodyReads++;throw Error('Must not parse HTML');};globalThis.fetch=async()=>response;
    await assert.rejects(analyzeATPUnitMappingWithAI(params,{diagnosticContext:context}),error=>error instanceof Step07AnalysisResponseError&&error.category==='API_NON_JSON_RESPONSE'&&error.metadata.httpStatus===status);
    assert.equal(bodyReads,0);
  }}finally{globalThis.fetch=original;}
  const buffer=readStep07Diagnostics(context);assert(buffer.events.some(e=>e.httpStatus===503&&e.contentType==='text/html'));assert(!JSON.stringify(buffer).includes('SECRET_RAW_BODY'));
});
await test('Mislabeled HTML and malformed JSON use typed categories without raw parse snippets',async()=>{
  for(const [body,category] of [['<!doctype html>API_KEY=SECRET_RAW_BODY','API_NON_JSON_RESPONSE'],['{"secret":"SECRET_RAW_BODY",','API_INVALID_JSON_RESPONSE']]){
    await assert.rejects(readStep07AnalysisResponse(new Response(body,{headers:{'content-type':'application/json'}}),{requestId:'req-json'}),e=>e instanceof Step07AnalysisResponseError&&e.category===category&&!e.message.includes('SECRET_RAW_BODY'));
  }
});
await test('HTTP JSON errors, successful fallback and abort carry status, request ID, duration and category',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'api_key=TOPSECRET Bearer HIDDEN_TOKEN'}),{status:400,headers:{'content-type':'application/problem+json'}});
    await assert.rejects(analyzeATPUnitMappingWithAI(params,{diagnosticContext:context}),e=>e instanceof Step07AnalysisResponseError&&e.category==='API_HTTP_ERROR'&&!e.message.includes('TOPSECRET')&&!e.message.includes('HIDDEN_TOKEN'));
    globalThis.fetch=async()=>new Response(JSON.stringify({engine:'pedagogical_engine',data:{summary:{},atpFindings:[],materialFindings:[]},diagnostic:{fallbackReason:'AI_NOT_CONFIGURED'}}),{headers:{'content-type':'application/json','x-request-id':'request-fallback'}});
    assert.equal((await analyzeATPUnitMappingWithAI(params,{diagnosticContext:context})).engine,'pedagogical_engine');
    const controller=new AbortController();globalThis.fetch=async(_url,init)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
    const run=analyzeATPUnitMappingWithAI(params,{signal:controller.signal,diagnosticContext:context});controller.abort();await assert.rejects(run,/API_ABORTED/);
  }finally{globalThis.fetch=original;}
  const events=readStep07Diagnostics(context).events;assert(events.some(e=>e.fallback==='AI_NOT_CONFIGURED'&&typeof e.durationMs==='number'));assert(events.some(e=>e.category==='API_ABORTED'));assert(events.every(e=>!JSON.stringify(e).includes('TOPSECRET')));
});
await test('Bounded persistent ring redacts secrets/identity, records drops, and survives storage failure in memory',()=>{
  const scope={...context,yearPlanId:'ring-test'};
  for(let i=0;i<400;i++)recordStep07Diagnostic(scope,{kind:'TEST',reason:`event-${i} api_key=TOPSECRET email=test@example.com nip=123456789012345678 Bearer HIDDEN_TOKEN ${'a'.repeat(1400)}`});
  const buffer=readStep07Diagnostics(scope),stored=memory.get(step07DiagnosticKey(scope))!;
  assert(buffer.events.length<=STEP07_DIAGNOSTIC_LIMIT);assert(stored.length<=STEP07_DIAGNOSTIC_BYTES);assert(buffer.dropped>0);assert(!stored.includes('TOPSECRET')&&!stored.includes('test@example.com')&&!stored.includes('123456789012345678'));
  recordStep07Diagnostic(scope,{kind:'PRIVATE',reason:state.profiles[0].name+' '+state.schools[0].address});assert(!JSON.stringify(readStep07Diagnostics(scope)).includes(state.profiles[0].name));
  const setter=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota');};recordStep07Diagnostic(scope,{kind:'MEMORY_ONLY',reason:'cannot persist'});assert(readStep07Diagnostics(scope).events.some(e=>e.kind==='MEMORY_ONLY'));assert(readStep07Diagnostics(scope).persistenceError);localStorage.setItem=setter;
  assert(!redactStep07Diagnostic('https://example.com/api?api_key=TOPSECRET <html>SECRET_HTML').includes('TOPSECRET'));
  assert(!redactStep07PrivateContext('Guru Nia; TP-ID-Nia tetap.',{identityFingerprint:JSON.stringify({profile:{name:'Nia'}})}).includes('Guru Nia'));
});
await test('Corrupt checkpoint still yields a complete safe report without resetting any checkpoint bytes',()=>{
  const key=step07CheckpointKey(context),raw='<!doctype html>SECRET_RAW_BODY';memory.set(key,raw);
  const report=buildStep07FullDiagnosticReport({mapping,atp,tp,context,error:'API_NON_JSON_RESPONSE'});
  assert(report.includes('CHECKPOINT_CORRUPT'));assert(report.includes('STATUS DAN ALASAN SETIAP BAB'));assert(report.includes('HTTP / REQUEST'));assert(report.includes('Build:'));assert(report.includes('Commit:'));assert.equal(memory.get(key),raw);
  assert(!report.includes('SECRET_RAW_BODY'));assert(!report.includes(state.profiles[0].name));assert(!report.includes(state.schools[0].principalNip));
});
await test('One always-enabled full diagnostic button; actual click controller supports manual and successful copy',async()=>{
  const html=renderToStaticMarkup(React.createElement(ATPUnitMappingManager,{mapping,atp,tp,onSaveMapping:()=>true,onNextStep:()=>{},onBackToATP:()=>{}}));
  assert.equal((html.match(/id="btn-copy-mapping-diagnostic"/g)||[]).length,1);assert(html.includes('Salin Diagnostik Lengkap'));assert(!html.match(/<button[^>]*id="btn-copy-mapping-diagnostic"[^>]*>/)![0].includes('disabled'));
  let manual='',notice='',copied='';
  const nav=navigator as any;Object.defineProperty(nav,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied');}}});
  const oldDoc=(globalThis as any).document;(globalThis as any).document={activeElement:null,createElement:()=>({style:{},setAttribute:()=>{},select:()=>{},remove:()=>{}}),body:{appendChild:()=>{}},execCommand:()=>false};
  try{
    const click=evaluateExpression(initializer('src/components/ATPUnitMappingManager.tsx','handleCopyDiagnostic'),{buildCurrentMappingDraft:()=>mapping,atp,tp,checkpointWork:undefined,analysisError:'API_NON_JSON_RESPONSE',buildStep07FullDiagnosticReport,copyCPAnalysisDiagnosis,redactStep07Diagnostic,setManualDiagnostic:(v:string)=>manual=v,setCopyDiagnosticNotice:(v:string)=>notice=v,setTimeout:()=>{}});
    await click();assert(manual.includes('CHECKPOINT_CORRUPT'));assert(notice.includes('Clipboard ditolak'));
    nav.clipboard.writeText=async(v:string)=>{copied=v;};await click();assert(copied.includes('STEP07 DIAGNOSTIK LENGKAP'));assert.equal(manual,'');assert(notice.includes('berhasil'));
  }finally{(globalThis as any).document=oldDoc;}
});
await test('Actual analysis endpoint echoes request metadata and classifies provider fallback without changing its engine',async()=>{
  const invoke=(apiKey:string|undefined,providerText='')=>routeCallback('server.ts','/api/ai/analyze-atp-unit-mapping',{resolveApiKey:()=>apiKey,createAIClient:()=>({}),generateContentWithRetry:async()=>({text:providerText}),buildMappingAnalysisPrompt,sanitizeMappingAnalysisResult,fallbackAnalyzeMapping,redactStep07Diagnostic});
  const req={get:()=> 'request-endpoint',body:params};let data:any,status=0;const headers:Record<string,string>={};const res:any={status:(v:number)=>{status=v;return res;},set:(k:string,v:string)=>{headers[k]=v;return res;},json:(v:any)=>{data=v;return v;}};
  await invoke(undefined)(req,res);assert.equal(status,200);assert.equal(data.engine,'pedagogical_engine');assert.equal(data.diagnostic.fallbackReason,'AI_NOT_CONFIGURED');assert.equal(headers['X-Request-ID'],'request-endpoint');assert(headers['Server-Timing']);
  await invoke('fake','<!doctype html>PROVIDER_SECRET')(req,res);assert.equal(data.diagnostic.fallbackReason,'AI_PROVIDER_INVALID_JSON');assert(!JSON.stringify(data).includes('PROVIDER_SECRET'));
  await invoke(undefined)({...req,body:{}},res);assert.equal(status,400);assert.equal(data.diagnostic.requestId,'request-endpoint');
  await invoke('fake',JSON.stringify({atpFindings:[],materialFindings:[],alignmentProposals:[]}))(req,res);assert.equal(data.engine,'gemini_ai');assert.equal(data.diagnostic.fallback,false);
});
await test('Step07 BYOK accepts the actual endpoint engine label, preserving HTTP/schema and semantic guards',async()=>{
  const original=globalThis.fetch;let requests=0;localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY,'FIXTURE_BYOK_NOT_A_SECRET');
  try{
    globalThis.fetch=async()=>new Response(JSON.stringify({engine:++requests===1?'pedagogical_engine':'gemini_ai',data:{summary:{},atpFindings:[],materialFindings:[]}}),{headers:{'content-type':'application/json'}});
    const result=await analyzeATPUnitMappingWithAI(params,{diagnosticContext:context});assert.equal(requests,2);assert.equal(result.engine,'gemini_ai','valid Step07 model response must not be discarded');
    const events=readStep07Diagnostics(context).events;assert(events.some(e=>e.category==='RETRY_ENGINE_ACCEPTED'&&e.engine==='gemini_ai'));assert(events.some(e=>e.kind==='HTTP_RESULT'&&e.engine==='gemini_ai'&&e.fallback==='NONE'));
    assert(!JSON.stringify(events).includes('FIXTURE_BYOK_NOT_A_SECRET'));
  }finally{globalThis.fetch=original;localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);}
});
console.log(`PASS ${count}/${count} Step07 observability cases. No live Gemini call.`);

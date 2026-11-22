import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createServer as createHTTPServer } from 'node:http';
import { analyzeCPWithAI } from '../src/services/aiService';
import { CP4_BACKEND_SERVICE, CP4_BACKEND_PROTOCOL } from '../src/services/cpAnalysisBackend';
import { newCP4RequestId } from '../src/services/cpAnalysisRun';
import { createCPAnalysisDiagnosis, formatCPAnalysisDiagnosis, copyCPAnalysisDiagnosis } from '../src/services/cpAnalysisAIDiagnostics';

const nativeFetch=globalThis.fetch;
const input={cpText:'',elements:[{id:'e1',name:'Bilangan',code:'E1',content:'Murid membandingkan bilangan.'}],subject:'Matematika',phase:'A',grade:'Kelas 2',curriculum:'Kurikulum Merdeka'};
const health=(id:string)=>({status:'ok',service:CP4_BACKEND_SERVICE,cpAnalysisProtocol:CP4_BACKEND_PROTOCOL,requestId:id});
try {
  for(const [status,mime,body,reason] of [
    [200,'text/html','<html>SECRET preview shell</html>','HTML'],
    [200,'application/json','<html>SECRET</html>','HTML'],
    [200,'application/json','{"status":"ok"}','CONTRACT'],
    [200,'application/json','{"status":','TRUNCATED'],
    [404,'application/json','{}','HTTP_ERROR'],
    [503,'text/html','SECRET','HTTP_ERROR'],
  ] as const) {
    let calls=0;
    globalThis.fetch=async(url,opts)=>{
      calls++;assert.equal(url,'/api/health');assert.equal(opts?.method,'GET');assert.equal(opts?.cache,'no-store');
      assert.equal(opts?.redirect,'error');assert.equal(opts?.body,undefined);assert(!new Headers(opts?.headers).has('X-Gemini-API-Key'));
      return new Response(body,{status,headers:{'Content-Type':mime}});
    };
    await assert.rejects(()=>analyzeCPWithAI(input),(e:any)=>{
      assert.equal(e.code,'BACKEND_UNAVAILABLE');assert.equal(e.responseInfo.reason,reason);
      const report=formatCPAnalysisDiagnosis(createCPAnalysisDiagnosis(input,1,e.code,e.stage,[],e.trace,e.responseInfo));
      assert(report.includes('health'));assert(report.includes('Request ID: cp4-'));assert(!report.includes('SECRET'));return true;
    });
    assert.equal(calls,1,'No AI POST or retry on failed backend check');
  }
  globalThis.fetch=async()=>{throw new TypeError('SECRET redirect or network error');};
  await assert.rejects(()=>analyzeCPWithAI(input),(e:any)=>e.code==='BACKEND_UNAVAILABLE'&&e.responseInfo.reason==='NETWORK_ERROR'&&!e.message.includes('SECRET'));
  let healthSignal:AbortSignal|undefined,lateHealth:(r:Response)=>void=()=>{},healthId='',healthCalls=0;
  globalThis.fetch=async(url,opts)=>{healthCalls++;assert.equal(url,'/api/health');healthId=new Headers(opts?.headers).get('X-CP4-Request-ID')!;healthSignal=opts?.signal as AbortSignal;return new Promise<Response>(resolve=>{lateHealth=resolve;});};
  await assert.rejects(()=>analyzeCPWithAI(input,15),(e:any)=>e.code==='AI_TIMEOUT'&&e.trace.timeoutSource==='client'&&e.responseInfo.phase==='health');
  assert(healthSignal?.aborted);lateHealth(new Response(JSON.stringify(health(healthId)),{headers:{'Content-Type':'application/json'}}));
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(healthCalls,1,'Late health never submits AI POST');
  const abort=new AbortController();const pending=analyzeCPWithAI(input,{signal:abort.signal});abort.abort();
  await assert.rejects(()=>pending,(e:any)=>e.code==='AI_ABORTED');
  const wrong=newCP4RequestId();
  globalThis.fetch=async()=>new Response(JSON.stringify(health(wrong)),{headers:{'Content-Type':'application/json'}});
  await assert.rejects(()=>analyzeCPWithAI(input),(e:any)=>e.code==='BACKEND_UNAVAILABLE');
  const report=formatCPAnalysisDiagnosis(createCPAnalysisDiagnosis(input,1,'BACKEND_UNAVAILABLE','transport',[],undefined,{source:'endpoint',reason:'HTML',phase:'health',httpStatus:200,mime:'html'}));
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let copied='';
  try {
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async(text:string)=>{copied=text;}}}});
    assert.equal(await copyCPAnalysisDiagnosis(report),'copied');assert.equal(copied,report);
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{throw Error('Denied');}}}});
    assert.equal(await copyCPAnalysisDiagnosis(report),'manual');
  } finally {if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else Reflect.deleteProperty(globalThis,'navigator');}
  console.log('PASS connection failures: HTML 200, wrong/stale backend, HTTP, JSON, network/redirect, timeout/abort; zero AI POST; safe copy/manual diagnosis.');
} finally {globalThis.fetch=nativeFetch;}

// Reproduce the observed AI Studio cookie-check redirect using real HTTP.
let apiPosts=0,cookiePages=0;
const preview=createHTTPServer((req,res)=>{
  if(req.url==='/__cookie_check.html'){cookiePages++;res.writeHead(200,{'Content-Type':'text/html'}).end('<html>Preview cookie check</html>');return;}
  if(req.method==='POST')apiPosts++;
  res.writeHead(302,{Location:'/__cookie_check.html'}).end();
});
await new Promise<void>(resolve=>preview.listen(0,'127.0.0.1',resolve));
const previewRoot=`http://127.0.0.1:${(preview.address() as {port:number}).port}`;
try {
  const misleading=await nativeFetch(previewRoot+'/api/ai/analyze-cp',{method:'POST',body:'{}'});
  assert.equal(misleading.status,200);assert(misleading.redirected);assert(misleading.headers.get('Content-Type')?.includes('text/html'));await misleading.text();
  apiPosts=0;cookiePages=0;
  globalThis.fetch=(url,opts)=>nativeFetch(previewRoot+url,opts);
  await assert.rejects(()=>analyzeCPWithAI(input),(e:any)=>e.code==='BACKEND_UNAVAILABLE'&&e.responseInfo.phase==='health');
  assert.equal(apiPosts,0);assert.equal(cookiePages,0,'No redirect followed into HTML shell');
  globalThis.fetch=(url,opts)=>String(url)==='/api/health'
    ? Promise.resolve(new Response(JSON.stringify(health(new Headers(opts?.headers).get('X-CP4-Request-ID')!)),{headers:{'Content-Type':'application/json'}}))
    : nativeFetch(previewRoot+url,opts);
  await assert.rejects(()=>analyzeCPWithAI(input),(e:any)=>e.code==='AI_API_ERROR');
  assert.equal(apiPosts,1);assert.equal(cookiePages,0,'Analysis POST also refuses redirects');
  console.log('PASS real HTTP redirect: legacy POST → 302 → cookie HTML 200 reproduced; health blocks AI POST and both requests reject redirects.');
} finally {globalThis.fetch=nativeFetch;await new Promise<void>(resolve=>preview.close(()=>resolve()));}

// Start the actual full Express application, not a replacement handler or an extracted callback.
for(const mode of ['development','production'] as const) {
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const child=spawn(process.execPath,mode==='production'?['dist/server.cjs']:['--import','tsx','server.ts'],{
    env:{...process.env,NODE_ENV:mode,PORT:String(port),GEMINI_API_KEY:'',DISABLE_HMR:'true'},stdio:'ignore',windowsHide:true});
  const exited=once(child,'exit');const root=`http://127.0.0.1:${port}`;
  try {
    let ready=false;
    for(let i=0;i<600;i++) {
      assert.equal(child.exitCode,null,`${mode} server exited before readiness`);
      try {const r=await nativeFetch(root+'/api/health',{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch {}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(ready,`${mode} readiness`);
    const id=newCP4RequestId(),response=await nativeFetch(root+'/api/health',{headers:{'X-CP4-Request-ID':id}});
    assert(response.headers.get('Content-Type')?.includes('application/json'));assert.equal(response.headers.get('Cache-Control'),'no-store');
    const body=await response.json();assert.equal(body.service,CP4_BACKEND_SERVICE);assert.equal(body.cpAnalysisProtocol,CP4_BACKEND_PROTOCOL);assert.equal(body.requestId,id);
    const page=await nativeFetch(root+'/');assert.equal(page.status,200);assert(page.headers.get('Content-Type')?.includes('text/html'));
    const invalid=await nativeFetch(root+'/api/ai/analyze-cp',{method:'POST',headers:{'Content-Type':'application/json','X-CP4-Request-ID':id},body:'{}'});
    assert.equal(invalid.status,400);assert(invalid.headers.get('Content-Type')?.includes('application/json'));
    const failure=await invalid.json();assert.equal(failure.code,'CP_ELEMENTS_REQUIRED');assert.equal(failure.trace.requestId,id);
    for(const method of ['GET','POST']) {
      const unknown=await nativeFetch(root+'/api/not-a-real-route',{method});assert.equal(unknown.status,404);assert(unknown.headers.get('Content-Type')?.includes('application/json'));
    }
    let requests=0;
    globalThis.fetch=(url,opts)=>{requests++;return nativeFetch(root+url,opts);};
    // Valid CP reaches the real route through the new health check. No key/provider is used.
    const result=await analyzeCPWithAI(input);assert.equal(result.engine,'pedagogical_engine');assert.equal(requests,2);
    assert.equal(result.trace?.attempt,0);assert.equal(result.items[0].elementId,'e1');
    console.log(`PASS ${mode} real HTTP: frontend HTML, fresh correlated JSON health, CP handler JSON 400, unknown API JSON 404, health → actual CP fallback; no Gemini invocation.`);
  } finally {globalThis.fetch=nativeFetch;child.kill();await exited;}
}

import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { CP4_RUN_POLICY, CP4_MODEL, initialCP4Trace, isCP4RequestId, newCP4RequestId, type CP4Trace } from '../src/services/cpAnalysisRun';
import { buildCPAnalysisRequest, handleCPAnalysisAI, parseCPAnalysisJSON } from './cpAnalysisAI';
import { CP4ResponseError, parseCP4JSON } from '../src/services/cpAnalysisResponse';
import { CP4_BACKEND_SERVICE } from '../src/services/cpAnalysisBackend';

export class CP4DeadlineError extends Error {
  constructor(public code:'AI_TIMEOUT'|'AI_ABORTED'|'AI_PROVIDER_ERROR', public trace:CP4Trace) {super(code);}
}
export interface CP4Attempt {model:string; signal:AbortSignal; timeoutMs:number; attempt:number}
type Generate = (request:ReturnType<typeof buildCPAnalysisRequest>, attempt:CP4Attempt)=>Promise<{text?:string}>;
export interface CP4ServerRun {
  requestId:string; deadlineAt:number; signal:AbortSignal; keySource:CP4Trace['keySource'];
}

// Abort/race protects our deadline even if an adapter ignores cancellation. A timeout is terminal:
// Gemini's AbortSignal stops local HTTP waiting, not guaranteed remote inference cancellation.
export async function runCP4Provider(request:ReturnType<typeof buildCPAnalysisRequest>, generate:Generate, run:CP4ServerRun,
  policy:{attemptMs:number;maxAttempts:number;retryDelayMs:number}=CP4_RUN_POLICY):Promise<{payload:unknown;trace:CP4Trace}> {
  const started=Date.now(),trace=initialCP4Trace(run.requestId,run.keySource);
  const fail=(code:CP4DeadlineError['code'],source:CP4Trace['timeoutSource']='none')=> {
    trace.elapsedMs=Date.now()-started;trace.timeoutSource=source;
    return new CP4DeadlineError(code,structuredClone(trace));
  };
  const check=()=>{if(run.signal.aborted){trace.lastStage='aborted';throw fail('AI_ABORTED');}if(Date.now()>=run.deadlineAt)throw fail('AI_TIMEOUT','server');};
  for(let attempt=1;attempt<=Math.min(2,policy.maxAttempts);attempt++) {
    check();
    trace.model=CP4_MODEL;trace.attempt=attempt;trace.lastStage='provider';
    const attemptStart=Date.now(),remaining=run.deadlineAt-attemptStart;
    const minAttemptBudget=Math.min(Math.floor(policy.attemptMs/3),8_000);
    if(attempt>1 && remaining<minAttemptBudget)throw fail('AI_PROVIDER_ERROR');
    const timeoutMs=Math.min(policy.attemptMs,remaining),source=remaining<=policy.attemptMs?'server':'provider';
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    let onAbort:()=>void=()=>{};
    try {
      const response=await Promise.race([
        Promise.resolve().then(()=>{check();return generate(request,{model:CP4_MODEL,signal:controller.signal,timeoutMs,attempt});}),
        new Promise<never>((_,reject)=>{
          onAbort=()=>{trace.lastStage='aborted';reject(fail('AI_ABORTED'));controller.abort();};
          run.signal.addEventListener('abort',onAbort,{once:true});
          if(run.signal.aborted) {onAbort();return;}
          timer=setTimeout(()=>{reject(fail('AI_TIMEOUT',source));controller.abort();},Math.max(1,timeoutMs));
        }),
      ]);
      check();
      if(Date.now()-attemptStart>=timeoutMs)throw fail('AI_TIMEOUT',source);
      trace.attempts.push({attempt,elapsedMs:Date.now()-attemptStart,outcome:'success'});
      trace.lastStage='response';trace.elapsedMs=Date.now()-started;
      return {payload:parseCP4JSON(response.text,{source:'provider'}),trace};
    } catch(error) {
      if(error instanceof CP4ResponseError){error.trace=structuredClone(trace);throw error;}
      if(error instanceof CP4DeadlineError) {
        trace.attempts.push({attempt,elapsedMs:Date.now()-attemptStart,outcome:error.code==='AI_ABORTED'?'aborted':error.trace.timeoutSource==='server'?'server_timeout':'provider_timeout'});
        throw fail(error.code,error.trace.timeoutSource);
      }
      // Retry only a proven transient HTTP status. Never switch model, key, or retry an ambiguous timeout.
      const status=Number((error as {status?:number})?.status);
      const sdkTimeout=error instanceof Error && /timeout|timed out|abort/i.test(error.name+' '+error.message);
      const deadlineExpired=Date.now()>=run.deadlineAt;
      trace.attempts.push({attempt,elapsedMs:Date.now()-attemptStart,httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:undefined,outcome:sdkTimeout?(deadlineExpired?'server_timeout':'provider_timeout'):status===429?'429':status===503?'503':status===504?'504':'provider_error'});
      if(sdkTimeout)throw fail('AI_TIMEOUT',Date.now()>=run.deadlineAt?'server':'provider');
      check();
      if(![429,503].includes(status) || attempt>=Math.min(2,policy.maxAttempts))throw fail('AI_PROVIDER_ERROR');
    } finally {clearTimeout(timer);run.signal.removeEventListener('abort',onAbort);}
    trace.lastStage='backoff';check();
    if(Date.now()+policy.retryDelayMs>=run.deadlineAt)throw fail('AI_TIMEOUT','server');
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(delay);trace.lastStage='aborted';reject(fail('AI_ABORTED'));};
      const delay=setTimeout(()=>{run.signal.removeEventListener('abort',abort);resolve();},policy.retryDelayMs);
      run.signal.addEventListener('abort',abort,{once:true});if(run.signal.aborted)abort();
    });
  }
  throw fail('AI_PROVIDER_ERROR');
}

// Only request identity + a hash scoped to the selected key are retained, never CP text or raw credentials.
const leases=new Map<string,number>();
export async function serveCP4Analysis(req:Request,res:Response, apiKey:string|null, generate:Generate|undefined) {
  const headerId=req.get('X-CP4-Request-ID');
  const requestId=isCP4RequestId(headerId)?headerId:newCP4RequestId();
  const started=Date.now(),clientDeadline=Number(req.get('X-CP4-Deadline'));
  const deadlineAt=Math.min(started+CP4_RUN_POLICY.serverMs,Number.isFinite(clientDeadline)&&clientDeadline>0?clientDeadline-CP4_RUN_POLICY.responseReserveMs:Infinity);
  const keySource:CP4Trace['keySource']=apiKey?(req.get('X-Gemini-API-Key')?.trim()?'request':'server'):'none';
  const identity=createHash('sha256').update(apiKey || 'unconfigured').update('\0').update(requestId).digest('hex');
  for(const [id,expires] of leases)if(expires<=started)leases.delete(id);
  if(typeof res.setHeader==='function') {
    res.setHeader('X-CP4-Request-ID', requestId);
    res.setHeader('X-CP4-Service', CP4_BACKEND_SERVICE);
    res.setHeader('Cache-Control', 'no-store');
  }
  if(leases.has(identity))return res.status(409).json({service:CP4_BACKEND_SERVICE,requestId,code:'AI_DUPLICATE_REQUEST',stage:'request',trace:initialCP4Trace(requestId,keySource)});
  if(leases.size>=512)return res.status(503).json({service:CP4_BACKEND_SERVICE,requestId,code:'AI_REQUEST_BUSY',stage:'request',trace:initialCP4Trace(requestId,keySource)});
  leases.set(identity,started+2*CP4_RUN_POLICY.totalMs);
  const controller=new AbortController();
  const abort=()=>controller.abort();
  const disconnected=()=>{if(!res.writableEnded)abort();};
  req.on('aborted',abort);res.on('close',disconnected);
  let trace=initialCP4Trace(requestId,keySource);
  try {
    if(req.aborted || res.destroyed)controller.abort();
    if(controller.signal.aborted)throw new CP4DeadlineError('AI_ABORTED',{...trace,lastStage:'aborted'});
    if(deadlineAt<=Date.now())throw new CP4DeadlineError('AI_TIMEOUT',{...trace,timeoutSource:'server'});
    const result=await handleCPAnalysisAI(req.body,generate?async request=>{
      try {
        const outcome=await runCP4Provider(request,generate,{requestId,deadlineAt,signal:controller.signal,keySource});
        trace=outcome.trace;return outcome.payload;
      } catch(error) {if(error instanceof CP4DeadlineError || (error instanceof CP4ResponseError && error.trace))trace=error.trace!;throw error;}
    }:undefined,true);
    if(controller.signal.aborted || res.destroyed || res.writableEnded || res.headersSent)return;
    trace.lastStage=result.body.stage==='provider'?'provider':'validation';
    trace.elapsedMs=Date.now()-started;
    if(typeof res.setHeader==='function' && !res.headersSent)res.setHeader('X-CP4-Elapsed-Ms', String(trace.elapsedMs));
    if(deadlineAt<=Date.now() && result.status===200)throw new CP4DeadlineError('AI_TIMEOUT',{...trace,timeoutSource:'server'});
    return res.status(result.status).json({service:CP4_BACKEND_SERVICE,requestId,...result.body,trace});
  } catch(error) {
    if(controller.signal.aborted || res.destroyed || res.writableEnded || res.headersSent)return;
    const elapsedMs = Date.now() - started;
    if(typeof res.setHeader==='function' && !res.headersSent)res.setHeader('X-CP4-Elapsed-Ms', String(elapsedMs));
    if(error instanceof CP4ResponseError)return res.status(502).json({service:CP4_BACKEND_SERVICE,requestId,code:'RESPONSE_INVALID',stage:'response',responseInfo:error.info,trace:{...trace,lastStage:'response',elapsedMs}});
    if(error instanceof CP4DeadlineError) {
      const lastAttempt = error.trace.attempts[error.trace.attempts.length - 1];
      const isTimeout = error.code === 'AI_TIMEOUT';
      const errorMsg = isTimeout
        ? 'Permintaan AI melewati batas waktu server.'
        : lastAttempt?.httpStatus === 503
        ? 'Layanan AI sedang mengalami lonjakan antrean trafik (HTTP 503). Silakan coba lagi.'
        : lastAttempt?.httpStatus === 504
        ? 'Layanan AI mengalami batas waktu koneksi upstream (HTTP 504).'
        : 'Layanan AI gagal menghasilkan analisis.';
      return res.status(isTimeout?504:502).json({service:CP4_BACKEND_SERVICE,requestId,code:error.code,stage:error.trace.lastStage,error:errorMsg,trace:{...error.trace,elapsedMs}});
    }
    return res.status(502).json({service:CP4_BACKEND_SERVICE,requestId,code:'AI_PROVIDER_ERROR',stage:'provider',error:'Layanan AI gagal menghasilkan analisis.',trace:{...trace,elapsedMs}});
  } finally {req.off('aborted',abort);res.off('close',disconnected);}
}

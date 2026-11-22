// One CP Step 4 operation, including transport, has one budget. Calibrated to conclude before preview gateway proxy limits.
export const CP4_RUN_POLICY = {totalMs:29_000, serverMs:28_000, responseReserveMs:1_000, attemptMs:24_000, maxAttempts:2, retryDelayMs:400} as const;
// Fast, responsive model proven to succeed without 504 deadline errors.
export const CP4_MODEL = 'gemini-3.1-flash-lite';
export type CP4Stage = 'request'|'transport'|'provider'|'backoff'|'response'|'validation'|'apply'|'aborted';
export interface CP4Trace {
  requestId:string; elapsedMs:number; timeoutSource:'none'|'client'|'server'|'provider';
  lastStage:CP4Stage; model:string|null; attempt:number; maxAttempts:number;
  keySource:'local'|'request'|'server'|'none'|'server-or-none';
  attempts:Array<{attempt:number; elapsedMs:number; httpStatus?:number; outcome:'success'|'429'|'503'|'504'|'provider_timeout'|'server_timeout'|'aborted'|'provider_error'}>;
}
export function newCP4RequestId():string {
  const uuid=globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3)|8).toString(16);});
  return `cp4-${uuid}`;
}
export function isCP4RequestId(value:unknown):value is string {return typeof value==='string' && /^cp4-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);}
export function initialCP4Trace(requestId:string,keySource:CP4Trace['keySource']):CP4Trace {
  return {requestId,elapsedMs:0,timeoutSource:'none',lastStage:'request',model:null,attempt:0,maxAttempts:CP4_RUN_POLICY.maxAttempts,keySource,attempts:[]};
}
// Never copy arbitrary provider diagnostics, model names, headers or payload into support reports.
export function sanitizeCP4Trace(value:unknown, requestId?:string):CP4Trace|undefined {
  const raw=value as Partial<CP4Trace>|null;
  if(!raw || !isCP4RequestId(raw.requestId) || (requestId && raw.requestId!==requestId)) return undefined;
  const number=(n:unknown,max:number)=>typeof n==='number'&&Number.isFinite(n)?Math.min(max,Math.max(0,Math.round(n))):0;
  const stages:CP4Stage[]=['request','transport','provider','backoff','response','validation','apply','aborted'];
  const outcomes=['success','429','503','504','provider_timeout','server_timeout','aborted','provider_error'];
  return {requestId:raw.requestId,elapsedMs:number(raw.elapsedMs,Math.max(CP4_RUN_POLICY.totalMs+10_000,100_000)),timeoutSource:['client','server','provider'].includes(raw.timeoutSource || '')?raw.timeoutSource!:'none',
    lastStage:stages.includes(raw.lastStage!)?raw.lastStage!:'transport',model:raw.model===CP4_MODEL?CP4_MODEL:null,attempt:number(raw.attempt,2),maxAttempts:2,
    keySource:['local','request','server','none','server-or-none'].includes(raw.keySource || '')?raw.keySource!:'none',
    attempts:Array.isArray(raw.attempts)?raw.attempts.slice(0,2).map(a=>({attempt:number(a?.attempt,2),elapsedMs:number(a?.elapsedMs,Math.max(CP4_RUN_POLICY.totalMs,100_000)),httpStatus:Number.isInteger(a?.httpStatus)&&a.httpStatus!>=100&&a.httpStatus!<=599?a.httpStatus:undefined,outcome:outcomes.includes(a?.outcome)?a.outcome:'provider_error'})):[]};
}

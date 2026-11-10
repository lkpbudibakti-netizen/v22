import type {Step07CheckpointContext} from './step07CheckpointService';
import {CP4ResponseError,parseCP4JSON,responseMime} from './cpAnalysisResponse';

export type Step07DiagnosticScope=Pick<Step07CheckpointContext,'yearPlanId'> & Partial<Pick<Step07CheckpointContext,'profileId'|'schoolId'>>;
export interface Step07DiagnosticEvent {
  time:string;kind:string;phase?:string;unitId?:string;category?:string;success?:boolean;reason?:string;
  httpStatus?:number;contentType?:string;durationMs?:number;requestId?:string;attempt?:number;
  fallback?:string;engine?:string;cache?:string;persisted?:boolean;redirected?:boolean;
}
export const STEP07_DIAGNOSTIC_LIMIT=160;
export const STEP07_DIAGNOSTIC_BYTES=100000;
interface Buffer {version:1;events:Step07DiagnosticEvent[];dropped:number;}
const memory=new Map<string,Buffer>();
const persistenceErrors=new Map<string,string>();
const lastStored=new Map<string,string>();
export const step07DiagnosticKey=(scope:Step07DiagnosticScope)=>'v22:step07-diagnostic:1:'+JSON.stringify([scope.schoolId || '',scope.profileId || '',scope.yearPlanId]);
export function step07DiagnosticFingerprint(value:unknown):string {const text=typeof value==='string'?value:JSON.stringify(value) || '';let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return (hash>>>0).toString(16).padStart(8,'0');}
export function step07ProposalFingerprint(value:any):string {return step07DiagnosticFingerprint((value?.alignmentProposals || []).map((p:any)=>{const a=p.action || p;return {type:a.type,unit:a.targetUnitId,material:a.targetMaterialId,before:a.before,after:a.after,tp:a.linkedTpIds || p.tpIds};}));}
export function redactStep07Diagnostic(value:unknown,max=1200):string {
  const text=String(value ?? '').replace(/<(?:!doctype\b|\/?(?:html|head|body|script)\b)[\s\S]*/gi,'[HTML_REDACTED]')
    .replace(/<[^>]{0,2000}>/g,'[HTML_REDACTED]')
    .replace(/AIza[\w-]{12,}|\bsk-[\w-]{12,}|\bBearer\s+[^\s,;]+/gi,'[SECRET_REDACTED]')
    .replace(/((?:x-gemini-api-key|api[_ -]?key|authorization|access[_ -]?token|secret|password)\s*["']?\s*[:=]\s*["']?)[^\s,"';}]+/gi,'$1[SECRET_REDACTED]')
    .replace(/https?:\/\/[^\s"<>]+/gi,url=>{try{return new URL(url).pathname;}catch{return '[URL_REDACTED]';}})
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[EMAIL_REDACTED]')
    .replace(/(?<![\w-])\+?\d[\d .-]{7,}\d(?![\w-])/g,'[IDENTIFIER_REDACTED]')
    .replace(/[A-Z]:\\Users\\[^\r\n]+/gi,'[LOCAL_PATH_REDACTED]');
  return text.length>max?text.slice(0,max)+' [TRUNCATED]':text;
}
export function step07ErrorCategory(error:unknown):string {
  const text=error instanceof Error?error.message:String(error);
  return text.match(/\b(?:API|AI|STEP07|CHECKPOINT|SAVE)_[A-Z_]+\b/)?.[0] || (error instanceof Error&&error.name==='AbortError'?'API_ABORTED':'UNCLASSIFIED_ERROR');
}
export function redactStep07PrivateContext(text:string,context?:Partial<Step07CheckpointContext>):string {
  let result=text;
  try{const identity=JSON.parse(context?.identityFingerprint || '{}');for(const entity of [identity.profile,identity.school])for(const field of ['name','nip','npsn','address','email','phone','principalName','principalNip']){
    const value=entity?.[field];if(typeof value!=='string')continue;
    const trimmed=value.trim(),shortName=['name','principalName'].includes(field)&&trimmed.length>=2&&trimmed.length<4;
    if(trimmed.length>=4||shortName){const escaped=trimmed.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');result=result.replace(new RegExp(shortName?`(?<![\\w-])${escaped}(?![\\w-])`:escaped,'gi'),'[PRIVATE_REDACTED]');}
  }}catch{/* no raw identity is included */}
  return redactStep07Diagnostic(result,Number.MAX_SAFE_INTEGER);
}
function clean(event:Partial<Step07DiagnosticEvent>):Step07DiagnosticEvent {
  const out:Step07DiagnosticEvent={time:new Date().toISOString(),kind:'EVENT'};
  const strings=['time','kind','phase','unitId','category','reason','contentType','requestId','fallback','engine','cache'] as const;
  for(const key of strings)if(typeof event[key]==='string')out[key]=redactStep07Diagnostic(event[key],key==='reason'?1200:160);
  for(const key of ['httpStatus','durationMs','attempt'] as const)if(typeof event[key]==='number'&&Number.isFinite(event[key]))out[key]=Math.max(0,event[key]!);
  for(const key of ['success','persisted','redirected'] as const)if(typeof event[key]==='boolean')out[key]=event[key];
  return out;
}
export function readStep07Diagnostics(scope:Step07DiagnosticScope):Buffer & {persistenceError?:string} {
  const key=step07DiagnosticKey(scope);let buffer=memory.get(key) || {version:1 as const,events:[],dropped:0};
  if(memory.has(key)&&persistenceErrors.has(key))return {...buffer,persistenceError:persistenceErrors.get(key)};
  try{
    const raw=typeof localStorage!=='undefined'?localStorage.getItem(key):null;
    if(raw&&raw===lastStored.get(key)&&memory.has(key))return {...buffer};
    if(raw){const parsed=JSON.parse(raw);if(parsed.version!==1||!Array.isArray(parsed.events))throw Error('schema');buffer={version:1,events:parsed.events.slice(-STEP07_DIAGNOSTIC_LIMIT).map(clean),dropped:Number(parsed.dropped)||0};memory.set(key,buffer);lastStored.set(key,raw);}
  }catch{persistenceErrors.set(key,'DIAGNOSTIC_BUFFER_UNREADABLE: laporan memakai buffer sesi; checkpoint tidak diubah.');}
  return {...buffer,persistenceError:persistenceErrors.get(key)};
}
export function recordStep07Diagnostic(scope:Step07DiagnosticScope,event:Omit<Step07DiagnosticEvent,'time'> & {time?:string}):void {
  // Diagnostics are deliberately non-throwing and never own a repair decision.
  try{
    const key=step07DiagnosticKey(scope),previous=readStep07Diagnostics(scope),safe=clean(event);if(safe.reason)safe.reason=redactStep07PrivateContext(safe.reason,scope);
    const buffer:Buffer={version:1,events:[...previous.events,safe],dropped:previous.dropped};
    while(buffer.events.length>STEP07_DIAGNOSTIC_LIMIT||JSON.stringify(buffer).length>STEP07_DIAGNOSTIC_BYTES){buffer.events.shift();buffer.dropped++;}
    memory.set(key,buffer);
    try{if(typeof localStorage==='undefined')throw Error('unavailable');if(previous.persistenceError?.startsWith('DIAGNOSTIC_BUFFER_UNREADABLE'))return;const serialized=JSON.stringify(buffer);localStorage.setItem(key,serialized);lastStored.set(key,serialized);persistenceErrors.delete(key);}
    catch{persistenceErrors.set(key,'DIAGNOSTIC_PERSIST_FAILED: buffer diagnostik hanya tersedia pada sesi ini.');}
  }catch{/* Observability must not alter repair, persistence, or validator behavior. */}
}
export class Step07AnalysisResponseError extends Error {
  constructor(public category:string,public metadata:Partial<Step07DiagnosticEvent>,message:string){super(category+': '+redactStep07Diagnostic(message,500));this.name='Step07AnalysisResponseError';}
}
/** Reuse the existing bounded JSON parser; never read/store a declared HTML body. */
export async function readStep07AnalysisResponse(response:Response,metadata:Partial<Step07DiagnosticEvent>):Promise<any> {
  const header=response.headers.get('content-type'),mime=responseMime(header);
  const info={...metadata,httpStatus:response.status,contentType:(header || 'missing').split(';')[0]};
  if(mime!=='json')throw new Step07AnalysisResponseError('API_NON_JSON_RESPONSE',info,'Endpoint mengembalikan respons non-JSON; body tidak direkam.');
  if(!response.ok)throw new Step07AnalysisResponseError('API_HTTP_ERROR',info,`HTTP ${response.status}; endpoint menolak permintaan; body tidak direkam.`);
  let body:any;
  try{body=parseCP4JSON(await response.text(),{source:'endpoint',httpStatus:response.status,mime},false);}
  catch(error){const code=error instanceof CP4ResponseError&&error.info.reason==='HTML'?'API_NON_JSON_RESPONSE':'API_INVALID_JSON_RESPONSE';throw new Step07AnalysisResponseError(code,info,'Respons JSON tidak dapat dibaca; body tidak direkam.');}
  return body;
}

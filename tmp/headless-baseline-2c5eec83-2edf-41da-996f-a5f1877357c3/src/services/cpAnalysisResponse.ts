export type CP4ResponseReason='HTTP_ERROR'|'CONTENT_TYPE'|'HTML'|'EMPTY'|'TRUNCATED'|'JSON_SYNTAX'|'CONTRACT'|'TOO_LARGE'|'NETWORK_ERROR'|'TIMEOUT'|'ABORTED';
export interface CP4ResponseInfo {source:'endpoint'|'provider';reason:CP4ResponseReason;httpStatus?:number;mime?:'json'|'html'|'text'|'other'|'missing';phase?:'health'|'analysis';gatewayIntercepted?:boolean}
export class CP4ResponseError extends Error {
  trace?:CP4Trace;
  constructor(public info:CP4ResponseInfo) {super('RESPONSE_INVALID');}
}
export function safeResponseInfo(value:unknown):CP4ResponseInfo|undefined {
  const v=value as CP4ResponseInfo;
  if(!v||!['endpoint','provider'].includes(v.source)||!['HTTP_ERROR','CONTENT_TYPE','HTML','EMPTY','TRUNCATED','JSON_SYNTAX','CONTRACT','TOO_LARGE','NETWORK_ERROR','TIMEOUT','ABORTED'].includes(v.reason))return undefined;
  return {source:v.source,reason:v.reason,httpStatus:Number.isInteger(v.httpStatus)&&v.httpStatus!>=100&&v.httpStatus!<=599?v.httpStatus:undefined,mime:['json','html','text','other','missing'].includes(v.mime || '')?v.mime:undefined,phase:['health','analysis'].includes(v.phase || '')?v.phase:undefined,gatewayIntercepted:Boolean(v.gatewayIntercepted)};
}
export function responseMime(header:string|null):CP4ResponseInfo['mime'] {
  const mime=(header || '').split(';')[0].trim().toLowerCase();
  return !mime?'missing':mime==='application/json'||/^application\/[\w.-]+\+json$/.test(mime)?'json':mime==='text/html'?'html':mime==='text/plain'?'text':'other';
}
export function parseCP4JSON(raw:unknown,info:Omit<CP4ResponseInfo,'reason'>,analysis=true):any {
  const fail=(reason:CP4ResponseReason):never=>{throw new CP4ResponseError({...info,reason});};
  if(typeof raw!=='string'||!raw.trim())return fail('EMPTY');
  if(raw.length>2_000_000)return fail('TOO_LARGE');
  const cleaned=info.source==='provider'?raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim():raw.trim();
  if(/^\s*<(?:!doctype\b|\/?[a-z])/i.test(cleaned))return fail('HTML');
  let parsed:any;
  try {parsed=JSON.parse(cleaned);}catch {
    const stack:string[]=[];let quoted=false,escaped=false,mismatch=false;
    for(const char of cleaned) {
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"')quoted=true;else if(char==='{'||char==='[')stack.push(char);else if(char==='}'||char===']'){if(stack.pop()!==(char==='}'?'{':'['))mismatch=true;}
    }
    return fail(!mismatch&&(quoted||stack.length>0)?'TRUNCATED':'JSON_SYNTAX');
  }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return fail('CONTRACT');
  if(analysis&&(!Array.isArray(parsed.items)||!parsed.items.length))return fail('CONTRACT');
  return parsed;
}
import type { CP4Trace } from './cpAnalysisRun';

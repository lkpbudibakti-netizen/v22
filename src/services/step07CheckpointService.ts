import type { ATPData,TPData,ATPUnitMappingData } from '../types';
import type { MappingAnalysisResult } from './aiService';
import { loadStorageV5 } from './storageV5';
import { computeAtpSubstantiveFingerprint,computeTpSubstantiveFingerprint } from './atpMappingActionApplyService';
import {recordStep07Diagnostic,step07ErrorCategory} from './step07DiagnosticsService';
import type {Step07FailureCategory,Step07RepairAttemptState} from './step07AutoExecutionPolicy';

export type Step07Stage='ANALYZE'|'PROPOSE'|'VERIFY'|'FILTER'|'APPLY'|'VALIDATE'|'SAVE';
export type Step07Mode='INITIAL_MAPPING'|'REPAIR'|'VALIDATE';
export interface Step07CheckpointContext {yearPlanId:string;profileId:string;schoolId:string;identityFingerprint:string;}
export interface Step07WorkStatus {mode:Step07Mode;activeUnitId:string;stage:Step07Stage;completed:number;total:number;checkpointStatus:string;}
export interface Step07StageEvent {stage:Step07Stage;actionId?:string;success:boolean;reason:string;failureCategory?:Step07FailureCategory;}
export interface Step07UnitCheckpoint {
  semanticPolicyVersion?:string;
  baseSource?:string;
  source:string;dependency:string;stage:Step07Stage;status:'PENDING'|'RUNNING'|'DONE'|'BLOCKED'|'NEEDS_TEACHER_REVIEW';
  analysis?:MappingAnalysisResult;proposal?:MappingAnalysisResult;verification?:MappingAnalysisResult;
  cacheUsable?:boolean;applied:string[];events:Step07StageEvent[];
  rejected?:string[];
  verifiedDependencies?:Record<string,string>;
  repairState?:Step07RepairAttemptState;
  responses?:Array<{phase:string;source:string;canonical:string;result:MappingAnalysisResult}>;
}
export interface Step07Checkpoint {
  schemaVersion:1;revision:number;context:Step07CheckpointContext;canonical:string;
  units:Record<string,Step07UnitCheckpoint>;workingMapping?:ATPUnitMappingData;
  beforeUnits:ATPUnitMappingData['units'];
  baseStoredKey:string;mode:Step07Mode;
  activeUnitId?:string;
  initialIssueIds?:string[];
  invalidated?:Array<{unitId:string;reason:string;checkpoint:Step07UnitCheckpoint}>;
}
export function resolveStep07CheckpointContext(yearPlanId:string):Step07CheckpointContext {
  const state=loadStorageV5(),year=state.yearPlans.find(y=>y.id===yearPlanId);
  if(!year)throw new Error('CHECKPOINT_CONTEXT: tahun ajaran aktif tidak ditemukan.');
  const profile=state.profiles.find(p=>p.id===year.profileId),school=state.schools.find(s=>s.id===year.schoolId);
  if(!profile||!school)throw new Error('CHECKPOINT_CONTEXT: identitas profil/sekolah tidak lengkap.');
  return {yearPlanId,profileId:profile.id,schoolId:school.id,identityFingerprint:JSON.stringify({year,profile,school})};
}
export const step07CheckpointKey=(context:Step07CheckpointContext)=>'v22:step07-checkpoint:1:'+JSON.stringify([context.schoolId,context.profileId,context.yearPlanId]);
export const step07CanonicalKey=(atp:ATPData,tp:TPData)=>{
  const {items:atpItems,updatedAt:atpTime,...atpSource}=atp;
  const {items:tpItems,updatedAt:tpTime,...tpSource}=tp;
  return JSON.stringify([atpSource,tpSource,computeAtpSubstantiveFingerprint(atp),computeTpSubstantiveFingerprint(tp)]);
};
export const step07UnitKey=(unit:ATPUnitMappingData['units'][number])=>JSON.stringify(unit);
export function readStep07Checkpoint(context:Step07CheckpointContext):Step07Checkpoint|undefined {
  try{
  const raw=localStorage.getItem(step07CheckpointKey(context));if(!raw)return;
  let value:Step07Checkpoint;try{value=JSON.parse(raw);}catch{throw new Error('CHECKPOINT_CORRUPT: checkpoint tidak dapat dibaca; data mentah dipertahankan.');}
  if(value.schemaVersion!==1)throw new Error('CHECKPOINT_SCHEMA: versi checkpoint tidak didukung; data dipertahankan.');
  if(!Number.isInteger(value.revision)||!value.units||typeof value.units!=='object'||Array.isArray(value.units)||!Array.isArray(value.beforeUnits))throw new Error('CHECKPOINT_CORRUPT: struktur checkpoint tidak valid.');
  if(value.context?.profileId!==context.profileId||value.context?.schoolId!==context.schoolId||value.context?.yearPlanId!==context.yearPlanId)throw new Error('CHECKPOINT_CONTEXT: namespace profil/sekolah tidak sesuai.');
  if(Object.values(value.units).some(p=>!p||!Array.isArray(p.applied)||!Array.isArray(p.events)||typeof p.source!=='string'||typeof p.dependency!=='string'))throw new Error('CHECKPOINT_CORRUPT: tahap Bab tidak valid; data mentah dipertahankan.');
  recordStep07Diagnostic(context,{kind:'CHECKPOINT_READ',unitId:value.activeUnitId,success:true,persisted:true,reason:`schema=${value.schemaVersion}; revision=${value.revision}`});return value;
  }catch(error){recordStep07Diagnostic(context,{kind:'CHECKPOINT_READ',success:false,category:step07ErrorCategory(error),reason:'Checkpoint gagal dibaca; data mentah dipertahankan.'});throw error;}
}
export function classifyCheckpointStorageError(err:unknown):{category:string;message:string} {
  if(typeof globalThis.localStorage==='undefined')return {category:'CHECKPOINT_STORAGE_UNAVAILABLE',message:'CHECKPOINT_SAVE_FAILED: localStorage tidak tersedia pada browser/lingkungan ini. Draft tersimpan tetap aman di V5.'};
  const name=err&&typeof err==='object'&&'name' in err?String(err.name):'';
  const msg=err instanceof Error?err.message:String(err || '');
  if(name==='QuotaExceededError'||(err as any)?.code===22||name==='NS_ERROR_DOM_QUOTA_REACHED'||/quota|QuotaExceeded|storage full/i.test(msg)){
    return {category:'CHECKPOINT_QUOTA_EXCEEDED',message:'CHECKPOINT_SAVE_FAILED: kuota penyimpanan browser (localStorage) penuh. Draft tersimpan sebelumnya tetap aman di V5; kosongkan cache situs atau ekspor cadangan profil.'};
  }
  if(err instanceof TypeError||/circular|serialize|JSON\.stringify/i.test(msg)){
    return {category:'CHECKPOINT_SERIALIZATION_FAILED',message:'CHECKPOINT_SAVE_FAILED: struktur data checkpoint tidak dapat diserialisasi. Draft tersimpan di V5 tidak terpengaruh.'};
  }
  if(/unavailable|disabled|security|access denied|not available/i.test(msg)){
    return {category:'CHECKPOINT_STORAGE_UNAVAILABLE',message:'CHECKPOINT_SAVE_FAILED: akses penyimpanan lokal dinonaktifkan atau diblokir oleh izin browser. Draft tersimpan di V5 tidak terpengaruh.'};
  }
  return {category:'CHECKPOINT_SAVE_FAILED',message:`CHECKPOINT_SAVE_FAILED: penyimpanan lokal gagal (${msg || 'unknown'}). Proses dihentikan; draft tersimpan sebelumnya tetap aman.`};
}

export function compactStep07Checkpoint(checkpoint:Step07Checkpoint):Step07Checkpoint {
  if(!checkpoint)return checkpoint;
  if(Array.isArray(checkpoint.beforeUnits)){
    const seen=new Set<string>();
    checkpoint.beforeUnits=checkpoint.beforeUnits.filter(u=>{
      if(!u||!u.id||seen.has(u.id))return false;
      seen.add(u.id);
      return true;
    });
  }
  if(Array.isArray(checkpoint.invalidated)&&checkpoint.invalidated.length>10){
    checkpoint.invalidated=checkpoint.invalidated.slice(-10);
  }
  if(Array.isArray(checkpoint.invalidated)){
    for(const item of checkpoint.invalidated){
      if(item?.checkpoint){
        delete item.checkpoint.analysis;
        delete item.checkpoint.proposal;
        delete item.checkpoint.verification;
        delete item.checkpoint.responses;
        if(Array.isArray(item.checkpoint.events)&&item.checkpoint.events.length>6){
          item.checkpoint.events=item.checkpoint.events.slice(-6);
        }
      }
    }
  }
  if(checkpoint.units&&typeof checkpoint.units==='object'){
    for(const point of Object.values(checkpoint.units)){
      if(!point)continue;
      if(Array.isArray(point.events)&&point.events.length>30){
        const failed=point.events.filter(e=>!e.success);
        const success=point.events.filter(e=>e.success);
        const keptFailed=failed.slice(-15);
        const keptSuccess=success.slice(-15);
        point.events=[...keptFailed,...keptSuccess].sort((a,b)=>point.events.indexOf(a)-point.events.indexOf(b));
      }
      if(Array.isArray(point.responses)&&point.responses.length>3){
        point.responses=point.responses.slice(-3);
      }
      if(Array.isArray(point.rejected)){
        point.rejected=[...new Set(point.rejected)];
      }
    }
  }
  return checkpoint;
}

function pruneCheckpointForEmergency(cp:Step07Checkpoint):Step07Checkpoint {
  delete cp.workingMapping;
  if(Array.isArray(cp.invalidated)){
    cp.invalidated=cp.invalidated.slice(-2).map(i=>({unitId:i.unitId,reason:i.reason,checkpoint:{stage:i.checkpoint?.stage,status:i.checkpoint?.status,source:i.checkpoint?.source,dependency:i.checkpoint?.dependency,applied:i.checkpoint?.applied || [],events:[]}}));
  }
  for(const p of Object.values(cp.units)){
    delete p.responses;
    if(p.events&&p.events.length>3)p.events=p.events.slice(-3);
    if(p.status==='DONE'||p.status==='BLOCKED'){
      delete p.analysis;
      delete p.proposal;
    }
  }
  return cp;
}

export function writeStep07Checkpoint(value:Step07Checkpoint):void {
  const started=Date.now();
  let failureCategory='CHECKPOINT_SAVE_FAILED';
  try{
    const key=step07CheckpointKey(value.context),previous=localStorage.getItem(key);
    if(previous){
      const stored=JSON.parse(previous) as Step07Checkpoint;
      if(stored.revision!==value.revision)throw new Error('CHECKPOINT_CONFLICT: checkpoint berubah pada proses lain.');
      if(previous===JSON.stringify(value))return;
    }
    compactStep07Checkpoint(value);
    const next={...value,revision:value.revision+1};
    let serialized:string;
    try{
      serialized=JSON.stringify(next);
    }catch(serializeErr){
      const classified=classifyCheckpointStorageError(serializeErr);
      failureCategory=classified.category;
      throw new Error(classified.message);
    }
    try{
      localStorage.setItem(key,serialized);
    }catch(writeErr){
      const classified=classifyCheckpointStorageError(writeErr);
      failureCategory=classified.category;
      if(classified.category==='CHECKPOINT_QUOTA_EXCEEDED'){
        try{
          pruneCheckpointForEmergency(next);
          serialized=JSON.stringify(next);
          localStorage.setItem(key,serialized);
        }catch(retryErr){
          const retryClassified=classifyCheckpointStorageError(retryErr);
          failureCategory=retryClassified.category;
          throw new Error(retryClassified.message);
        }
      }else{
        throw new Error(classified.message);
      }
    }
    value.revision=next.revision;
    recordStep07Diagnostic(value.context,{kind:'CHECKPOINT_WRITE',unitId:value.activeUnitId,phase:value.activeUnitId?value.units[value.activeUnitId]?.stage:undefined,success:true,persisted:true,durationMs:Date.now()-started,reason:`revision=${value.revision}`});
  }catch(error){
    const category=(error instanceof Error&&error.message.includes('CHECKPOINT_CONFLICT'))?'CHECKPOINT_CONFLICT':failureCategory;
    recordStep07Diagnostic(value.context,{kind:'CHECKPOINT_WRITE',unitId:value.activeUnitId,success:false,persisted:false,category,reason:'Checkpoint gagal dipersist; snapshot terakhir tidak direset.'});
    throw error;
  }
}
/** Web Locks provide cross-tab/process exclusion and release automatically after a crash.
 * Fail closed on unsupported surfaces rather than pretend localStorage read/write is a lock. */
export async function withStep07CheckpointLock<T>(context:Step07CheckpointContext,run:()=>Promise<T>):Promise<T> {
  if(typeof navigator==='undefined'||!navigator.locks)throw new Error('CHECKPOINT_LOCK_UNAVAILABLE: browser tidak mendukung kunci proses aman. Gunakan browser modern pada HTTPS/localhost.');
  return navigator.locks.request(step07CheckpointKey(context),{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('CHECKPOINT_BUSY: perbaikan profil/tahun ajaran ini sedang berjalan di tab lain.');
    return run();
  });
}
/** V5 is one localStorage blob. Serialize Step07 writes across profile namespaces. */
export async function withStep07StorageWrite<T>(run:()=>T,remainingMs:number):Promise<T> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,remainingMs));
  try{return await navigator.locks.request('v22:step07:v5-write',{mode:'exclusive',signal:controller.signal},()=>run());}
  catch(error){if(controller.signal.aborted)throw new Error('STEP07_TIMEOUT: menunggu penulisan V5; checkpoint dipertahankan.');throw error;}
  finally{clearTimeout(timer);}
}

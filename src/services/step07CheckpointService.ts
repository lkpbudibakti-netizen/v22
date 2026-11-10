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
export function writeStep07Checkpoint(value:Step07Checkpoint):void {
  const started=Date.now();try{
  const key=step07CheckpointKey(value.context),previous=localStorage.getItem(key);
  if(previous){const stored=JSON.parse(previous) as Step07Checkpoint;if(stored.revision!==value.revision)throw new Error('CHECKPOINT_CONFLICT: checkpoint berubah pada proses lain.');if(previous===JSON.stringify(value))return;}
  const next={...value,revision:value.revision+1};
  try{localStorage.setItem(key,JSON.stringify(next));}catch{throw new Error('CHECKPOINT_SAVE_FAILED: penyimpanan lokal penuh/tidak tersedia. Proses dihentikan; draft tersimpan sebelumnya tetap aman.');}
  value.revision=next.revision;
  recordStep07Diagnostic(value.context,{kind:'CHECKPOINT_WRITE',unitId:value.activeUnitId,phase:value.activeUnitId?value.units[value.activeUnitId]?.stage:undefined,success:true,persisted:true,durationMs:Date.now()-started,reason:`revision=${value.revision}`});
  }catch(error){recordStep07Diagnostic(value.context,{kind:'CHECKPOINT_WRITE',unitId:value.activeUnitId,success:false,persisted:false,category:step07ErrorCategory(error),reason:'Checkpoint gagal dipersist; snapshot terakhir tidak direset.'});throw error;}
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

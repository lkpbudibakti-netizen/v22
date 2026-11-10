import type { ATPUnitMappingData,Step07AutoRequest } from '../types';
import type { MappingAnalysisResult } from './aiService';
import type { Step07RepairOptions,Step07RepairResult } from './step07AutoRepairService';
import { resolveATPUnitMappingReadiness } from './atpMappingReadinessService';
import { computeMappingFingerprint } from './atpMappingActionApplyService';
import { step07PersistedKey } from './step07AutoExecutionPolicy';
import { getATPUnitMappingV5,loadStorageV5 } from './storageV5';
import {recordStep07Diagnostic,step07ErrorCategory,step07ProposalFingerprint} from './step07DiagnosticsService';
import {classifyStep07Failure,step07ActionDependency} from './step07AutoExecutionPolicy';
import { readStep07Checkpoint,writeStep07Checkpoint,withStep07CheckpointLock,withStep07StorageWrite,resolveStep07CheckpointContext,step07CanonicalKey,step07UnitKey,type Step07Checkpoint,type Step07UnitCheckpoint,type Step07Stage,type Step07Mode } from './step07CheckpointService';

type Pass=(options:Step07RepairOptions)=>Promise<Step07RepairResult>;
const assess=(mapping:ATPUnitMappingData,o:Step07RepairOptions)=>resolveATPUnitMappingReadiness(mapping,o.atp,o.tp,undefined,{evaluateRepair:true});
export function detectStep07Mode(mapping:ATPUnitMappingData,o:Pick<Step07RepairOptions,'atp'|'tp'>):Step07Mode {
  if(mapping.units.length&&mapping.units.every(u=>!u.linkedTpIds.length&&!u.linkedAtpItemIds.length&&u.materials.every(m=>!m.linkedTpIds.length&&!m.linkedAtpItemIds.length)))return 'INITIAL_MAPPING';
  return resolveATPUnitMappingReadiness(mapping,o.atp,o.tp,undefined,{evaluateRepair:true}).canProceed?'VALIDATE':'REPAIR';
}
/** Per-Bab scheduling and durable stage transport around the existing repair pass.
 * It does not classify, authorize or mutate pedagogical actions itself. */
export async function runHybridStep07Repair(options:Step07RepairOptions,pass:Pass):Promise<Step07RepairResult> {
  let current=structuredClone(options.mapping),latest:Step07RepairResult|undefined;
  const allApplied=new Set<string>();
  const context=options.checkpointContext!,canonical=step07CanonicalKey(options.atp,options.tp);
  const fallback=(message:string):Step07RepairResult=>{
    recordStep07Diagnostic(context,{kind:'RUN_ERROR',success:false,category:step07ErrorCategory(message),reason:message});
    const readiness=resolveATPUnitMappingReadiness(current,options.atp,options.tp),issues=[message,...(latest?.issues || [])];
    return {...latest,mapping:current,readiness,validation:readiness.validationResult!,progress:latest?.progress || {initial:assess(current,options).repairIssues?.length || 0,resolved:0,remaining:assess(current,options).repairIssues?.length || 0},outcome:'INCOMPLETE',saved:false,persisted:latest?.persisted || false,stale:latest?.stale || !options.isCurrent() || /CHECKPOINT_STALE|STEP07_STALE/.test(message),rounds:latest?.rounds || 0,issues,appliedActions:[...allApplied]};
  };
  try{return await withStep07CheckpointLock(context,async()=>{
    let persisted=getATPUnitMappingV5(context.yearPlanId);
    let storedKey=persisted?step07PersistedKey(persisted,options.atp,options.tp):'NONE';
    let root=readStep07Checkpoint(context);
    recordStep07Diagnostic(context,{kind:'RUN_START',unitId:root?.activeUnitId,phase:root?.activeUnitId?root.units[root.activeUnitId]?.stage:undefined,cache:root?'RESUME':'NEW',reason:root?`Checkpoint tersedia; revision=${root.revision}`:'Belum ada checkpoint.'});
    const sameIdentity=root?.context.identityFingerprint===context.identityFingerprint;
    // Restore a buffered stage only when no manual/persisted source has changed.
    if(root&&sameIdentity&&root.canonical===canonical&&root.baseStoredKey===storedKey&&root.workingMapping&&(!persisted||computeMappingFingerprint(current.units,options.atp,options.tp)===computeMappingFingerprint(persisted.units,options.atp,options.tp)))current=structuredClone(root.workingMapping);
    else if(root&&sameIdentity&&root.canonical===canonical&&root.workingMapping){
      // Merge only a buffered Bab whose pre-apply source is still exact. An edit
      // in another Bab must neither discard this progress nor be overwritten.
      current.units=current.units.map(unit=>{
        const point=root!.units[unit.id],buffer=root!.workingMapping!.units.find(u=>u.id===unit.id);
        return point&&buffer&&point.baseSource===step07UnitKey(unit)&&point.source===step07UnitKey(buffer)?structuredClone(buffer):unit;
      });
    }
    if(root?.workingMapping)for(const unit of current.units){
      const buffer=root.workingMapping.units.find(u=>u.id===unit.id);
      if(!buffer||step07UnitKey(unit)!==step07UnitKey(buffer))root.beforeUnits=root.beforeUnits.map(u=>u.id===unit.id?structuredClone(unit):u);
    }
    if(!root)root={schemaVersion:1,revision:0,context,canonical,units:{},baseStoredKey:storedKey,mode:detectStep07Mode(current,options),beforeUnits:structuredClone(current.units)};
    if(!sameIdentity&&root.context.identityFingerprint!==context.identityFingerprint){root.invalidated ||= [];for(const [unitId,point] of Object.entries(root.units))root.invalidated.push({unitId,reason:'Identitas profil/sekolah berubah.',checkpoint:point});root.units={};root.beforeUnits=structuredClone(current.units);}
    root.context=context;root.canonical=canonical;root.mode=detectStep07Mode(current,options);
    root.initialIssueIds ||= (assess(current,options).repairIssues || []).map(i=>i.id);
    const checkpoint:Step07Checkpoint=root;
    const start=Date.now(),deadline=start+Math.min(options.timeoutMs ?? 180000,300000);
    let calls=0,input=0;
    const maxCalls=Math.min(options.maxRequests ?? 24,60),maxInput=Math.min(options.maxInputCharacters ?? 2000000,4000000);
    const checkFresh=()=>{
      if(!options.isCurrent()||resolveStep07CheckpointContext(context.yearPlanId).identityFingerprint!==context.identityFingerprint)throw new Error('CHECKPOINT_STALE: identitas/draft aktif berubah; hasil lama tidak diterapkan.');
      const state=loadStorageV5(),atp=state.annualData.atp.find(e=>e.yearPlanId===context.yearPlanId)?.value,tp=state.annualData.tp.find(e=>e.yearPlanId===context.yearPlanId)?.value;
      if(!atp||!tp||step07CanonicalKey(atp,tp)!==canonical)throw new Error('CHECKPOINT_STALE: sumber TP/ATP tersimpan berubah; hasil lama tidak diterapkan.');
      const actual=getATPUnitMappingV5(context.yearPlanId);
      if((actual?step07PersistedKey(actual,options.atp,options.tp):'NONE')!==storedKey)throw new Error('CHECKPOINT_STALE: draft tersimpan berubah; muat sumber terbaru.');
    };
    const persist=()=>{checkFresh();checkpoint.workingMapping=structuredClone(current);checkpoint.baseStoredKey=storedKey;writeStep07Checkpoint(checkpoint);};
    // Mark a previously legacy mapping as in-progress before awaiting AI. Otherwise
    // a reload could expose legacy structural readiness while its semantic review
    // is still pending in the separate checkpoint store.
    if(!current.step07AutoRepair&&!assess(current,options).canProceed&&assess(current,options).canSaveDraft){
      checkFresh();
      current={...current,step07AutoRepair:{scope:'STEP07_AUTO_REPAIR',version:1,runId:'checkpoint-'+crypto.randomUUID(),beforeUnits:checkpoint.beforeUnits,expectedStoredFingerprint:storedKey,resultFingerprint:computeMappingFingerprint(current.units,options.atp,options.tp),addedMaterialIds:[],rounds:0,outcome:'INCOMPLETE',issues:['Checkpoint per Bab sedang diproses; validasi global belum selesai.']}};
      await withStep07StorageWrite(()=>{
        checkFresh();if(!options.save(current))throw new Error('CHECKPOINT_SAVE_FAILED: penanda proses belum tersimpan; AI tidak dijalankan.');
        const actual=getATPUnitMappingV5(context.yearPlanId);
        if(!actual||actual.step07AutoRepair?.runId!==current.step07AutoRepair.runId)throw new Error('CHECKPOINT_SAVE_FAILED: penanda proses tidak terkonfirmasi.');
        persisted=actual;current=structuredClone(actual);storedKey=step07PersistedKey(actual,options.atp,options.tp);
      },deadline-Date.now());
    }
    const dependency=(unitId:string)=>{
      const unit=current.units.find(u=>u.id===unitId);
      if(!unit)return canonical;
      const ids=new Set([...unit.linkedTpIds,...unit.materials.flatMap(m=>m.linkedTpIds)]);
      return step07CanonicalKey({...options.atp,items:options.atp.items.filter(a=>a.linkedTpIds?.some(id=>ids.has(id))||!!a.tpId&&ids.has(a.tpId))},{...options.tp,items:options.tp.items.filter(t=>ids.has(t.id))});
    };
    const source=(id:string)=>id==='GLOBAL'?computeMappingFingerprint(current.units,options.atp,options.tp):step07UnitKey(current.units.find(u=>u.id===id)!);
    for(const [id,entry] of Object.entries(checkpoint.units)){
      const exists=id==='GLOBAL'||current.units.some(u=>u.id===id);
      const expected=entry.status==='DONE'?dependency(id):canonical;
      if(!exists||entry.source!==source(id)||entry.dependency!==expected){
        recordStep07Diagnostic(context,{kind:'INVALIDATION',unitId:id,phase:entry.stage,category:'SOURCE_CHANGED',cache:'INVALID',reason:!exists?'Bab tidak ada.':entry.source!==source(id)?'Struktur/redaksi/relasi/history Bab berubah.':'Dependensi TP/ATP berubah.'});
        checkpoint.invalidated ||= [];checkpoint.invalidated.push({unitId:id,reason:!exists?'Bab dihapus dari draft.':entry.source!==source(id)?'Struktur/redaksi/relasi Bab berubah.':'Dependensi TP/ATP berubah.',checkpoint:entry});
        if(exists&&id!=='GLOBAL'&&entry.source!==source(id)){
          const manual=current.units.find(u=>u.id===id)!;
          checkpoint.beforeUnits=checkpoint.beforeUnits.map(u=>u.id===id?structuredClone(manual):u);
        }
        delete checkpoint.units[id];
      }
    }
    checkpoint.beforeUnits=checkpoint.beforeUnits.filter(u=>current.units.some(v=>v.id===u.id));
    for(const unit of current.units)if(!checkpoint.beforeUnits.some(u=>u.id===unit.id))checkpoint.beforeUnits.push(structuredClone(unit));
    persist();
    const completed=()=>current.units.filter(u=>!(assess(current,options).repairIssues || []).some(i=>i.unitId===u.id)).length;
    const deferred:NonNullable<Step07AutoRequest['actions']>=Object.values(checkpoint.units).flatMap(p=>(p.proposal?.alignmentProposals || []).flatMap(v=>v.action?.sourceUnitId&&v.action.sourceUnitId!==v.action.targetUnitId?[v.action]:[]));
    const execute=async(id:string)=>{
      let entry=checkpoint.units[id];
      if(!entry)entry=checkpoint.units[id]={source:source(id),baseSource:source(id),dependency:canonical,stage:'ANALYZE',status:'PENDING',applied:[],events:[]};
      const point=entry;
      point.rejected ||= point.events.filter(e=>!e.success&&e.actionId&&['PROPOSE','VERIFY','FILTER','APPLY'].includes(e.stage)).map(e=>e.actionId!);
      if(!point.verifiedDependencies){
        point.verifiedDependencies={};
        // Older VERIFY checkpoints bind the exact full source. Retain that
        // completed stage; later/unknown legacy dependencies require reverify.
        if(point.stage==='VERIFY'&&point.source===source(id)&&point.dependency===canonical)for(const p of point.proposal?.alignmentProposals || point.analysis?.alignmentProposals || [])if(p.action&&point.verification?.step07SemanticChecks?.some(c=>c.actionId===p.action!.id&&c.verdict==='SUPPORTED'))point.verifiedDependencies[p.action.id]=step07ActionDependency(p.action,current.units,options.atp,options.tp);
      }
      point.repairState ||= {sourceKey:'',attempts:0,seen:[],failures:point.events.filter(e=>!e.success).map(e=>({actionId:e.actionId || 'proposal-set',category:e.failureCategory || classifyStep07Failure(e.reason),reason:e.reason,phase:e.stage}))};
      if(point.analysis || point.proposal)point.cacheUsable=true;
      checkpoint.activeUnitId=id;
      const work=(stage:Step07Stage,status:string)=>options.onWork?.({mode:checkpoint.mode,activeUnitId:id,stage,completed:completed(),total:current.units.length,checkpointStatus:status});
      const event=(stage:Step07Stage,success:boolean,reason:string,actionId?:string)=>{
        const failureCategory=success?undefined:classifyStep07Failure(reason);
        recordStep07Diagnostic(context,{kind:'STAGE',unitId:id,phase:stage,success,reason:(actionId?`action=${actionId}; `:'')+reason,category:failureCategory || 'OK'});
        if(!point.events.some(e=>e.stage===stage&&e.actionId===actionId&&e.success===success&&e.reason===reason))point.events.push({stage,success,reason,actionId,failureCategory});
      };
      const stage=(phase:Step07Stage,data?:Parameters<NonNullable<Step07RepairOptions['onCheckpoint']>>[1])=>{checkFresh();checkpoint.activeUnitId=id;point.stage=phase;work(phase,'Checkpoint tahap tersimpan');persist();options.onCheckpoint?.(phase,data || {mapping:current,analysis:point.analysis,success:true});};
      const analyze:Step07RepairOptions['analyze']=async(mapping,request,signal)=>{
        checkFresh();current=mapping;
        const enriched:Step07AutoRequest={...request,execution:{mode:checkpoint.mode,activeUnitId:id==='GLOBAL'?undefined:id,reconciliation:id==='GLOBAL',otherUnits:current.units.filter(u=>u.id!==id).map(u=>({id:u.id,title:u.title,tpIds:u.linkedTpIds,materialCount:u.materials.length})),deferredActions:id==='GLOBAL'?deferred:undefined}};
        if(enriched.validation)enriched.validation={...enriched.validation,rejectedActions:[...new Set([...enriched.validation.rejectedActions,...point.events.filter(e=>!e.success).map(e=>`${e.stage}/${e.actionId || '-'}: ${e.reason}`)])]};
        // Full canonical TP/ATP + other-Bab summaries; only the active Bab is editable.
        const projection=id==='GLOBAL'?mapping:{...mapping,units:mapping.units.filter(u=>u.id===id)};
        const phase=request.phase;
        let cached:MappingAnalysisResult|undefined;
        if(point.cacheUsable){
          if(phase==='PROPOSE'){
            const prior=point.proposal || point.analysis;
            const reusable=prior?.alignmentProposals?.filter(p=>{
              const actionId=p.action?.id || p.actionId || p.id;
              return p.action&&!point.applied.includes(actionId)&&!point.rejected!.includes(actionId)&&(!p.action.targetMaterialId||mapping.units.find(u=>u.id===(p.action!.sourceUnitId || p.targetUnitId))?.materials.some(m=>m.id===p.action!.targetMaterialId&&m.title===p.action!.before));
            });
            if(prior&&reusable?.length)cached={...prior,alignmentProposals:reusable};
          }
          else if(point.verification&&request.actions?.every(a=>point.verification!.step07SemanticChecks?.some(c=>c.actionId===a.id&&c.verdict==='SUPPORTED')&&point.verifiedDependencies![a.id]===step07ActionDependency(a,mapping.units,options.atp,options.tp)))cached=point.verification;
        }
        if(cached){
          recordStep07Diagnostic(context,{kind:'CACHE',unitId:id,phase,cache:'HIT',success:true,reason:`Tahap dipakai kembali; applied IDs=${point.applied.length}`});
          if(phase==='PROPOSE'){
            point.proposal=cached;stage('PROPOSE');
            return structuredClone(cached);
          }
          stage('VERIFY');return structuredClone(cached);
        }
        recordStep07Diagnostic(context,{kind:'CACHE',unitId:id,phase,cache:'MISS',success:false,reason:!point.cacheUsable?'Checkpoint lama/belum memiliki hasil yang dapat digunakan.':phase==='VERIFY'?'Verifikasi tidak valid atau dependensi tindakan berubah.':'Tidak ada proposal pending valid; yang ditolak diperbaiki dengan feedback spesifik.'});
        const size=JSON.stringify({mapping:projection,request:enriched,atp:options.atp,tp:options.tp}).length;
        if(calls>=maxCalls||input+size>maxInput)throw new Error('STEP07_BUDGET_LIMIT: anggaran checkpoint tercapai; Lanjutkan Perbaikan tersedia.');
        if(Date.now()>=deadline)throw new Error('STEP07_TIMEOUT: batas waktu checkpoint tercapai.');
        calls++;input+=size;point.stage=phase==='PROPOSE'?'ANALYZE':'VERIFY';point.status='RUNNING';work(point.stage,'Berjalan');persist();
        let response:MappingAnalysisResult;
        try{response=await options.analyze(structuredClone(projection),enriched,signal);if(signal.aborted)throw new Error('STEP07_TIMEOUT: respons terlambat tidak disimpan.');checkFresh();}
        catch(error){if(!signal.aborted){event(phase,false,error instanceof Error?error.message:String(error));persist();}throw error;}
        point.responses ||= [];point.responses.push({phase,source:source(id),canonical,result:structuredClone(response)});
        if(phase==='PROPOSE'){
          if(point.analysis&&step07ProposalFingerprint(point.analysis)===step07ProposalFingerprint(response))recordStep07Diagnostic(context,{kind:'PROPOSAL',unitId:id,phase,category:'REPEATED_PROPOSAL',reason:'Target, redaksi, dan relasi proposal sama dengan analisis sebelumnya; ID AI diabaikan saat pembandingan.'});
          point.analysis=response;point.proposal=undefined;point.cacheUsable=true;point.applied=[];point.rejected=[];
          event('ANALYZE',true,'Analisis AI tersimpan.');stage('ANALYZE');
          point.proposal=response;event('PROPOSE',true,'Proposal tersimpan; belum diterapkan.');
          for(const p of response.alignmentProposals || [])if(p.validationStatus==='REJECTED')event('PROPOSE',false,(p.validationIssues || [p.reason]).join('; '),p.id);
          stage('PROPOSE');
        }else{
          point.verification=response;
          for(const action of request.actions || [])if(response.step07SemanticChecks?.some(c=>c.actionId===action.id&&c.verdict==='SUPPORTED'))point.verifiedDependencies![action.id]=step07ActionDependency(action,mapping.units,options.atp,options.tp);
          event('VERIFY',true,'Hasil verifikasi tersimpan; otorisasi tetap diperiksa engine.');stage('VERIFY');
        }
        return response;
      };
      const result=await pass({...options,checkpointContext:undefined,repairState:point.repairState,globalReconciliationOnly:id==='GLOBAL',diagnosticContext:context,baselineUnits:checkpoint.beforeUnits,baselineIssueIds:checkpoint.initialIssueIds,activeUnitId:id==='GLOBAL'?undefined:id,isolatedActions:true,mapping:current,persistedMapping:persisted,saveInitialProgress:!persisted||computeMappingFingerprint(current.units,options.atp,options.tp)!==computeMappingFingerprint(persisted.units,options.atp,options.tp),
        timeoutMs:Math.max(1,deadline-Date.now()),analyze,
        isCurrent:()=>{try{checkFresh();return true;}catch{return false;}},
        onCheckpoint:(phase,data)=>{
          checkFresh();current=structuredClone(data.mapping);
          const actionId=data.action?.id || data.actionId;
          event(phase,data.success,data.issues?.join('; ') || (data.success?'Tahap selesai.':'Tahap ditolak.'),actionId);
          if(!data.success&&actionId&&['PROPOSE','VERIFY','FILTER','APPLY'].includes(phase)){
            if(!point.rejected!.includes(actionId))point.rejected!.push(actionId);
            delete point.verifiedDependencies![actionId];
            if(point.verification?.step07SemanticChecks)point.verification.step07SemanticChecks=point.verification.step07SemanticChecks.filter(c=>c.actionId!==actionId);
          }
          if(phase==='VERIFY'&&data.checks){point.verification={summary:{} as any,atpFindings:[],materialFindings:[],...point.verification,step07SemanticChecks:data.checks};}
          if(phase==='FILTER'&&data.action?.sourceUnitId&&data.action.sourceUnitId!==data.action.targetUnitId)deferred.push(data.action);
          if(phase==='APPLY'&&data.success&&data.action&&!point.applied.includes(data.action.id))point.applied.push(data.action.id);
          point.source=source(id);
          if(phase==='VALIDATE'){
            const done=id==='GLOBAL'?assess(current,options).canProceed:!(assess(current,options).repairIssues || []).some(i=>i.unitId===id);
            point.status=done?'DONE':point.repairState?.status || 'BLOCKED';point.dependency=done?dependency(id):canonical;
            point.cacheUsable=Boolean(point.analysis || point.proposal);
            recordStep07Diagnostic(context,{kind:'CACHE',unitId:id,phase:'VALIDATE',cache:'RETAINED',reason:`Hasil valid dipertahankan; applied/rejected dipisahkan dan dependensi diverifikasi per tindakan; status=${point.status}.`});
            for(const p of point.proposal?.alignmentProposals || [])if(p.action&&!point.applied.includes(p.id)&&!point.events.some(e=>e.actionId===p.id&&!e.success))event('FILTER',false,'Tidak lolos fokus/gap, redundan, atau belum diperlukan; tidak diterapkan.',p.id);
          }
          stage(phase,data);
        },
        persist:async mapping=>withStep07StorageWrite(()=>{
          checkFresh();current=mapping;point.stage='SAVE';point.status='RUNNING';work('SAVE','Menunggu simpan draft');persist();
          if(!options.save(mapping)){event('SAVE',false,'Penyimpanan draft ditolak.');persist();return false;}
          const actual=getATPUnitMappingV5(context.yearPlanId);
          if(!actual||computeMappingFingerprint(actual.units,options.atp,options.tp)!==computeMappingFingerprint(mapping.units,options.atp,options.tp))throw new Error('SAVE_NOT_CONFIRMED: hasil penyimpanan tidak sesuai draft.');
          persisted=actual;storedKey=step07PersistedKey(actual,options.atp,options.tp);current=structuredClone(actual);
          point.source=source(id);point.status=(id==='GLOBAL'?assess(current,options).canProceed:!(assess(current,options).repairIssues || []).some(i=>i.unitId===id))?'DONE':point.repairState?.status || 'BLOCKED';point.dependency=point.status==='DONE'?dependency(id):canonical;
          event('SAVE',true,'Draft Bab tersimpan atomik di V5.');stage('SAVE');return true;
        },deadline-Date.now())});
      result.appliedActions.forEach(id=>allApplied.add(id));result.appliedActions=[...allApplied];latest=result;current=structuredClone(result.mapping);
      if(result.outcome==='NEEDS_TEACHER_REVIEW')point.status='NEEDS_TEACHER_REVIEW';
      else if(!result.saved&&result.issues.some(i=>classifyStep07Failure(i)==='API_FAILURE'))point.status='BLOCKED';
      recordStep07Diagnostic(context,{kind:'TERMINAL',unitId:id,phase:point.stage,category:result.outcome,success:result.saved||point.status==='DONE',persisted:result.persisted,reason:`checkpoint=${point.status}; remaining=${result.progress.remaining}; ${result.issues.join('; ')}`});
      if(result.persisted&&persisted)current=structuredClone(persisted);
      if(!result.persisted&&point.stage==='SAVE'&&persisted&&computeMappingFingerprint(persisted.units,options.atp,options.tp)===computeMappingFingerprint(current.units,options.atp,options.tp)){current=structuredClone(persisted);}
      event(point.stage,!result.stale&&point.status==='DONE',result.issues.join('; ') || result.outcome);persist();
      return result;
    };
    const initial=assess(current,options);
    for(const unit of current.units)if(!(initial.repairIssues || []).some(i=>i.unitId===unit.id)&&!checkpoint.units[unit.id]){
      checkpoint.units[unit.id]={source:source(unit.id),baseSource:source(unit.id),dependency:dependency(unit.id),stage:'VALIDATE',status:'DONE',applied:[],events:[{stage:'VALIDATE',success:true,reason:'Validator lokal lengkap; Bab dilewati tanpa AI.'}]};
    }
    persist();
    const queue=current.units.filter(u=>(initial.repairIssues || []).some(i=>i.unitId===u.id)).sort((a,b)=>(initial.repairIssues || []).filter(i=>i.unitId===b.id).length-(initial.repairIssues || []).filter(i=>i.unitId===a.id).length);
    for(const unit of queue){
      const result=await execute(unit.id);
      if(result.stale||['TIMEOUT','BUDGET_LIMIT','SAVE_FAILED'].includes(result.outcome)||result.issues.some(i=>i.includes('CHECKPOINT_')||classifyStep07Failure(i)==='API_FAILURE'))return result;
    }
    // A full shared readiness check and cross-Bab reconciliation always finish the run.
    const blocked=current.units.filter(u=>(assess(current,options).repairIssues || []).some(i=>i.unitId===u.id)).map(u=>u.id);
    if(blocked.length&&!deferred.length){
      recordStep07Diagnostic(context,{kind:'GLOBAL_SKIPPED',unitId:'GLOBAL',phase:'VALIDATE',category:'NEEDS_TEACHER_REVIEW',reason:`Masalah lokal tidak diulang di GLOBAL: [${blocked.join(', ')}].`});
      if(!latest)throw new Error('NEEDS_TEACHER_REVIEW: masalah lokal belum terselesaikan.');
      if(current.step07AutoRepair){
        current={...current,step07AutoRepair:{...current.step07AutoRepair,runId:current.step07AutoRepair.runId+'-review',outcome:'NEEDS_TEACHER_REVIEW',verifiedFingerprint:undefined,expectedStoredFingerprint:storedKey,issues:[...latest.issues,'NEEDS_TEACHER_REVIEW: periksa Bab lokal yang belum didukung substansi.']}};
        if(assess(current,options).canSaveDraft)await withStep07StorageWrite(()=>{checkFresh();const expected=current.step07AutoRepair!.runId;if(!options.save(current))throw new Error('CHECKPOINT_SAVE_FAILED: status tinjauan belum tersimpan.');persisted=getATPUnitMappingV5(context.yearPlanId);if(!persisted||persisted.step07AutoRepair?.runId!==expected||persisted.step07AutoRepair.outcome!=='NEEDS_TEACHER_REVIEW'||computeMappingFingerprint(persisted.units,options.atp,options.tp)!==computeMappingFingerprint(current.units,options.atp,options.tp))throw new Error('SAVE_NOT_CONFIRMED');current=structuredClone(persisted);storedKey=step07PersistedKey(persisted,options.atp,options.tp);},deadline-Date.now());
      }
      persist();return {...latest,mapping:current,readiness:resolveATPUnitMappingReadiness(current,options.atp,options.tp),outcome:'NEEDS_TEACHER_REVIEW',saved:false,persisted:Boolean(persisted&&persisted.step07AutoRepair?.runId===current.step07AutoRepair?.runId&&current.step07AutoRepair?.outcome==='NEEDS_TEACHER_REVIEW'),issues:current.step07AutoRepair?.issues || latest.issues};
    }
    recordStep07Diagnostic(context,{kind:'GLOBAL_ENTER',unitId:'GLOBAL',phase:'VALIDATE',category:blocked.length?'GLOBAL_CROSS_UNIT_CONFLICT':'GLOBAL_VALIDATION',reason:`Bab lengkap=${current.units.length-blocked.length}/${current.units.length}; konflik lintas-Bab=${deferred.length}. GLOBAL tidak menerapkan ulang perbaikan lokal.`});
    const reconciled=await execute('GLOBAL');
    if(reconciled.saved){
      const readiness=assess(current,options);
      for(const unit of current.units){const point=checkpoint.units[unit.id];if(point&&!(readiness.repairIssues || []).some(i=>i.unitId===unit.id)&&(point.status!=='DONE'||point.source!==source(unit.id))){
        point.status='DONE';point.source=source(unit.id);point.dependency=dependency(unit.id);if(point.repairState)point.repairState.status=undefined;
        point.events.push({stage:'VALIDATE',success:true,reason:'Konflik lintas-Bab terselesaikan; validasi global dan simpan draft terkonfirmasi.'});
        recordStep07Diagnostic(context,{kind:'LOCAL_STATUS_RECONCILED',unitId:unit.id,phase:'VALIDATE',success:true,reason:'Status disinkronkan dari readiness global setelah simpan; bukti semantik tetap berasal dari engine.'});
      }}
      persist();
    }
    return reconciled;
  });}catch(error){return fallback(error instanceof Error?error.message:String(error));}
}

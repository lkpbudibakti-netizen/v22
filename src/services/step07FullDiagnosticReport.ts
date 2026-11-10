import type {ATPData,TPData,ATPUnitMappingData} from '../types';
import type {Step07Checkpoint,Step07CheckpointContext,Step07UnitCheckpoint,Step07WorkStatus} from './step07CheckpointService';
import {readStep07Checkpoint,resolveStep07CheckpointContext} from './step07CheckpointService';
import {resolveATPUnitMappingReadiness} from './atpMappingReadinessService';
import {detectStep07Mode} from './step07HybridRepairService';
import {APP_BUILD_ID,APP_BUILD_SHA,APP_BUILD_DIRTY} from '../config/buildInfo';
import {readStep07Diagnostics,redactStep07Diagnostic,redactStep07PrivateContext,step07DiagnosticFingerprint} from './step07DiagnosticsService';

export interface Step07FullReportInput {mapping:ATPUnitMappingData;atp:ATPData;tp:TPData;work?:Step07WorkStatus;error?:string|null;context?:Step07CheckpointContext;}
const text=(value:unknown)=>redactStep07Diagnostic(value);
const failedFlag=(reason:unknown)=>/STEP07_(?:TIMEOUT|STAGNATED|REPEATED_ISSUES|BUDGET)|API_.*ERROR|API_NON_JSON|SAVE_FAILED|CHECKPOINT_/.test(String(reason));
/** Read-only projection: no checkpoint reset, AI request, apply, or save. */
export function buildStep07FullDiagnosticReport(input:Step07FullReportInput):string {
  const {mapping,atp,tp}=input,lines:string[]=[];let context=input.context,checkpoint:Step07Checkpoint|undefined,checkpointError='';
  try{context ||= resolveStep07CheckpointContext(mapping.academicSettingId);checkpoint=readStep07Checkpoint(context);}catch(error){checkpointError=text(error instanceof Error?error.message:error);}
  const scoped=context || {yearPlanId:mapping.academicSettingId};
  const buffers=[readStep07Diagnostics(scoped)];
  if(context)buffers.push(readStep07Diagnostics({yearPlanId:mapping.academicSettingId}));
  const events=buffers.flatMap(b=>b.events).sort((a,b)=>a.time.localeCompare(b.time));
  const last=events.at(-1),lastSuccess=events.filter(e=>e.success&&e.phase&&['STAGE','HTTP_RESULT'].includes(e.kind)&&!failedFlag(e.reason)).at(-1);
  const section=(name:string,run:()=>void)=>{lines.push('\n=== '+name+' ===');try{run();}catch(error){lines.push('SECTION_UNAVAILABLE: '+text(error instanceof Error?error.message:error));}};
  lines.push('ADMINISTRASI GURU AI — STEP07 DIAGNOSTIK LENGKAP',`Build: ${APP_BUILD_ID}`,`Commit: ${APP_BUILD_SHA || 'unavailable'}; dirty=${APP_BUILD_DIRTY ?? 'unknown'}`,`Waktu laporan: ${new Date().toISOString()}`);
  section('RINGKASAN',()=>{
    const readiness=resolveATPUnitMappingReadiness(mapping,atp,tp,undefined,{evaluateRepair:true}),normal=resolveATPUnitMappingReadiness(mapping,atp,tp),remaining=readiness.repairIssues || [];
    const completed=mapping.units.filter(u=>!remaining.some(i=>i.unitId===u.id)).length;
    lines.push(`Mode: ${checkpoint?.mode || input.work?.mode || detectStep07Mode(mapping,{atp,tp})}`,`Fase: ${input.work?.stage || last?.phase || (checkpoint?.activeUnitId?checkpoint.units[checkpoint.activeUnitId]?.stage:'UNKNOWN')}`,`Bab aktif: ${checkpoint?.activeUnitId || input.work?.activeUnitId || last?.unitId || 'UNKNOWN'}`,`Bab selesai: ${completed}/${mapping.units.length}; masalah tersisa: ${remaining.length}`,`Readiness Step08: ${normal.canProceed}; candidate=${readiness.canProceed}; isValid=${readiness.validationResult?.isValid}; isComplete=${readiness.validationResult?.isComplete}`,`TP canonical=${tp.items.length}; ATP canonical=${atp.items.length}; materi=${mapping.units.reduce((n,u)=>n+u.materials.length,0)}`,`Outcome draft: ${mapping.step07AutoRepair?.outcome || 'legacy/unavailable'}; progres=${JSON.stringify(mapping.step07AutoRepair?.progress || null)}`);
    if(input.error)lines.push('Error UI: '+text(input.error));
    lines.push('Stagnasi/guard:');for(const e of events.filter(e=>['PASS_RESULT','TERMINAL','RUN_ERROR'].includes(e.kind)&&(!e.success||e.category!=='COMPLETE')).slice(-12))lines.push(`${e.unitId || '-'} / ${e.phase || '-'} / ${e.category || '-'}: ${text(e.reason)}`);
    lines.push(`Tahap sukses terakhir (telemetri): ${lastSuccess?`${lastSuccess.time} / ${lastSuccess.unitId || '-'} / ${lastSuccess.phase} / ${lastSuccess.kind}`:'belum ada telemetri; lihat checkpoint per Bab'}`);
  });
  section('STATUS DAN ALASAN SETIAP BAB',()=>{
    const remaining=resolveATPUnitMappingReadiness(mapping,atp,tp,undefined,{evaluateRepair:true}).repairIssues || [];
    for(const unit of mapping.units){
      const point=checkpoint?.units[unit.id],issues=remaining.filter(i=>i.unitId===unit.id),terminal=events.filter(e=>e.kind==='TERMINAL'&&e.unitId===unit.id).at(-1);
      lines.push(`\nBab ${unit.order}: ${text(unit.title)} [${unit.id}]`, `Readiness lokal=${issues.length?'BLOCKED':'DONE'}; checkpoint=${point?.status || 'NOT_RECORDED'}; stage=${point?.stage || '-'}; outcome=${terminal?.category || '-'}; cacheUsable=${point?.cacheUsable ?? 'unknown'}`);
      for(const issue of issues)lines.push(`ISSUE ${issue.id}: ${text(issue.message)}; TP=[${(issue.tpIds || []).join(', ')}]; ATP=[${(issue.atpIds || []).join(', ')}]`);
      if(point)describePoint(point,lines);
    }
    if(checkpoint?.units.GLOBAL){lines.push('\nGLOBAL');describePoint(checkpoint.units.GLOBAL,lines);}
  });
  section('ISSUE GLOBAL TP/ATP/MATERI DAN PENGUNCI STEP08',()=>{
    const ready=resolveATPUnitMappingReadiness(mapping,atp,tp,undefined,{evaluateRepair:true});
    for(const issue of ready.repairIssues || [])lines.push(`${issue.id} | Bab=${issue.unitId || '-'} | materi=${issue.materialId || '-'} | ${text(issue.message)}`);
    for(const blocker of resolveATPUnitMappingReadiness(mapping,atp,tp).blockers)lines.push('BLOCKER: '+text(blocker));
  });
  section('CHECKPOINT / RESUME / INVALIDASI / PERSISTENSI',()=>{
    lines.push(`Read error: ${checkpointError || 'none'}`,`Schema=${checkpoint?.schemaVersion ?? 'unavailable'}; revision=${checkpoint?.revision ?? 'unavailable'}`,`Scope IDs: year=${text(mapping.academicSettingId)}; profile=${text(context?.profileId || 'unknown')}; school=${text(context?.schoolId || 'unknown')}`);
    if(checkpoint)lines.push(`Identity hash=${step07DiagnosticFingerprint(checkpoint.context.identityFingerprint)}; canonical hash=${step07DiagnosticFingerprint(checkpoint.canonical)}; stored source hash=${step07DiagnosticFingerprint(checkpoint.baseStoredKey)}`,`Buffered draft=${Boolean(checkpoint.workingMapping)}; invalidated records=${checkpoint.invalidated?.length || 0}`);
    for(const old of checkpoint?.invalidated || [])lines.push(`INVALIDATED ${old.unitId}: ${text(old.reason)}; stage=${old.checkpoint.stage}; status=${old.checkpoint.status}; sourceHash=${step07DiagnosticFingerprint(old.checkpoint.source)}`);
    lines.push('Checkpoint read-only: laporan ini tidak mereset checkpoint, memulai AI, menerapkan proposal, atau menyimpan ulang draft.');
  });
  section('HTTP / REQUEST / FALLBACK',()=>{
    const http=events.filter(e=>e.kind.startsWith('HTTP'));
    if(!http.length)lines.push('HTTP metadata unavailable (build lama, respons belum diterima, atau event sudah keluar ring). Tidak menganggap respons sebagai JSON/Gemini berhasil.');
    for(const e of http)lines.push(JSON.stringify(e));
  });
  section('RING BUFFER DIAGNOSTIK',()=>{
    lines.push(`Batas: 160 event, 100000 karakter serialisasi per scope; event terbuang=${buffers.reduce((n,b)=>n+b.dropped,0)}`);
    for(const b of buffers)if(b.persistenceError)lines.push(b.persistenceError);
    for(const e of events.filter(e=>!e.kind.startsWith('HTTP')))lines.push(JSON.stringify(e));
  });
  return redactStep07PrivateContext(lines.join('\n'),context);
}
function describePoint(point:Step07UnitCheckpoint,lines:string[]):void {
  const proposals=point.proposal?.alignmentProposals || point.analysis?.alignmentProposals || [],checks=point.verification?.step07SemanticChecks || [];
  lines.push(`analysis=${Boolean(point.analysis)}; proposal stored=${proposals.length}; verification=${checks.length}; applied IDs=[${point.applied.join(', ')}]; response history=${point.responses?.length || 0}`);
  if(point.repairState){lines.push(`repair attempts=${point.repairState.attempts}; status=${point.repairState.status || 'ACTIVE'}; rejected fingerprints=${point.repairState.seen.length}`);for(const failure of point.repairState.failures)lines.push(`FAILURE ${failure.category} | ${failure.phase} | action=${failure.actionId}: ${text(failure.reason)}`);}
  const saved=point.events.filter(e=>e?.stage==='SAVE'&&e.success&&!failedFlag(e.reason)).at(-1),success=point.events.filter(e=>e?.success&&!failedFlag(e.reason)).at(-1);
  lines.push(`Save terkonfirmasi=${Boolean(saved)}; tahap sukses checkpoint terakhir=${success?.stage || '-'}; sourceHash=${step07DiagnosticFingerprint(point.source)}; dependencyHash=${step07DiagnosticFingerprint(point.dependency)}`);
  for(const p of proposals)lines.push(`PROPOSAL ${p.id}: ${p.action?.type || p.proposalType || '-'}; status=${p.validationStatus}; target=${p.targetUnitId}/${p.targetMaterialId || '-'}; TP=[${p.tpIds?.join(', ') || ''}]; before=${text(p.before)}; after=${text(p.after)}; alasan=${text(p.reason)}; issues=${text(p.validationIssues?.join('; ') || '')}`);
  for(const c of checks){lines.push(`VERIFY ${c.actionId}: ${c.verdict}; ${text(c.reason)}; missing=${text(c.missingEvidence?.join('; ') || '')}`);for(const e of c.evidence || [])lines.push(`EVIDENCE ${e.tpId}: TP=${text(e.tpQuote)}; materi=${text(e.materialQuote)}; kompetensi=${text(e.competenceQuote)}; konteks=${text(e.contextQuote)}`);}
  for(const e of point.events)if(e)lines.push(`${e.stage} | ${e.actionId || '-'} | success=${e.success} | ${e.failureCategory || '-'} | ${text(e.reason)}${e.success&&failedFlag(e.reason)?' [LEGACY_FLAG_INCONSISTENT: bukan bukti sukses]':''}`);
}

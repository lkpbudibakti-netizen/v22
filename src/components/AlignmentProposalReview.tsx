import React from 'react';
import { alignmentProposalDiagnostics, alignmentProposalStatus, toggleAlignmentProposalSelection, type AlignmentProposal } from '../services/mappingAlignmentService';
import type { MappingPedagogicalFinding } from '../services/mappingAlignmentService';
import type { MappingReadiness } from '../services/atpMappingReadinessService';
import type { ATPUnitMapping, ATPData, TPData } from '../types';
import { buildMappingMaterialResolutions, formatMappingUnitTitle } from '../services/mappingAlignmentService';
import type { MappingAnalysisResult } from '../services/aiService';

const actionLabels:Record<string,string>={EDIT_UNIT_TITLE:'Perbaikan judul Bab',LINK_TP:'Penyelarasan TP/ATP',EDIT_MATERIAL:'Perbaikan lingkup materi',ADD_MATERIAL:'Penambahan lingkup materi',MOVE_MATERIAL:'Pemindahan lingkup materi',RESTRUCTURE_UNIT:'Penyesuaian urutan materi',ASSIGN_ATP_TO_UNIT:'Penyelarasan Bab',ADD_MATERIAL_TO_UNIT:'Penambahan lingkup materi',ALIGN_EXISTING_MATERIAL:'Penyelarasan lingkup materi',RECOVER_ATP_LINEAGE:'Pemulihan relasi TP/ATP'};

/** Presentation-only diff. Recommendations never count as applied changes. */
export function inlineMappingChanges(units:ATPUnitMapping[],baseline:ATPUnitMapping[],unitId:string,materialId?:string) {
  const unit=units.find(u=>u.id===unitId),oldUnit=baseline.find(u=>u.id===unitId);
  const current=materialId?unit?.materials.find(m=>m.id===materialId):unit;
  const oldOwner=materialId?baseline.find(u=>u.materials.some(m=>m.id===materialId)):oldUnit;
  const before=materialId?oldOwner?.materials.find(m=>m.id===materialId):oldUnit;
  const changes:{label:string;before:string;after:string}[]=[];
  if (!current) return changes;
  if (!before) changes.push({label:'Ditambahkan',before:'Belum ada dalam pemetaan tersimpan',after:current.title});
  else {
    if (before.title!==current.title) changes.push({label:'Diedit',before:before.title,after:current.title});
    const ids=(value:string[])=>JSON.stringify([...value].sort());
    if (ids(before.linkedTpIds)!==ids(current.linkedTpIds)||ids(before.linkedAtpItemIds)!==ids(current.linkedAtpItemIds)) changes.push({label:'Diselaraskan',before:`TP: ${before.linkedTpIds.join(', ')}; ATP: ${before.linkedAtpItemIds.join(', ')}`,after:`TP: ${current.linkedTpIds.join(', ')}; ATP: ${current.linkedAtpItemIds.join(', ')}`});
    if (materialId&&oldOwner?.id!==unitId) changes.push({label:'Diselaraskan',before:oldOwner?.title || '',after:unit!.title});
    if (!materialId&&oldUnit&&JSON.stringify(oldUnit.materials.map(m=>m.id))!==JSON.stringify(unit!.materials.map(m=>m.id))) changes.push({label:'Diselaraskan',before:oldUnit.materials.map(m=>m.title).join(' → '),after:unit!.materials.map(m=>m.title).join(' → ')});
  }
  return changes;
}

interface Props {
  proposals: AlignmentProposal[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  readiness?: MappingReadiness;
  findings?: MappingPedagogicalFinding[];
  units?: ATPUnitMapping[];
  atp?: ATPData;
  tp?: TPData;
  gaps?: {kind:string;id:string;reason:string}[];
  onReviewMaterial?: (unitId:string, materialId:string, title:string, tpIds:string[], reason:string, newTitle:string, replace:boolean) => void;
  onConfirmOrigin?: (unitId:string, materialId:string, title:string) => void;
  inlineScope?: {unitId:string;materialId?:string};
  baselineUnits?: ATPUnitMapping[];
  onApproveProposal?: (ids:Set<string>, amendment?:{id:string;after:string;reason:string})=>void;
  onRejectProposal?: (id:string)=>void;
  rejectedIds?: Set<string>;
  analysis?: MappingAnalysisResult | null;
  materialResolutions?: ReturnType<typeof buildMappingMaterialResolutions>;
}

/** A rejected proposal remains visible, with an explicitly disabled checkbox and original issues. */
export function AlignmentProposalReview({ proposals, selectedIds, onSelectionChange, readiness, findings = [], units = [], atp, tp, gaps, onReviewMaterial, onConfirmOrigin, inlineScope, baselineUnits=[], onApproveProposal, onRejectProposal, rejectedIds=new Set(), analysis, materialResolutions }: Props) {
  const diagnostic = alignmentProposalDiagnostics(proposals);
  const resolutions = materialResolutions || (atp && tp ? buildMappingMaterialResolutions(units,atp,tp,proposals,gaps) : []);
  const history=units.flatMap(unit=>[...(unit.actionHistory || []),...(unit.titleHistory || []),...unit.materials.flatMap(material=>material.titleHistory || [])]);
  const automaticDone=new Set(history.filter(record=>record.approval==='AUTOMATIC'&&!history.some(undo=>undo.undoOf===record.id)).map(record=>record.id)).size;
  const renderResolution=(resolution:ReturnType<typeof buildMappingMaterialResolutions>[number])=><>        <p>Relasi tersimpan: TP [{resolution.linkedTpIds.join(', ')}] · ATP [{resolution.linkedAtpItemIds.join(', ')}]</p><p>{resolution.reason}</p>
        {resolution.origin==='UNVERIFIED' && <div className="bg-amber-50 p-2"><p>Asal materi alignment-* belum dapat dibuktikan dari riwayat. ID bukan bukti persetujuan. Materi dipertahankan.</p>
          {onConfirmOrigin && <button type="button" className="underline" onClick={()=>onConfirmOrigin(resolution.unitId,resolution.materialId,resolution.title)}>ACC keberadaan materi saat ini dan catat persetujuan</button>}</div>}
        <form key={`${resolution.title}:${resolution.linkedTpIds.join(',')}`} onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);onReviewMaterial?.(resolution.unitId,resolution.materialId,resolution.title,data.getAll('tpId').map(String),String(data.get('reason')||''),String(data.get('newTitle')||resolution.title),data.has('replace'));}}>
          <p>Usulan AI yang lolos pemeriksaan sumber dapat dipilih pada daftar proposal. Opsi kanonikal berikut bukan klaim relevansi; periksa kompetensi, aktivitas dan cakupan.</p>
          {resolution.candidates.map(candidate=><details key={candidate.tpId}><summary>{candidate.code || candidate.tpId} · {candidate.suggested?candidate.needsEvidence?'Kandidat AI: lengkapi bukti lalu ACC':'Usulan AI untuk ACC':'Pembanding untuk tinjauan'}{candidate.blocked?' · Tidak dapat diterapkan':''}</summary>
            <p>TP: {candidate.statement}</p><p>Kompetensi: {candidate.competence}</p><p>Bukti materi tersedia: “{candidate.materialQuote}”</p><p>{candidate.reason}</p><p>ATP: {candidate.atpIds.join(', ')} · {candidate.impact}</p>
            {candidate.issues.map(issue=><p key={issue}>{issue}</p>)}
            {onReviewMaterial && <label><input type="checkbox" name="tpId" value={candidate.tpId} disabled={candidate.blocked}/> Saya menilai aktivitas dan cakupan materi mendukung TP ini</label>}
          </details>)}
          {onReviewMaterial && <><label className="block">Usulan judul (opsional; perubahan cakupan memerlukan ACC)<input name="newTitle" defaultValue={resolution.title} required className="block w-full border rounded p-2"/></label>
            <label className="block"><input type="checkbox" name="replace"/> Ganti relasi TP lama dengan pilihan ini (tanpa opsi ini relasi manual lama dipertahankan). Tanpa TP terpilih berarti kosongkan relasi untuk ditinjau ulang; Step 08 tetap terkunci. Klaim Bab yang hanya didukung relasi lama juga dikoreksi.</label>
            <label className="block">Jelaskan aktivitas yang menunjukkan kompetensi TP dan alasan relasinya<textarea name="reason" required className="block w-full border rounded p-2"/></label>
            <button type="submit" className="underline">ACC penyelarasan judul/relasi ke draf dan catat bukti guru</button></>}
          <p>Jika bukti belum tersedia, lengkapi uraian aktivitas atau analisis ulang. Tidak ada TP yang ditautkan otomatis dari daftar pembanding.</p>
        </form></>;
  if (inlineScope) {
    const {unitId,materialId}=inlineScope;
    const owns=(targetUnitId:string,targetMaterialId?:string)=>materialId ? targetMaterialId===materialId : targetUnitId===unitId&&(!targetMaterialId||!units.some(u=>u.materials.some(m=>m.id===targetMaterialId)));
    const scoped=proposals.filter(p=>owns(p.targetUnitId,p.targetMaterialId));
    const resolution=resolutions.find(r=>r.unitId===unitId&&r.materialId===materialId);
    const changes=inlineMappingChanges(units,baselineUnits,unitId,materialId);
    const legacy=[...(analysis?.atpFindings || []),...(analysis?.materialFindings || [])].filter(f=>!rejectedIds.has(f.id)&&f.action&&owns(f.action.targetUnitId, 'targetMaterialId' in f.action?f.action.targetMaterialId:undefined));
    if (!changes.length&&!scoped.length&&!legacy.length&&(!resolution||resolution.status==='RESOLVED')) return null;
    const edit=(event:React.MouseEvent<HTMLButtonElement>)=>{
      const row=event.currentTarget.closest('[data-mapping-material]') || event.currentTarget.closest('[id^="mapping-unit-"]');
      row?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      const form=row?.querySelector<HTMLDetailsElement>('[data-inline-review]');if(form)form.open=true;
    };
    return <div data-inline-alignment={materialId || unitId} className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-2">{changes.map((change,index)=><details key={index} data-change-badge={change.label} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1">
        <summary className="cursor-pointer font-semibold">{change.label}</summary><p><del>{change.before}</del> → <ins>{change.after}</ins></p>
      </details>)}</div>
      {scoped.map(proposal=>{
        const status=alignmentProposalStatus(proposal),declined=rejectedIds.has(proposal.id),ready=status==='READY'&&proposal.approval!=='AUTOMATIC'&&!declined;
        if(status==='ALREADY_APPLIED') return null;
        return <div key={proposal.id} data-inline-proposal={proposal.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="font-semibold">{declined?'Ditolak guru':ready?'Usulan · Perlu ACC':'Belum selesai'} · {actionLabels[proposal.proposalType || proposal.action?.type || ''] || 'Usulan perlu ditinjau'}</p>
          <p>{proposal.before || '(materi baru)'} → {proposal.after || proposal.before}</p><p className="line-clamp-2">{proposal.reason}</p>
          <details><summary>Alasan dan dampak</summary><p>{proposal.reason}</p><p>TP: {proposal.tpIds.map(id=>tp?.items.find(item=>item.id===id)?.code || id).join(', ')}</p><p>TP baru tercakup: {proposal.impact.newlyCoveredTpIds.join(', ') || '-'}; ATP baru: {proposal.impact.newlyMappedAtpIds.join(', ') || '-'}</p>
            {proposal.action?.sourceUnitId&&<p>Bab asal: {proposal.action.sourceUnitId}</p>}{proposal.action?.materialOrder&&<p>Urutan usulan: {proposal.action.materialOrder.join(' → ')}</p>}
            {(proposal.validationIssues || []).map(issue=><p key={issue}>{issue}</p>)}</details>
          {!declined&&<div className="flex flex-wrap gap-3 items-center"><button type="button" disabled={!ready} onClick={()=>onApproveProposal?.(new Set([proposal.id]))} className="font-semibold underline disabled:opacity-40">Setujui</button>
            {proposal.action&&['ADD_MATERIAL','EDIT_MATERIAL','EDIT_UNIT_TITLE'].includes(proposal.action.type)?<details><summary className="cursor-pointer underline">Ubah</summary><form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);onApproveProposal?.(new Set([proposal.id]),{id:proposal.id,after:String(data.get('after')||''),reason:String(data.get('reason')||'')});}}>
              <label className="block">Judul usulan<input name="after" defaultValue={proposal.after} required className="block border rounded p-2 w-full"/></label>
              <label className="block">Alasan<textarea name="reason" defaultValue={proposal.reason} required className="block border rounded p-2 w-full"/></label><button type="submit" className="underline font-semibold">Setujui perubahan usulan</button>
            </form></details>:<button type="button" onClick={edit} className="underline">Ubah</button>}<button type="button" onClick={()=>onRejectProposal?.(proposal.id)} className="underline">Tolak</button>
            {ready&&<label><input type="checkbox" checked={selectedIds.has(proposal.id)} onChange={()=>onSelectionChange(toggleAlignmentProposalSelection(proposals,selectedIds,proposal.id))}/> Pilih untuk ACC bersama</label>}</div>}
        </div>;
      })}
      {legacy.map(finding=><div key={finding.id} data-inline-proposal={finding.id} className="rounded border bg-amber-50 p-3"><p>Usulan · Perlu ACC · {actionLabels[finding.action!.type]}</p><p className="line-clamp-2">{finding.reason}</p><details><summary>Alasan dan dampak</summary><p>{finding.reason}</p><p>TP: {finding.action!.linkedTpIds.map(id=>tp?.items.find(item=>item.id===id)?.code || id).join(', ')}</p></details>
        <button type="button" className="underline mr-3" onClick={()=>onApproveProposal?.(new Set([finding.id]))}>Setujui</button><button type="button" className="underline mr-3" onClick={edit}>Ubah</button><button type="button" className="underline mr-3" onClick={()=>onRejectProposal?.(finding.id)}>Tolak</button>
        <label><input type="checkbox" checked={selectedIds.has(finding.id)} onChange={()=>{const next=new Set(selectedIds);next.has(finding.id)?next.delete(finding.id):next.add(finding.id);onSelectionChange(next);}}/> Pilih untuk ACC bersama</label>
      </div>)}
      {resolution&&resolution.status!=='RESOLVED'&&<details data-inline-review id={`mapping-resolution-${materialId}`} className="rounded border p-2"><summary className="cursor-pointer font-semibold">Ubah / lengkapi penyelarasan{resolution.origin==='UNVERIFIED'?' · Perlu ACC keberadaan materi':''}</summary>{renderResolution(resolution)}</details>}
    </div>;
  }
  return <div className="space-y-3">
    <p id="mapping-execution-summary">Selesai otomatis (riwayat aktif): {automaticDone} · Menunggu persetujuan: {diagnostic.ready} · Belum dapat diselesaikan tanpa bukti/keputusan: {resolutions.filter(r=>r.status==='NEEDS_REVIEW').length}. Simpan Pemetaan untuk menyimpan perubahan draf.</p>
    {readiness && <section id="mapping-readiness-report" role="status" className="rounded-lg bg-slate-50 p-3">
      <h4 className="font-bold">Ringkasan kesiapan Step 07</h4>
      <p>VALID: {readiness.validationResult?.isValid ? 'Ya' : 'Belum'} · COMPLETE: {readiness.validationResult?.isComplete ? 'Ya' : 'Belum'} · READY Step 08: {readiness.canProceed ? 'Ya' : 'Belum'}</p>
      <p>ATP tercakup: {(atp?.items.length || 0) - (readiness.validationResult?.unmappedAtpIds.length || 0)}/{atp?.items.length || 0} · TP tercakup: {(tp?.items.length || 0) - (readiness.validationResult?.uncoveredTpIds.length || 0)}/{tp?.items.length || 0}</p>
      <p>Coverage global tidak membuktikan dukungan materi pada setiap Bab. NEEDS_REVIEW berarti bukti pedagogis belum cukup.</p>
      <details open={!readiness.canProceed}><summary>Syarat lanjut Step 08 dan masalah prioritas</summary>
        {readiness.blockers.length ? <ul>{readiness.blockers.map((issue,i)=><li key={i}>{issue}</li>)}</ul> : <p>Validator yang sama dengan tombol lanjut menyatakan READY. Tinjauan pedagogis tetap terlihat terpisah.</p>}
      </details>
    </section>}
    {!!resolutions.length && <details id="mapping-material-resolutions"><summary>Tindakan untuk setiap materi ({resolutions.length})</summary>
      {resolutions.map(resolution=><details id={`mapping-resolution-${resolution.materialId}`} key={resolution.materialId} className="border rounded p-3 my-2">
        <summary>{formatMappingUnitTitle(units.find(u=>u.id===resolution.unitId)!)} · {resolution.title} · {resolution.status}</summary>
        {renderResolution(resolution)}
      </details>)}
    </details>}
    {!!findings.length && <details id="mapping-pedagogical-findings"><summary>Rekomendasi per Bab/Materi ({findings.length})</summary>
      {findings.map(finding => <details key={finding.id} className="my-2 border rounded p-2" data-finding-category={finding.category}>
        <summary>{finding.priority} · {finding.category} · {units.find(u=>u.id===finding.unitId)?.title || finding.unitId || 'Global'} {finding.materialId || ''} · {finding.status}</summary>
        <p>Masalah/kondisi: {finding.actual}</p><p>Bukti: {finding.evidence}</p><p>Disarankan: {finding.recommendation}</p>
        <p>Dampak: {finding.impact}</p><p>Persetujuan: {finding.approval === 'TEACHER' ? 'Guru diperlukan untuk perubahan' : 'Redaksi otomatis terverifikasi'}</p>
        <button type="button" className="underline font-semibold" onClick={event=>{
          const unit=units.find(u=>u.id===finding.unitId) || units[0];
          const materialId=finding.materialId || unit?.materials[0]?.id;
          const target=event.currentTarget.ownerDocument.getElementById(finding.category==='TITLE_QUALITY'&&!finding.materialId?`mapping-unit-${unit?.id}`:materialId?`mapping-resolution-${materialId}`:`mapping-unit-${unit?.id}`);
          if (!target) return;
          for(let element:HTMLElement|null=target;element;element=element.parentElement) if(element.tagName==='DETAILS') (element as HTMLDetailsElement).open=true;
          target.scrollIntoView({block:'center'});((target.querySelector('textarea') || target.querySelector('input,button')) as HTMLElement|null)?.focus();
        }}>Selaraskan temuan: pilih TP/perbaiki judul dan ACC</button>
      </details>)}
    </details>}
    <details><summary>Perubahan redaksi otomatis dan usulan yang memerlukan persetujuan</summary>
    <div id="alignment-proposal-diagnostics" className="text-xs font-semibold" role="status">
      Siap dipilih: {diagnostic.ready} · Ditolak: {diagnostic.rejected} · Sudah diterapkan: {diagnostic.alreadyApplied}
    </div>
    {diagnostic.rejectionReasons.length > 0 && <details className="text-xs">
      <summary>Alasan penolakan proposal ({diagnostic.rejected})</summary>
      <ul>{diagnostic.rejectionReasons.map(({ reason, count }) => <li key={reason}>{reason} ({count})</li>)}</ul>
    </details>}
    {proposals.map(proposal => {
      const status = alignmentProposalStatus(proposal);
      const ready = status === 'READY' && proposal.approval !== 'AUTOMATIC';
      return <div key={proposal.id} className="border rounded-lg p-3 text-xs space-y-1" data-proposal-status={status}>
        <label className="font-semibold">
          <input type="checkbox" aria-label={`Pilih proposal ${proposal.id}`} disabled={!ready}
            checked={ready && selectedIds.has(proposal.id)}
            onChange={() => onSelectionChange(toggleAlignmentProposalSelection(proposals, selectedIds, proposal.id))} />
          {' '}{ready ? 'Siap dipilih' : status === 'ALREADY_APPLIED' ? 'Sudah diterapkan' : status === 'READY' ? 'Redaksi otomatis terverifikasi' : 'Ditolak'} · {proposal.proposalType || proposal.action?.type || 'Proposal tidak valid'}
        </label>
        <p>{proposal.changeKind || 'REALIGN / CONTENT_CHANGE'} · {proposal.approval === 'AUTOMATIC' ? 'Aksi otomatis terverifikasi independen; tanpa persetujuan tambahan' : 'Memerlukan persetujuan guru'}</p>
        <div>Bab: {proposal.targetUnitId || '(ID tidak valid)'} · Materi: {proposal.targetMaterialId || '(baru)'}</div>
        <div>Sebelum: {proposal.before || '(materi baru)'}</div>
        <div>Sesudah: {proposal.after || proposal.before}</div>
        {proposal.action?.materialOrder && <div>Urutan materi: {proposal.action.materialOrder.join(' → ')}</div>}
        {proposal.action?.sourceUnitId && <div>Bab sumber: {proposal.action.sourceUnitId}</div>}
        <div>TP: {proposal.tpIds.join(', ')}</div>
        <p>{proposal.reason}</p>
        {!ready && (proposal.validationIssues || []).length > 0 && <ul aria-label="Alasan validasi proposal">
          {proposal.validationIssues!.map((issue, index) => <li key={index}>{issue}</li>)}
        </ul>}
        <div>Dampak: TP baru tercakup [{proposal.impact.newlyCoveredTpIds.join(', ')}]; ATP baru terpetakan [{proposal.impact.newlyMappedAtpIds.join(', ')}]</div>
      </div>;
    })}</details>
  </div>;
}

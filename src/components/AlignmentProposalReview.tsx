import React from 'react';
import { alignmentProposalDiagnostics, alignmentProposalStatus, toggleAlignmentProposalSelection, type AlignmentProposal } from '../services/mappingAlignmentService';
import type { MappingPedagogicalFinding } from '../services/mappingAlignmentService';
import type { MappingReadiness } from '../services/atpMappingReadinessService';
import type { ATPUnitMapping, ATPData, TPData } from '../types';
import { buildMappingMaterialResolutions, formatMappingUnitTitle } from '../services/mappingAlignmentService';

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
}

/** A rejected proposal remains visible, with an explicitly disabled checkbox and original issues. */
export function AlignmentProposalReview({ proposals, selectedIds, onSelectionChange, readiness, findings = [], units = [], atp, tp, gaps, onReviewMaterial, onConfirmOrigin }: Props) {
  const diagnostic = alignmentProposalDiagnostics(proposals);
  const resolutions = atp && tp ? buildMappingMaterialResolutions(units,atp,tp,proposals,gaps) : [];
  const history=units.flatMap(unit=>[...(unit.actionHistory || []),...(unit.titleHistory || []),...unit.materials.flatMap(material=>material.titleHistory || [])]);
  const automaticDone=new Set(history.filter(record=>record.approval==='AUTOMATIC'&&!history.some(undo=>undo.undoOf===record.id)).map(record=>record.id)).size;
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
        <p>Relasi tersimpan: TP [{resolution.linkedTpIds.join(', ')}] · ATP [{resolution.linkedAtpItemIds.join(', ')}]</p><p>{resolution.reason}</p>
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
        </form>
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

import React from 'react';
import { alignmentProposalDiagnostics, alignmentProposalStatus, toggleAlignmentProposalSelection, type AlignmentProposal } from '../services/mappingAlignmentService';
import type { MappingPedagogicalFinding } from '../services/mappingAlignmentService';
import type { MappingReadiness } from '../services/atpMappingReadinessService';
import type { ATPUnitMapping, ATPData, TPData } from '../types';

interface Props {
  proposals: AlignmentProposal[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  readiness?: MappingReadiness;
  findings?: MappingPedagogicalFinding[];
  units?: ATPUnitMapping[];
  atp?: ATPData;
  tp?: TPData;
}

/** A rejected proposal remains visible, with an explicitly disabled checkbox and original issues. */
export function AlignmentProposalReview({ proposals, selectedIds, onSelectionChange, readiness, findings = [], units = [], atp, tp }: Props) {
  const diagnostic = alignmentProposalDiagnostics(proposals);
  return <div className="space-y-3">
    {readiness && <section id="mapping-readiness-report" role="status" className="rounded-lg bg-slate-50 p-3">
      <h4 className="font-bold">Ringkasan kesiapan Step 07</h4>
      <p>VALID: {readiness.validationResult?.isValid ? 'Ya' : 'Belum'} · COMPLETE: {readiness.validationResult?.isComplete ? 'Ya' : 'Belum'} · READY Step 08: {readiness.canProceed ? 'Ya' : 'Belum'}</p>
      <p>ATP tercakup: {(atp?.items.length || 0) - (readiness.validationResult?.unmappedAtpIds.length || 0)}/{atp?.items.length || 0} · TP tercakup: {(tp?.items.length || 0) - (readiness.validationResult?.uncoveredTpIds.length || 0)}/{tp?.items.length || 0}</p>
      <p>Coverage global tidak membuktikan dukungan materi pada setiap Bab. NEEDS_REVIEW berarti bukti pedagogis belum cukup.</p>
      <details open={!readiness.canProceed}><summary>Syarat lanjut Step 08 dan masalah prioritas</summary>
        {readiness.blockers.length ? <ul>{readiness.blockers.map((issue,i)=><li key={i}>{issue}</li>)}</ul> : <p>Validator yang sama dengan tombol lanjut menyatakan READY. Tinjauan pedagogis tetap terlihat terpisah.</p>}
      </details>
    </section>}
    {!!findings.length && <details id="mapping-pedagogical-findings"><summary>Rekomendasi per Bab/Materi ({findings.length})</summary>
      {findings.map(finding => <details key={finding.id} className="my-2 border rounded p-2" data-finding-category={finding.category}>
        <summary>{finding.priority} · {finding.category} · {units.find(u=>u.id===finding.unitId)?.title || finding.unitId || 'Global'} {finding.materialId || ''} · {finding.status}</summary>
        <p>Masalah/kondisi: {finding.actual}</p><p>Bukti: {finding.evidence}</p><p>Disarankan: {finding.recommendation}</p>
        <p>Dampak: {finding.impact}</p><p>Persetujuan: {finding.approval === 'TEACHER' ? 'Guru diperlukan untuk perubahan' : 'Redaksi otomatis terverifikasi'}</p>
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
        <p>{proposal.changeKind || 'REALIGN / CONTENT_CHANGE'} · {proposal.approval === 'AUTOMATIC' ? 'Redaksi otomatis; tanpa persetujuan tambahan' : 'Memerlukan persetujuan guru'}</p>
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

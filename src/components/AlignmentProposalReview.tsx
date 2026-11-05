import React from 'react';
import { alignmentProposalDiagnostics, alignmentProposalStatus, toggleAlignmentProposalSelection, type AlignmentProposal } from '../services/mappingAlignmentService';

interface Props {
  proposals: AlignmentProposal[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

/** A rejected proposal remains visible, with an explicitly disabled checkbox and original issues. */
export function AlignmentProposalReview({ proposals, selectedIds, onSelectionChange }: Props) {
  const diagnostic = alignmentProposalDiagnostics(proposals);
  return <div className="space-y-3">
    <div id="alignment-proposal-diagnostics" className="text-xs font-semibold" role="status">
      Siap dipilih: {diagnostic.ready} · Ditolak: {diagnostic.rejected} · Sudah diterapkan: {diagnostic.alreadyApplied}
    </div>
    {diagnostic.rejectionReasons.length > 0 && <details className="text-xs">
      <summary>Alasan penolakan proposal ({diagnostic.rejected})</summary>
      <ul>{diagnostic.rejectionReasons.map(({ reason, count }) => <li key={reason}>{reason} ({count})</li>)}</ul>
    </details>}
    {proposals.map(proposal => {
      const status = alignmentProposalStatus(proposal);
      const ready = status === 'READY';
      return <div key={proposal.id} className="border rounded-lg p-3 text-xs space-y-1" data-proposal-status={status}>
        <label className="font-semibold">
          <input type="checkbox" aria-label={`Pilih proposal ${proposal.id}`} disabled={!ready}
            checked={ready && selectedIds.has(proposal.id)}
            onChange={() => onSelectionChange(toggleAlignmentProposalSelection(proposals, selectedIds, proposal.id))} />
          {' '}{ready ? 'Siap dipilih' : status === 'ALREADY_APPLIED' ? 'Sudah diterapkan' : 'Ditolak'} · {proposal.proposalType || proposal.action?.type || 'Proposal tidak valid'}
        </label>
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
    })}
  </div>;
}

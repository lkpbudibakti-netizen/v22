import { productionReferenceIssues } from '../productionValidation';
import type { DocumentGenerationContext } from './types';

export const ATP_DOCUMENT_COLUMNS = [
  'Tahap', 'Tujuan Pembelajaran', 'Alur Tujuan Pembelajaran',
] as const;
export interface ATPDocumentRow {
  stepNumber: number | null;
  focus: string;
  resolvedTPs: Array<{ id: string; code: string; statement: string }>;
  flowLines: string[];
}
export interface ATPDocumentProjection {
  isReady: boolean;
  error?: string;
  rationale: string;
  cpReferenceLines: string[];
  rows: ATPDocumentRow[];
}

export function buildATPDocumentProjection(context: DocumentGenerationContext): ATPDocumentProjection {
  const invalid = (error: string): ATPDocumentProjection => ({ isReady: false, error, rationale: '', cpReferenceLines: [], rows: [] });
  const { cp, tp, atp } = context;
  if (context.workMode === 'production') {
    const errors = productionReferenceIssues('ATP', context);
    if (errors.length) return invalid(errors.join('; '));
    const rows: ATPDocumentRow[] = (atp?.items || []).map(item => {
      const ids = item.linkedTpIds?.length ? item.linkedTpIds : item.tpId ? [item.tpId] : [];
      const resolvedTPs = ids.flatMap(id => {
        const matches = tp?.items.filter(tp => tp.id === id) || [];
        return matches.length === 1 && matches[0].statement?.trim() ? [{ id, code: matches[0].code || id, statement: matches[0].statement }] : [];
      });
      if (!resolvedTPs.length && item.tpStatement?.trim()) resolvedTPs.push({ id: item.tpId || item.id, code: item.tpCode || item.id, statement: item.tpStatement });
      const focus = item.focus?.trim() || item.materialScope?.trim() || '';
      return { stepNumber: Number.isInteger(item.stepNumber) ? item.stepNumber : null, focus, resolvedTPs, flowLines: [focus].filter(Boolean) };
    });
    if (!rows.length || rows.some(row => !row.focus || !row.resolvedTPs.length)) return invalid('Tujuan dan alur/materi minimum pada setiap tahap ATP belum tersedia.');
    return { isReady: true, rows, rationale: atp?.rationale || '', cpReferenceLines: [cp?.generalDescription || '', ...(cp?.elements || []).map(element => [element.name, element.content].filter(Boolean).join(': '))].filter(Boolean) };
  }
  if (!cp || !tp?.items?.length || !atp?.items?.length) return invalid('Data CP, TP, dan ATP harus lengkap untuk ekspor dokumen ATP.');
  const cpReferenceLines = [
    ...(cp.generalDescription?.trim() ? [cp.generalDescription.trim()] : []),
    ...(cp.elements || []).map(element => [element.name?.trim(), element.content?.trim()].filter(Boolean).join(': ')).filter(Boolean),
  ];
  if (!cpReferenceLines.length) return invalid('Capaian Pembelajaran / Elemen rujukan belum tersedia.');
  // CP elements are references for the document, not guessed joins through TP text or legacy ATP caches.
  const tpById = new Map<string, typeof tp.items>();
  for (const item of tp.items) tpById.set(item.id, [...(tpById.get(item.id) || []), item]);
  const seenItems = new Set<string>();
  const seenSteps = new Set<number>();
  const rows: ATPDocumentRow[] = [];
  for (const item of atp.items) {
    if (typeof item.id !== 'string' || !item.id.trim() || seenItems.has(item.id)) return invalid('Langkah ATP belum valid.');
    seenItems.add(item.id);
    if (!Number.isInteger(item.stepNumber) || item.stepNumber < 1 || seenSteps.has(item.stepNumber)) return invalid('Urutan tahap ATP tidak valid.');
    seenSteps.add(item.stepNumber);
    if (typeof item.focus !== 'string' || !item.focus.trim()) return invalid('Fokus pembelajaran tahap ATP ' + item.stepNumber + ' belum terisi.');
    if (!Array.isArray(item.linkedTpIds) || !item.linkedTpIds.length ||
        item.linkedTpIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(item.linkedTpIds).size !== item.linkedTpIds.length) {
      return invalid('Tujuan Pembelajaran pada tahap ATP ' + item.stepNumber + ' belum dipilih.');
    }
    const resolvedTPs: ATPDocumentRow['resolvedTPs'] = [];
    for (const id of item.linkedTpIds) {
      const matches = tpById.get(id) || [];
      if (matches.length !== 1) return invalid('Tujuan Pembelajaran pada tahap ' + item.stepNumber + ' tidak ditemukan.');
      const objective = matches[0];
      if (!objective.code?.trim() || !objective.statement?.trim()) return invalid('Kode atau rumusan Tujuan Pembelajaran pada tahap ' + item.stepNumber + ' belum lengkap.');
      resolvedTPs.push({ id: objective.id, code: objective.code.trim(), statement: objective.statement.trim() });
    }
    rows.push({
      stepNumber: item.stepNumber, focus: item.focus.trim(), resolvedTPs,
      flowLines: [item.focus.trim(),
        'TP terkait: ' + resolvedTPs.map(objective => '[' + objective.code + ']').join(', ')],
    });
  }
  rows.sort((a,b) => a.stepNumber! - b.stepNumber!);
  return { isReady: true, rationale: atp.rationale?.trim() || '', cpReferenceLines, rows };
}

// Keep cell content identical across DOCX and PDF without repeating CP or TP statements.
export function getATPDocumentRowCells(row: ATPDocumentRow): string[][] {
  return [
    [row.stepNumber === null ? 'Tahap ....' : 'Tahap ' + row.stepNumber],
    row.resolvedTPs.length
      ? row.resolvedTPs.map(objective => '[' + objective.code + '] ' + objective.statement)
      : ['................................................'],
    row.flowLines,
  ];
}

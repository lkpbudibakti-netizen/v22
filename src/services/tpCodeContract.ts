import type { TPItem } from '../types';

/** One canonical grammar for generated/manual TP, runtime validation and transfer validation. */
export const CANONICAL_MERDEKA_TP_CODE_REGEX = /^E\d+-[A-Z0-9]{2,5}-\d{2}$/;
export const TP_CODE_FORMAT_DESCRIPTION = 'E<nomor elemen>-<kode lingkup 2–5 alfanumerik kapital>-<nomor 2 digit>, misalnya E1-PGD-01';
export function deriveScopeCode(text = ''): string {
  const words = text.trim().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const single = words[0] || 'MAT';
  const code = words.length > 1 ? words.map(word => word[0]).slice(0, 4).join('') : single.length <= 4 ? single : single.slice(0, 3);
  return code.length >= 2 ? code.toUpperCase() : 'MAT';
}
export function canonicalScopeCode(raw = '', fallback = ''): string {
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return normalized.length >= 2 ? normalized : deriveScopeCode(fallback);
}
type AnalysisSource = { id: string; elementId?: string; elementName?: string; scopeCode?: string; materialScope?: string };
type ElementSource = { id?: string; name: string; code?: string };
export function generateSemanticTPCode(source: AnalysisSource, elements: ElementSource[] = [], existing: TPItem[] = [], editingId?: string): string {
  const index = elements.findIndex(element => (source.elementId && element.id === source.elementId) ||
    source.elementName?.trim().toLowerCase() === element.name.trim().toLowerCase() || (source.elementId && element.code === source.elementId));
  const element = index >= 0 ? elements[index] : undefined;
  const prefix = `${element?.code && /^E\d+$/.test(element.code.toUpperCase()) ? element.code.toUpperCase() : `E${index >= 0 ? index+1 : 1}`}-${canonicalScopeCode(source.scopeCode, source.materialScope || source.elementName)}`;
  const used = new Set(existing.filter(item => item.id !== editingId).map(item => item.code?.trim().toUpperCase()));
  const previous = existing.find(item => item.id === editingId)?.code;
  if (previous?.startsWith(prefix+'-') && CANONICAL_MERDEKA_TP_CODE_REGEX.test(previous) && !used.has(previous)) return previous;
  for (let sequence = 1; sequence <= 99; sequence++) {
    const code = `${prefix}-${String(sequence).padStart(2, '0')}`;
    if (!used.has(code)) return code;
  }
  throw new Error(`TP_CODE_SEQUENCE_EXHAUSTED: ${prefix} telah memakai seluruh nomor 01–99.`);
}

/** Stable ordering for code allocation; never rewrite source analysis or TP identity/lineage. */
export function assignGeneratedTPCodes<T extends Partial<TPItem>>(items: T[], analysis: AnalysisSource[] = [], elements: ElementSource[] = [], preserveIds: Set<string> = new Set()): T[] {
  const output = items.map(item => ({ ...item }));
  const assigned: TPItem[] = [];
  const lineage = (item: Partial<TPItem>) => item.cpAnalysisItemIds?.length ? item.cpAnalysisItemIds : item.cpAnalysisId ? [item.cpAnalysisId] : [];
  const identity = (item: Partial<TPItem>) => JSON.stringify([lineage(item), item.contentScope || '', item.competence || '', item.statement || '']);
  const ordered = [...output].sort((a, b) => identity(a).localeCompare(identity(b), 'en') || (a.id || '').localeCompare(b.id || '', 'en'));
  for (const item of ordered.filter(item => item.id && preserveIds.has(item.id))) {
    if (item.code && CANONICAL_MERDEKA_TP_CODE_REGEX.test(item.code) && !assigned.some(other => other.code === item.code)) assigned.push(item as TPItem);
  }
  for (const item of ordered) {
    if (assigned.includes(item as TPItem)) continue;
    const ids = lineage(item);
    const source = ids.length === 1 ? analysis.find(row => row.id === ids[0]) : undefined;
    // Missing lineage is not repaired here; the atomic/semantic validators still reject it.
    item.code = generateSemanticTPCode(source || { id: '', elementName: item.elementName, scopeCode: item.scopeCode, materialScope: item.contentScope }, elements, assigned);
    item.scopeCode = item.code.split('-')[1];
    assigned.push(item as TPItem);
  }
  return output as T[];
}

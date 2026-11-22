import type { ATPData, TPData } from '../types';

export function getMappingAtpTpIds(item: ATPData['items'][number]): string[] {
  return Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0
    ? item.linkedTpIds : item.tpId ? [item.tpId] : [];
}

/** Bab/material selects exact canonical TP IDs; parent ATP IDs are never AI authority. */
export function deriveMappingAtpIds(tpIds: string[], atp: ATPData, tp: TPData): { atpItemIds: string[]; issues: string[] } {
  const issues: string[] = [];
  if (new Set(tpIds).size !== tpIds.length) issues.push('ID TP pilihan duplikat.');
  for (const id of tpIds) {
    if (typeof id !== 'string' || !id.trim() || tp.items.filter(item => item.id === id).length !== 1) {
      issues.push(`TP canonical '${id}' tidak ditemukan atau ambigu.`);
    }
    if (!atp.items.some(item => getMappingAtpTpIds(item).includes(id))) issues.push(`TP '${id}' tidak memiliki induk ATP canonical.`);
  }
  const parents = atp.items.filter(item => getMappingAtpTpIds(item).some(id => tpIds.includes(id)));
  if (new Set(parents.map(item => item.id)).size !== parents.length) issues.push('ID ATP induk ambigu.');
  return { atpItemIds: [...parents].sort((a, b) => a.stepNumber - b.stepNumber).map(item => item.id), issues };
}

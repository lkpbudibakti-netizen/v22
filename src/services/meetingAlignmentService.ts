import { isEmptyAlignmentMeeting } from './meetingContentService';
export { isEmptyAlignmentMeeting } from './meetingContentService';
import { ATPUnitMappingData, LearningMeeting, UnitExecutionPlanData } from '../types';
import { resolveUnitSemesterPlacement } from './unitSemesterPlanningService';

export interface AlignmentCapacity {
  semester1: { isReady: boolean; targetMeetingCount: number };
  semester2: { isReady: boolean; targetMeetingCount: number };
}
export interface AlignmentRow { unitId: string; title: string; semester: 1 | 2; before: number; proposed: number }
export interface MeetingAlignmentProposal {
  fingerprint: string;
  rows: AlignmentRow[];
  errors: string[];
  totals: { semester: number; target: number; allocated: number }[];
}
export function proposeMeetingAlignment(plan: UnitExecutionPlanData, mapping: ATPUnitMappingData, capacity: AlignmentCapacity): MeetingAlignmentProposal {
  const result: MeetingAlignmentProposal = { fingerprint: JSON.stringify([plan, mapping, capacity]), rows: [], errors: [], totals: [] };
  const placement = resolveUnitSemesterPlacement(plan, mapping);
  if (!plan.semesterPlacement || !placement.isValid) result.errors.push('Tetapkan pembagian semester yang valid sebelum menyelaraskan; unit tidak dipindahkan otomatis.');
  if (plan.mappingId !== mapping.id || plan.basedOnMappingUpdatedAt !== mapping.updatedAt) result.errors.push('Pemetaan berubah. Perbarui struktur sebelum menyelaraskan.');
  const ids = plan.units.flatMap(u => u.meetings.map(m => m.id));
  if (new Set(ids).size !== ids.length || new Set(plan.units.map(u => u.unitId)).size !== plan.units.length) result.errors.push('ID unit atau pertemuan terduplikasi.');
  if (plan.units.length !== mapping.units.length || mapping.units.some(u => !plan.units.some(p => p.unitId === u.id))) result.errors.push('Struktur unit tidak sesuai pemetaan.');
  for (const semester of [1, 2] as const) {
    const cap = semester === 1 ? capacity.semester1 : capacity.semester2;
    const unitIds = new Set(semester === 1 ? placement.semester1UnitIds : placement.semester2UnitIds);
    const units = [...mapping.units].sort((a,b) => a.order - b.order).filter(u => unitIds.has(u.id));
    const rows = units.map(u => {
      const meetings = plan.units.find(p => p.unitId === u.id)?.meetings || [];
      const protectedCount = meetings.filter(m => !isEmptyAlignmentMeeting(m)).length;
      return { unitId: u.id, title: u.title, semester, before: meetings.length, proposed: meetings.length, minimum: Math.max(1, protectedCount) };
    });
    const total = rows.reduce((s,r) => s+r.before,0);
    const target = cap.targetMeetingCount;
    result.totals.push({ semester, target, allocated: total });
    if (!cap.isReady || !Number.isSafeInteger(target) || target < 0) {
      result.errors.push(`Kapasitas kalender Semester ${semester} belum valid.`);
    } else if (rows.reduce((s,r) => s+r.minimum,0) > target || (!rows.length && target > 0)) {
      result.errors.push(`Semester ${semester}: kapasitas ${target} tidak cukup untuk minimum unit dan konten terlindungi (${rows.map(r => `${r.title}: ${r.minimum}`).join(', ')}). Tinjau konten/pengaturan secara manual.`);
    } else if (total <= target && rows.reduce((s,r) => s+Math.max(r.minimum,r.before),0) > target) {
      result.errors.push(`Semester ${semester}: kapasitas tidak cukup untuk mempertahankan alokasi dan minimum seluruh unit. Tinjau alokasi unit kosong.`);
    } else if (total !== target) {
      // Proportional quotas with minimum/protected-content bounds; stable largest remainders.
      const shrinking = total > target;
      rows.forEach(r => { r.proposed = shrinking ? r.minimum : Math.max(1, r.before); });
      let remaining = target - rows.reduce((s,r) => s+r.proposed,0);
      while (remaining > 0) {
        const eligible = rows.map((r,i) => ({r,i})).filter(({r}) => !shrinking || r.proposed < r.before);
        if (!eligible.length) break;
        const weight = eligible.reduce((s,{r}) => s + Math.max(1,r.before),0);
        const quotas = eligible.map(({r,i}) => {
          const exact = remaining * Math.max(1,r.before) / weight;
          const slots = Math.min(Math.floor(exact), shrinking ? r.before-r.proposed : remaining);
          return {r,i,slots,remainder:exact-Math.floor(exact)};
        });
        quotas.forEach(q => {q.r.proposed += q.slots; remaining -= q.slots;});
        quotas.sort((a,b) => b.remainder-a.remainder || a.i-b.i);
        for (const q of quotas) {
          if (remaining > 0 && (!shrinking || q.r.proposed < q.r.before)) {q.r.proposed++; remaining--;}
        }
      }
    }
    result.rows.push(...rows.map(({minimum, ...row}) => row));
  }
  return result;
}
export function applyMeetingAlignment(plan: UnitExecutionPlanData, mapping: ATPUnitMappingData, capacity: AlignmentCapacity, approved: MeetingAlignmentProposal, createId: () => string): UnitExecutionPlanData {
  const current = proposeMeetingAlignment(plan, mapping, capacity);
  if (current.fingerprint !== approved.fingerprint) throw new Error('Kapasitas, pemetaan, atau alokasi berubah. Tinjau usulan terbaru.');
  if (current.errors.length) throw new Error(current.errors.join(' '));
  const used = new Set(plan.units.flatMap(u => u.meetings.map(m => m.id)));
  return { ...plan, updatedAt: new Date().toISOString(), units: plan.units.map(unit => {
    const count = current.rows.find(r => r.unitId === unit.unitId)!.proposed;
    let remove = Math.max(0, unit.meetings.length-count);
    const removed = new Set<string>();
    [...unit.meetings].reverse().forEach(m => { if (remove && isEmptyAlignmentMeeting(m)) { removed.add(m.id); remove--; } });
    if (remove) throw new Error(`Unit ${unit.unitId}: konten terlindungi tidak dapat dikurangi.`);
    const meetings = unit.meetings.filter(m => !removed.has(m.id));
    while (meetings.length < count) {
      const id = createId();
      if (!id || used.has(id)) throw new Error('ID pertemuan baru terduplikasi.');
      used.add(id);
      meetings.push({id, unitId: unit.unitId, order: meetings.length+1, title:'', materialIds:[], linkedAtpItemIds:[], linkedTpIds:[]});
    }
    return {...unit, meetings: meetings.map((m,i) => m.order === i+1 ? m : {...m, order:i+1})};
  }) };
}

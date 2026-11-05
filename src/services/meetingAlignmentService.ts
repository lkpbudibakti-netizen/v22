import { mergeReconciliationContent } from './meetingReconciliationService';
import { isEmptyAlignmentMeeting } from './meetingContentService';
export { isEmptyAlignmentMeeting } from './meetingContentService';
import type { ATPData, ATPUnitMappingData, LearningMeeting, TPData, UnitExecutionPlanData } from '../types';
import { resolveUnitSemesterPlacement } from './unitSemesterPlanningService';
import { validateUnitExecutionPlan } from './unitExecutionPlanService';

export interface AlignmentCapacity {
  semester1: { isReady: boolean; targetMeetingCount: number; totalJP?: number; capacitySource?: string };
  semester2: { isReady: boolean; targetMeetingCount: number; totalJP?: number; capacitySource?: string };
}
export interface MeetingAlignmentContext {
  atp?: ATPData;
  tp?: TPData;
  /** Re-read by the existing V5 writer at approval, including legacy associations. */
  sourceFingerprint: string;
  protectedMeetings: Record<string, string[]>;
  protectedContent: Record<string, LearningMeeting>;
  slotJP: { semester1: number[]; semester2: number[] };
  impacts: string[];
  errors: string[];
}
export interface AlignmentRow { unitId: string; title: string; semester: 1 | 2; before: number; proposed: number }
export interface AlignmentOperation {
  type: 'REMOVE_EMPTY' | 'MERGE' | 'ADD';
  unitId: string;
  meetingIds: string[];
  survivorId?: string;
  titles: string[];
  materialIds: string[];
  linkedAtpItemIds: string[];
  linkedTpIds: string[];
  requiredJP?: number;
  slotJP?: number;
}
export interface MeetingAlignmentProposal {
  fingerprint: string;
  addSlots: boolean;
  rows: AlignmentRow[];
  operations: AlignmentOperation[];
  errors: string[];
  conflicts: string[];
  impacts: string[];
  totals: { semester: number; target: number; allocated: number }[];
}
export interface MeetingAlignmentApproval {
  draft: UnitExecutionPlanData;
  proposal: MeetingAlignmentProposal;
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
const knownFields = new Set(['id', 'unitId', 'order', 'title', 'materialIds', 'linkedAtpItemIds', 'linkedTpIds', 'alignmentMerge']);

/** Full ATP workload for each input is a conservative bound, never an inferred split. */
function requiredJP(meeting: LearningMeeting, atp?: ATPData): number | null {
  if (!atp || !meeting.linkedAtpItemIds.length) return null;
  let total = 0;
  for (const id of meeting.linkedAtpItemIds) {
    const item = atp.items.find(item => item.id === id);
    const jp = item?.allocatedJP !== undefined ? item.allocatedJP : item?.jp;
    if (typeof jp !== 'number' || !Number.isFinite(jp) || jp <= 0) return null;
    total += jp;
  }
  if (meeting.alignmentMerge) {
    const previous = meeting.alignmentMerge.requiredJP;
    if (!Number.isFinite(previous) || previous <= 0 || !meeting.alignmentMerge.sources?.length) return null;
    total = Math.max(total, previous);
  }
  return total;
}

function mergeIssue(a: LearningMeeting, b: LearningMeeting, context: MeetingAlignmentContext, minSlotJP: number): string | null {
  const protectedIds = [a.id, b.id].filter(id => context.protectedMeetings[id]?.length);
  if (protectedIds.length) return protectedIds.map(id => `${id}: ${context.protectedMeetings[id].join(', ')}`).join('; ');
  if ([a,b].some(m => Object.keys(m).some(key => !knownFields.has(key)))) return 'Data tambahan/legacy memerlukan peninjauan manual.';
  if (isEmptyAlignmentMeeting(a) || isEmptyAlignmentMeeting(b)) return 'Slot kosong tidak perlu digabung.';
  if ([a,b].some(m => !m.materialIds.length || !m.linkedAtpItemIds.length || !m.linkedTpIds.length)) return 'Lineage materi/ATP/TP belum lengkap.';
  if (!sameSet(a.linkedAtpItemIds,b.linkedAtpItemIds) || !sameSet(a.linkedTpIds,b.linkedTpIds)) return 'Lingkup/prasyarat ATP atau TP berbeda; susun ulang kegiatan secara manual.';
  if ([a,b].some(m => /\b(asesmen|assessment|ujian|sumatif|summative|evaluasi|penilaian|tes|pas|sas|pts|psts|sts|pat|sat)\b/i.test(m.title))) return 'Pertemuan asesmen memerlukan keputusan pedagogis khusus.';
  const first = requiredJP(a,context.atp), second = requiredJP(b,context.atp);
  if (first === null || second === null) return 'Beban JP ATP belum diketahui; lengkapi alokasi JP sumber dan tinjau kegiatan.';
  if (!Number.isFinite(minSlotJP) || minSlotJP <= 0) return 'Slot JP aktual belum valid; konfirmasi kalender dan pola pertemuan.';
  if (first + second > minSlotJP) return `Beban konservatif ${first+second} JP tidak muat dalam slot aktual minimum ${minSlotJP} JP. Ringkas kegiatan secara manual tanpa menghapus konten.`;
  return null;
}
function mergedMeeting(a: LearningMeeting, b: LearningMeeting, context: MeetingAlignmentContext): LearningMeeting {
  return { ...mergeReconciliationContent(a,b), title: `${a.title} / ${b.title}`,
    alignmentMerge: { sources: [structuredClone(a),structuredClone(b)], requiredJP: requiredJP(a,context.atp)! + requiredJP(b,context.atp)! },
  };
}

export function proposeMeetingAlignment(plan: UnitExecutionPlanData, mapping: ATPUnitMappingData, capacity: AlignmentCapacity, context: MeetingAlignmentContext, addSlots = false): MeetingAlignmentProposal {
  const result: MeetingAlignmentProposal = { fingerprint: JSON.stringify([plan,mapping,capacity,context,addSlots]), addSlots, rows: [], operations: [], errors: [...context.errors], conflicts: [], impacts: [], totals: [] };
  const placement = resolveUnitSemesterPlacement(plan,mapping);
  if (!plan.semesterPlacement || !placement.isValid || placement.isStale) result.errors.push('Tetapkan pembagian semester yang valid dan mutakhir; unit tidak dipindahkan otomatis.');
  const validation = validateUnitExecutionPlan(plan,mapping,context.atp,context.tp);
  if (!validation.isValid || validation.isStale) result.errors.push(...validation.errors, ...(validation.isStale ? ['Struktur/pemetaan stale. Tinjau data terbaru.'] : []));
  if (plan.units.length !== mapping.units.length || mapping.units.some(u => !plan.units.some(p => p.unitId === u.id))) result.errors.push('Struktur unit tidak sesuai pemetaan.');
  for (const [id, original] of Object.entries(context.protectedContent)) {
    const matches = plan.units.flatMap(u => u.meetings).filter(m => m.id === id);
    if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(original)) result.errors.push(`Pertemuan terlindungi ${id} berubah/hilang di draf. Pulihkan konten asli dan tinjau jurnal/absensi/rujukannya secara manual.`);
  }
  for (const semester of [1,2] as const) {
    const cap = semester === 1 ? capacity.semester1 : capacity.semester2;
    const unitIds = new Set(semester === 1 ? placement.semester1UnitIds : placement.semester2UnitIds);
    const units = [...mapping.units].sort((a,b) => a.order-b.order).filter(u => unitIds.has(u.id));
    const rows = units.map(u => ({ unitId:u.id, title:u.title, semester, before:plan.units.find(p => p.unitId===u.id)?.meetings.length || 0, proposed:0 }));
    const work = new Map(units.map(u => [u.id, [...(plan.units.find(p => p.unitId===u.id)?.meetings || [])].sort((a,b) => a.order-b.order)]));
    const total = rows.reduce((s,r) => s+r.before,0), target = cap.targetMeetingCount;
    result.totals.push({semester,target,allocated:total});
    if (!cap.isReady || !Number.isSafeInteger(target) || target < 0) result.errors.push(`Kapasitas kalender Semester ${semester} belum valid.`);
    else if (units.length > target) result.errors.push(`Semester ${semester}: minimum ${units.length} Bab melampaui kapasitas ${target}; tinjau perencanaan secara manual.`);
    else if (total > target && !result.errors.length) {
      let excess = total-target;
      // Empty slots always precede any content merge; stable proportional tie-break.
      while (excess > 0) {
        const candidates = rows.map((r,index) => ({r,index, meetings:work.get(r.unitId)!})).filter(({meetings}) => meetings.length>1 && meetings.some(m => isEmptyAlignmentMeeting(m) && !context.protectedMeetings[m.id]?.length));
        candidates.sort((a,b) => ((a.r.before-a.meetings.length)/a.r.before)-((b.r.before-b.meetings.length)/b.r.before) || a.index-b.index);
        if (!candidates.length) break;
        const {r,meetings} = candidates[0];
        const meeting = [...meetings].reverse().find(m => isEmptyAlignmentMeeting(m) && !context.protectedMeetings[m.id]?.length)!;
        work.set(r.unitId,meetings.filter(m => m.id!==meeting.id));
        result.operations.push({type:'REMOVE_EMPTY',unitId:r.unitId,meetingIds:[meeting.id],titles:[meeting.title],materialIds:[],linkedAtpItemIds:[],linkedTpIds:[]});
        excess--;
      }
      const slots = semester === 1 ? context.slotJP.semester1 : context.slotJP.semester2;
      const minSlot = cap.capacitySource === 'ACTUAL_SLOTS' && slots.length===target && slots.every(jp => Number.isFinite(jp) && jp>0) ? Math.min(...slots) : NaN;
      for (const unit of units) {
        const meetings = work.get(unit.id)!;
        for (let i=0; i<meetings.length-1 && excess>0;) {
          const a=meetings[i], b=meetings[i+1], issue=mergeIssue(a,b,context,minSlot);
          if (issue) { result.conflicts.push(`${unit.title}: ${a.id} + ${b.id}: ${issue}`); i++; continue; }
          const merged = mergedMeeting(a,b,context);
          result.operations.push({type:'MERGE',unitId:unit.id,meetingIds:[a.id,b.id],survivorId:a.id,titles:[a.title,b.title],materialIds:merged.materialIds,linkedAtpItemIds:merged.linkedAtpItemIds,linkedTpIds:merged.linkedTpIds,requiredJP:merged.alignmentMerge!.requiredJP,slotJP:minSlot});
          meetings.splice(i,2,merged); excess--;
        }
      }
      if (excess) {
        const protectedNotes = rows.flatMap(r => work.get(r.unitId)!.filter(m => context.protectedMeetings[m.id]?.length).map(m => `${m.id}: ${context.protectedMeetings[m.id].join(', ')}`));
        result.errors.push(`Semester ${semester}: masih kelebihan ${excess} pertemuan. Tidak ada solusi aman untuk seluruh usulan. Tinjau kegiatan/JP dan rujukan data turunan secara manual; jurnal/absensi/realisasi tidak boleh dihapus. ${protectedNotes.join('; ')}`);
      }
    } else if (total < target && addSlots && !result.errors.length && rows.length) {
      const counts = rows.map(r => Math.max(1,r.before));
      let remaining = target-counts.reduce((s,n) => s+n,0);
      if (remaining < 0) result.errors.push(`Semester ${semester}: slot tambahan tidak cukup untuk minimum setiap Bab.`);
      else {
        const weight = rows.reduce((s,r) => s+Math.max(1,r.before),0);
        const quotas = rows.map((r,i) => {const exact=remaining*Math.max(1,r.before)/weight; const n=Math.floor(exact);counts[i]+=n;return {i,remainder:exact-n};});
        remaining=target-counts.reduce((s,n) => s+n,0);
        quotas.sort((a,b) => b.remainder-a.remainder || a.i-b.i);
        for(let i=0;i<remaining;i++) counts[quotas[i].i]++;
        rows.forEach((r,i) => {for(let n=r.before;n<counts[i];n++) result.operations.push({type:'ADD',unitId:r.unitId,meetingIds:[],titles:[],materialIds:[],linkedAtpItemIds:[],linkedTpIds:[]});});
      }
    }
    rows.forEach(r => {r.proposed=work.get(r.unitId)!.length+result.operations.filter(o => o.type==='ADD' && o.unitId===r.unitId).length;});
    result.rows.push(...rows);
  }
  result.impacts = result.operations.length ? context.impacts : [];
  return result;
}

export function applyMeetingAlignment(plan: UnitExecutionPlanData, mapping: ATPUnitMappingData, capacity: AlignmentCapacity, approved: MeetingAlignmentProposal, createId: () => string, context: MeetingAlignmentContext): UnitExecutionPlanData {
  const current = proposeMeetingAlignment(plan,mapping,capacity,context,approved.addSlots);
  if (JSON.stringify(current)!==JSON.stringify(approved)) throw new Error('Kapasitas, pemetaan, konten, atau dependensi berubah. Tinjau usulan terbaru.');
  if (current.errors.length) throw new Error(current.errors.join(' '));
  if (!current.operations.length) return structuredClone(plan);
  const next=structuredClone(plan), used=new Set(plan.units.flatMap(u => u.meetings.map(m => m.id)));
  for(const operation of current.operations) {
    const unit=next.units.find(u => u.unitId===operation.unitId)!;
    if(operation.type==='REMOVE_EMPTY') unit.meetings=unit.meetings.filter(m => m.id!==operation.meetingIds[0]);
    else if(operation.type==='MERGE') {
      const a=unit.meetings.find(m => m.id===operation.meetingIds[0])!, b=unit.meetings.find(m => m.id===operation.meetingIds[1])!;
      const merged=mergedMeeting(a,b,context);
      unit.meetings=unit.meetings.filter(m => m.id!==b.id).map(m => m.id===a.id ? merged : m);
    } else {
      const id=createId();if(!id || used.has(id)) throw new Error('ID pertemuan baru terduplikasi.');used.add(id);
      unit.meetings.push({id,unitId:unit.unitId,order:Math.max(0,...unit.meetings.map(m => m.order))+1,title:'',materialIds:[],linkedAtpItemIds:[],linkedTpIds:[]});
    }
  }
  const validation=validateUnitExecutionPlan(next,mapping,context.atp,context.tp);
  const before=validateUnitExecutionPlan(plan,mapping,context.atp,context.tp);
  if(!validation.isValid || validation.isStale || validation.coverage.some(c => {
    const old=before.coverage.find(o => o.unitId===c.unitId)!;
    return c.missingMaterialIds.some(id => !old.missingMaterialIds.includes(id)) || c.missingAtpItemIds.some(id => !old.missingAtpItemIds.includes(id)) || c.missingTpIds.some(id => !old.missingTpIds.includes(id));
  })) throw new Error('Lineage/coverage hasil penyesuaian tidak valid atau berkurang.');
  if(current.totals.some(t => current.rows.filter(r => r.semester===t.semester).reduce((s,r) => s+r.proposed,0)>t.target)) throw new Error('Alokasi hasil masih melebihi kapasitas.');
  next.updatedAt=new Date(Math.max(Date.now(),(Date.parse(plan.updatedAt)||0)+1)).toISOString();
  return next;
}

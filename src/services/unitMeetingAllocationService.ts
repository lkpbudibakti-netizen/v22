import { ATPUnitMappingData, UnitExecutionPlanData } from '../types';

export interface UnitMeetingTarget {
  unitId: string;
  semester: 1 | 2;

  existingCount: number;
  newTargetCount: number;
  finalTargetCount: number;

  missingMaterialCount: number;
  missingAtpCount: number;
  missingTpCount: number;
}

export interface UnitMeetingAllocationResult {
  isValid: boolean;
  errors: string[];

  semester1: {
    target: number;
    existing: number;
    newTarget: number;
  };

  semester2: {
    target: number;
    existing: number;
    newTarget: number;
  };

  units: UnitMeetingTarget[];
}

export interface AllocateUnitMeetingsParams {
  refillMeetingIds?: readonly string[];
  exactSlots?: boolean;
  mapping: ATPUnitMappingData;
  currentPlan?: UnitExecutionPlanData | null;
  semester1UnitIds: string[];
  semester2UnitIds: string[];
  targetS1: number;
  targetS2: number;
}

/**
 * Deterministically allocates exact new meeting slots per Unit based on semester capacity targets
 * and missing curriculum coverage using largest remainder proportional distribution.
 */
export function allocateUnitMeetings(params: AllocateUnitMeetingsParams): UnitMeetingAllocationResult {
  const {
    mapping,
    currentPlan,
    semester1UnitIds,
    semester2UnitIds,
    targetS1,
    targetS2,
  } = params;

  const errors: string[] = [];

  const sortedMappingUnits = [...(mapping.units || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const s1UnitIdSet = new Set(semester1UnitIds);
  const s2UnitIdSet = new Set(semester2UnitIds);

  // Group units by semester in mapping order
  const s1Units = sortedMappingUnits.filter((u) => s1UnitIdSet.has(u.id));
  const s2Units = sortedMappingUnits.filter((u) => s2UnitIdSet.has(u.id));

  const planUnitsMap = new Map((currentPlan?.units || []).map((u) => [u.unitId, u]));

  function processSemester(
    units: typeof sortedMappingUnits,
    semester: 1 | 2,
    targetCount: number
  ): {
    existingCount: number;
    newTargetTotal: number;
    targets: UnitMeetingTarget[];
  } {
    let existingTotal = 0;

    interface UnitCoverageStats {
      unit: (typeof sortedMappingUnits)[0];
      mappingIndex: number;
      existingCount: number;
      missingMaterialCount: number;
      missingAtpCount: number;
      missingTpCount: number;
      hasMissingCoverage: boolean;
      weight: number;
    }

    const unitStats: UnitCoverageStats[] = units.map((unit) => {
      const mappingIndex = sortedMappingUnits.findIndex((u) => u.id === unit.id);
      const unitPlan = planUnitsMap.get(unit.id);
      const existingMeetings = unitPlan?.meetings || [];
      const existingCount = existingMeetings.length;
      existingTotal += existingCount;

      const coveredMaterials = new Set(existingMeetings.flatMap((m) => m.materialIds || []));
      const coveredAtp = new Set(existingMeetings.flatMap((m) => m.linkedAtpItemIds || []));
      const coveredTp = new Set(existingMeetings.flatMap((m) => m.linkedTpIds || []));

      const missingMaterials = (unit.materials || []).filter((m) => !coveredMaterials.has(m.id));
      const missingAtp = (unit.linkedAtpItemIds || []).filter((id) => !coveredAtp.has(id));
      const missingTp = (unit.linkedTpIds || []).filter((id) => !coveredTp.has(id));

      const missingMaterialCount = missingMaterials.length;
      const missingAtpCount = missingAtp.length;
      const missingTpCount = missingTp.length;

      const hasMissingCoverage =
        (missingMaterialCount > 0 || missingAtpCount > 0 || missingTpCount > 0) &&
        !existingMeetings.some(m=>params.refillMeetingIds?.includes(m.id));

      // Preserve the current unit allocation proportions; coverage still sets mandatory slots.
      const weight = params.exactSlots ? Math.max(1, unit.materials?.length || 0, unit.linkedAtpItemIds?.length || 0, unit.linkedTpIds?.length || 0) : Math.max(1, existingCount);

      return {
        unit,
        mappingIndex,
        existingCount,
        missingMaterialCount,
        missingAtpCount,
        missingTpCount,
        hasMissingCoverage,
        weight,
      };
    });

    if (!Number.isSafeInteger(targetCount) || targetCount < 0) {
      errors.push(`Kapasitas Semester ${semester} harus bilangan bulat valid >= 0.`);
      return { existingCount: existingTotal, newTargetTotal: 0, targets: [] };
    }
    const remainingSlots = targetCount - existingTotal;

    if (remainingSlots < 0) {
      errors.push(
        `Jumlah Pertemuan manual (${existingTotal}) melebihi kapasitas perencanaan Semester ${semester} (${targetCount}).`
      );
      return {
        existingCount: existingTotal,
        newTargetTotal: 0,
        targets: unitStats.map((st) => ({
          unitId: st.unit.id,
          semester,
          existingCount: st.existingCount,
          newTargetCount: 0,
          finalTargetCount: st.existingCount,
          missingMaterialCount: st.missingMaterialCount,
          missingAtpCount: st.missingAtpCount,
          missingTpCount: st.missingTpCount,
        })),
      };
    }

    // Capacity is a ceiling. Complete units do not request spare calendar slots.
    if (!params.exactSlots && unitStats.every(st => !st.hasMissingCoverage && st.existingCount > 0)) {
      return {
        existingCount: existingTotal,
        newTargetTotal: 0,
        targets: unitStats.map(st => ({
          unitId: st.unit.id, semester, existingCount: st.existingCount,
          newTargetCount: 0, finalTargetCount: st.existingCount,
          missingMaterialCount: 0, missingAtpCount: 0, missingTpCount: 0,
        })),
      };
    }

    // Units that still have missing coverage must get at least 1 mandatory slot
    const mandatoryCount = unitStats.filter((st) => st.hasMissingCoverage).length;

    if (remainingSlots < mandatoryCount) {
      errors.push(
        `Kapasitas Pertemuan tersisa Semester ${semester} (${remainingSlots}) tidak cukup untuk melengkapi coverage ${mandatoryCount} Unit yang membutuhkan minimal 1 pertemuan baru.`
      );
      return {
        existingCount: existingTotal,
        newTargetTotal: remainingSlots,
        targets: unitStats.map((st) => ({
          unitId: st.unit.id,
          semester,
          existingCount: st.existingCount,
          newTargetCount: 0,
          finalTargetCount: st.existingCount,
          missingMaterialCount: st.missingMaterialCount,
          missingAtpCount: st.missingAtpCount,
          missingTpCount: st.missingTpCount,
        })),
      };
    }

    if (unitStats.length === 0) {
      return {
        existingCount: existingTotal,
        newTargetTotal: 0,
        targets: [],
      };
    }

    // Base allocation: mandatory slot for units with missing coverage
    const assignedSlots: number[] = unitStats.map((st) => (st.hasMissingCoverage ? 1 : 0));
    const unallocated = remainingSlots - mandatoryCount;

    if (unallocated > 0) {
      const totalWeight = unitStats.reduce((sum, st) => sum + st.weight, 0);

      const remainders = unitStats.map((st, idx) => {
        const exactQuota = (st.weight / totalWeight) * unallocated;
        const integerPart = Math.floor(exactQuota);
        const remainder = exactQuota - integerPart;
        assignedSlots[idx] += integerPart;
        return {
          index: idx,
          remainder,
          mappingIndex: st.mappingIndex,
        };
      });

      const currentAllocated = assignedSlots.reduce((sum, s) => sum + s, 0);
      const leftover = remainingSlots - currentAllocated;

      if (leftover > 0) {
        // Largest remainder sorting with stable tie-break by mapping order ascending
        remainders.sort((a, b) => {
          if (Math.abs(b.remainder - a.remainder) > 1e-9) {
            return b.remainder - a.remainder;
          }
          return a.mappingIndex - b.mappingIndex;
        });

        for (let i = 0; i < leftover && i < remainders.length; i++) {
          assignedSlots[remainders[i].index] += 1;
        }
      }
    }

    const targets: UnitMeetingTarget[] = unitStats.map((st, idx) => {
      const newTargetCount = assignedSlots[idx];
      return {
        unitId: st.unit.id,
        semester,
        existingCount: st.existingCount,
        newTargetCount,
        finalTargetCount: st.existingCount + newTargetCount,
        missingMaterialCount: st.missingMaterialCount,
        missingAtpCount: st.missingAtpCount,
        missingTpCount: st.missingTpCount,
      };
    });

    return {
      existingCount: existingTotal,
      newTargetTotal: remainingSlots,
      targets,
    };
  }

  const s1Res = processSemester(s1Units, 1, targetS1);
  const s2Res = processSemester(s2Units, 2, targetS2);

  const allTargets = [...s1Res.targets, ...s2Res.targets];

  return {
    isValid: errors.length === 0,
    errors,
    semester1: {
      target: targetS1,
      existing: s1Res.existingCount,
      newTarget: s1Res.newTargetTotal,
    },
    semester2: {
      target: targetS2,
      existing: s2Res.existingCount,
      newTarget: s2Res.newTargetTotal,
    },
    units: allTargets,
  };
}
import { validateMeetingATPOrder, type AlignmentCapacity, type MeetingAlignmentContext } from './meetingAlignmentService';
import { resolveUnitSemesterPlacement } from './unitSemesterPlanningService';
import { validateUnitExecutionPlan } from './unitExecutionPlanService';
import { simulateMeetingSlotJP, isEmptyAlignmentMeeting } from './meetingContentService';
import type { LearningMeeting } from '../types';

export interface CalendarMeetingSlot { id: string; date: string; sessionId: string; sessionOrder?: number; jp: number }
export interface CalendarMeetingSlots { confirmed: true; semester1: CalendarMeetingSlot[]; semester2: CalendarMeetingSlot[] }
export interface CalendarGenerationReview { fingerprint: string; mode: 'COMPLETE' | 'REGENERATE'; candidate: UnitExecutionPlanData }
export function validateCalendarMeetingSlots(slots: CalendarMeetingSlots): string[] {
  const errors: string[] = [], ids=new Set<string>();
  if(!slots || slots.confirmed!==true || !Array.isArray(slots.semester1) || !Array.isArray(slots.semester2)) return ['Generate final memerlukan kalender terkonfirmasi dan slot aktual.'];
  for(const list of [slots.semester1,slots.semester2])list.forEach((s,i)=>{
    if(!s || typeof s.id!=='string' || !s.id || ids.has(s.id) || typeof s.sessionId!=='string' || !s.sessionId || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !Number.isFinite(Date.parse(s.date)) || new Date(s.date).toISOString().slice(0,10)!==s.date || !Number.isInteger(s.jp) || s.jp<=0 || !Number.isInteger(s.sessionOrder) || !(s.sessionOrder!>0)) errors.push('Identitas, urutan sesi, atau JP slot aktual tidak valid/ganda.');
    if(s)ids.add(s.id);
    const prev=list[i-1];if(prev && s && (prev.date>s.date || (prev.date===s.date && prev.sessionOrder!>=s.sessionOrder!)))errors.push('Slot aktual harus berurutan menurut tanggal dan urutan sesi.');
  });
  return errors;
}
export function calendarGenerationFingerprint(plan:UnitExecutionPlanData,mapping:ATPUnitMappingData,capacity:AlignmentCapacity,context:MeetingAlignmentContext) {
  return JSON.stringify([plan,mapping,capacity,context.sourceFingerprint,context.slotDetails]);
}
export function prepareCalendarMeetingGeneration(plan:UnitExecutionPlanData,mapping:ATPUnitMappingData,capacity:AlignmentCapacity,context:MeetingAlignmentContext,mode:'COMPLETE'|'REGENERATE') {
  const placement=resolveUnitSemesterPlacement(plan,mapping);
  const slots:CalendarMeetingSlots={confirmed:true,semester1:context.slotDetails?.semester1 || [],semester2:context.slotDetails?.semester2 || []};
  const errors=[...context.errors,...(context.calendarErrors || []),...validateCalendarMeetingSlots(slots)];
  if(!plan.semesterPlacement || !placement.isValid || !placement.isComplete || placement.isStale)errors.push('Tetapkan pembagian Bab Semester 1/2 yang valid pada Langkah 3.');
  for(const [i,key] of (['semester1','semester2'] as const).entries())if(!capacity[key].isReady || capacity[key].capacitySource!=='ACTUAL_SLOTS' || capacity[key].targetMeetingCount!==slots[key].length || capacity[key].totalJP!==slots[key].reduce((s,slot)=>s+slot.jp,0))errors.push(`Kalender Semester ${i+1}: generate final memerlukan slot aktual terkonfirmasi; kapasitas estimasi (${capacity[key].targetMeetingCount}) bukan slot tanggal aktual (${slots[key].length}). Buka Step 08 → Alokasi Waktu Semester ${i+1}, lengkapi Alokasi Hari Mengajar Sesi → Simpan Hari Mengajar dan konfirmasi Kalender Pendidikan.`);
  if(mode==='REGENERATE' && Object.keys(context.protectedMeetings).length)errors.push('Regenerate ditolak: pertemuan memiliki jurnal/absensi/realisasi/rencana pembelajaran atau referensi terlindungi: '+Object.keys(context.protectedMeetings).join(', '));
  if(mode==='COMPLETE')for(const unit of plan.units)for(const m of unit.meetings)if(context.protectedMeetings[m.id]?.length && isEmptyAlignmentMeeting({...m,title:''}))errors.push(`Bab ${mapping.units.find(u=>u.id===unit.unitId)?.title || unit.unitId}, pertemuan ${m.order} (${m.id}): materi/TP/ATP kosong tetapi terlindungi (${context.protectedMeetings[m.id].join(', ')}); lengkapi melalui peninjauan manual.`);
  // A missing calendar is not a coverage failure in the intentionally empty regenerate basis.
  if(errors.length)throw new Error([...new Set(errors)].join(' '));
  const basis=structuredClone(plan);
  if(mode==='REGENERATE')basis.units.forEach(u=>u.meetings=[]);
  // Only content-free, unprotected placeholders can be filled. Unknown/manual
  // fields and partially populated lineage remain intact and must validate.
  const refillMeetings=mode==='COMPLETE'?basis.units.flatMap(u=>u.meetings).filter(m=>!context.protectedMeetings[m.id]?.length && isEmptyAlignmentMeeting({...m,title:''})):[];
  const allocation=allocateUnitMeetings({mapping,currentPlan:basis,semester1UnitIds:placement.semester1UnitIds,semester2UnitIds:placement.semester2UnitIds,targetS1:slots.semester1.length,targetS2:slots.semester2.length,exactSlots:true,refillMeetingIds:refillMeetings.map(m=>m.id)});
  errors.push(...allocation.errors);
  if(errors.length)throw new Error([...new Set(errors)].join(' '));
  for(const target of allocation.units){
    const ids=new Set(refillMeetings.filter(m=>m.unitId===target.unitId).map(m=>m.id));
    basis.units.find(u=>u.unitId===target.unitId)!.meetings=basis.units.find(u=>u.unitId===target.unitId)!.meetings.filter(m=>!ids.has(m.id));
    target.existingCount-=ids.size;target.newTargetCount+=ids.size;
    const semester=target.semester===1?allocation.semester1:allocation.semester2;semester.existing-=ids.size;semester.newTarget+=ids.size;
  }
  return {basis,slots,allocation,refillMeetings,fingerprint:calendarGenerationFingerprint(plan,mapping,capacity,context)};
}
export function validateCalendarMeetingCandidate(candidate:UnitExecutionPlanData,original:UnitExecutionPlanData,mapping:ATPUnitMappingData,capacity:AlignmentCapacity,context:MeetingAlignmentContext):string[] {
  const placement=resolveUnitSemesterPlacement(candidate,mapping), errors:string[]=[];
  const valid=validateUnitExecutionPlan(candidate,mapping,context.atp,context.tp);
  for(const unit of candidate.units){const issue=validateMeetingATPOrder(unit.meetings,context.atp);if(issue)errors.push(issue);if([...unit.meetings].sort((a,b)=>a.order-b.order).some((m,i)=>m.order!==i+1))errors.push('Urutan pertemuan harus 1..n sesuai slot pada setiap Bab.');}
  if(!valid.isValid || !valid.isComplete || valid.isStale)errors.push('Cakupan materi/TP/ATP hasil belum lengkap atau lineage tidak valid.',...valid.errors);
  for(const coverage of valid.coverage){
    const unit=mapping.units.find(u=>u.id===coverage.unitId),label=`Bab ${unit?.title || coverage.unitId} (${coverage.unitId})`;
    for(const [kind,ids] of [['materi',coverage.missingMaterialIds],['TP',coverage.missingTpIds],['ATP',coverage.missingAtpItemIds]] as const)if(ids.length)errors.push(`${label}: cakupan ${kind} hilang: ${ids.join(', ')}.`);
  }
  for(const unit of candidate.units)for(const m of unit.meetings){
    const issues=valid.errors.filter(error=>error.includes(`'${m.id}'`) || error.includes(`'${m.title || m.id}'`));
    if(issues.length)errors.push(`Bab ${mapping.units.find(u=>u.id===unit.unitId)?.title || unit.unitId}, pertemuan ${m.order} (${m.id}): ${issues.join(' ')}`);
    if(!m.materialIds.length || !m.linkedTpIds.length || !m.linkedAtpItemIds.length)errors.push(`Bab ${mapping.units.find(u=>u.id===unit.unitId)?.title || unit.unitId}, pertemuan ${m.order} (${m.id}): materi/TP/ATP kosong; lengkapi manual bila terlindungi.`);
  }
  if(JSON.stringify(candidate.semesterPlacement)!==JSON.stringify(original.semesterPlacement) || candidate.id!==original.id || candidate.mappingId!==original.mappingId || candidate.academicSettingId!==original.academicSettingId || candidate.basedOnMappingUpdatedAt!==original.basedOnMappingUpdatedAt || candidate.units.length!==original.units.length || candidate.units.some((u,i)=>u.unitId!==original.units[i].unitId))errors.push('Identitas, urutan Bab, atau batas semester berubah.');
  for(const semester of [1,2] as const) {
    const key=semester===1?'semester1':'semester2', unitIds=new Set(semester===1?placement.semester1UnitIds:placement.semester2UnitIds);
    const meetings=[...mapping.units].sort((a,b)=>a.order-b.order).filter(u=>unitIds.has(u.id)).flatMap(u=>[...(candidate.units.find(p=>p.unitId===u.id)?.meetings || [])].sort((a,b)=>a.order-b.order));
    const slots=context.slotDetails?.[key] || [];
    if(!capacity[key].isReady || capacity[key].capacitySource!=='ACTUAL_SLOTS' || slots.length!==capacity[key].targetMeetingCount || meetings.length!==slots.length)errors.push('Semester '+semester+': jumlah pertemuan harus persis sama dengan jumlah slot aktual.');
    errors.push(...simulateMeetingSlotJP(meetings,slots).errors);
    if(meetings.some((m,i)=>m.plannedJP!==slots[i]?.jp))errors.push('Semester '+semester+': plannedJP harus persis mengikuti JP setiap slot aktual.');
    if(meetings.reduce((s,m)=>s+(m.plannedJP || 0),0)!==slots.reduce((s,slot)=>s+slot.jp,0) || slots.reduce((s,slot)=>s+slot.jp,0)!==capacity[key].totalJP)errors.push('Semester '+semester+': total JP pertemuan tidak sesuai kalender.');
    for(const [i,m] of meetings.entries()) {
      if(context.protectedContent[m.id] && JSON.stringify(context.protectedContent[m.id])!==JSON.stringify(m))errors.push('Pertemuan terlindungi '+m.id+' tidak boleh diubah.');
      const anchor=context.protectedSlots?.[m.id];if(anchor && (slots[i]?.date!==anchor.date || slots[i]?.sessionId!==anchor.sessionId || slots[i]?.jp!==anchor.jp))errors.push('Slot pertemuan terlindungi '+m.id+' akan bergeser.');
    }
  }
  for(const id of Object.keys(context.protectedContent))if(!candidate.units.some(u=>u.meetings.some(m=>m.id===id)))errors.push('Pertemuan terlindungi '+id+' hilang.');
  return [...new Set(errors)];
}
/** AI supplies content only. Calendar JP is bound deterministically after its response. */
export function buildCalendarMeetingCandidate(original:UnitExecutionPlanData,mapping:ATPUnitMappingData,capacity:AlignmentCapacity,context:MeetingAlignmentContext,mode:'COMPLETE'|'REGENERATE',suggestions:{units:{unitId:string;meetings:Pick<LearningMeeting,'title'|'materialIds'|'linkedAtpItemIds'|'linkedTpIds'>[]}[]},createId:()=>string):CalendarGenerationReview {
  const request=prepareCalendarMeetingGeneration(original,mapping,capacity,context,mode), candidate=structuredClone(request.basis),seen=new Set<string>(),used=new Set(original.units.flatMap(u=>u.meetings.map(m=>m.id)));
  if(!suggestions || !Array.isArray(suggestions.units))throw new Error('Format hasil AI tidak valid.');
  for(const suggested of suggestions.units) {
    const unit=candidate.units.find(u=>u.unitId===suggested.unitId), target=request.allocation.units.find(u=>u.unitId===suggested.unitId);
    if(!unit || !target || seen.has(suggested.unitId) || !Array.isArray(suggested.meetings) || suggested.meetings.length!==target.newTargetCount)throw new Error('Jumlah/ID Bab hasil AI tidak sesuai target slot.');
    seen.add(suggested.unitId);
    const refills=request.refillMeetings.filter(m=>m.unitId===unit.unitId).sort((a,b)=>a.order-b.order);
    for(const [i,m] of suggested.meetings.entries()) {
      const refill=refills[i],id=refill?.id || createId();if(!id || (!refill && used.has(id)))throw new Error('ID pertemuan baru duplikat.');used.add(id);
      unit.meetings.push({...refill,id,unitId:unit.unitId,order:refill?.order ?? Math.max(0,...unit.meetings.map(m=>m.order))+1,title:refill?.title?.trim() || (typeof m.title==='string'?m.title.trim():''),materialIds:m.materialIds,linkedAtpItemIds:m.linkedAtpItemIds,linkedTpIds:m.linkedTpIds});
    }
  }
  for(const target of request.allocation.units)if(candidate.units.find(u=>u.unitId===target.unitId)!.meetings.length!==target.finalTargetCount)throw new Error('Hasil AI tidak mengisi seluruh slot Bab '+target.unitId+'.');
  const placement=resolveUnitSemesterPlacement(candidate,mapping);
  for(const semester of [1,2] as const) {
    const unitIds=new Set(semester===1?placement.semester1UnitIds:placement.semester2UnitIds),slots=semester===1?request.slots.semester1:request.slots.semester2;let i=0;
    for(const u of [...mapping.units].sort((a,b)=>a.order-b.order).filter(u=>unitIds.has(u.id)))for(const m of [...candidate.units.find(p=>p.unitId===u.id)!.meetings].sort((a,b)=>a.order-b.order)) {
      const slot=slots[i++];
      if(mode==='COMPLETE' && original.units.some(unit=>unit.meetings.some(old=>old.id===m.id)) && ((m.plannedJP!==undefined && m.plannedJP>(slot?.jp || 0)) || (m.activities?.length && (!context.minutesPerJP || m.activities.some(a=>!Number.isFinite(a.durationMinutes) || !(a.durationMinutes!>0)) || m.activities.reduce((sum,a)=>sum+a.durationMinutes!,0)>(slot?.jp || 0)*context.minutesPerJP))))throw new Error('Kegiatan/JP lama '+m.id+' tidak dapat dipadatkan otomatis ke slot. Gunakan Regenerate atau tinjau kebutuhan JP secara manual.');
      m.plannedJP=slot?.jp;
    }
  }
  for(const unit of candidate.units){unit.meetings.sort((a,b)=>a.order-b.order);unit.meetings.forEach((m,i)=>m.order=i+1);}
  if(mode==='REGENERATE')for(const unit of candidate.units) {
    const previous=original.units.find(u=>u.unitId===unit.unitId)!.meetings;
    if(previous.length && unit.meetings.length)unit.meetings[0].alignmentMerge={sources:structuredClone(previous),requiredJP:unit.meetings[0].plannedJP!,strategy:'REGENERATE'};
  }
  candidate.updatedAt=new Date(Math.max(Date.now(),(Date.parse(original.updatedAt)||0)+1)).toISOString();
  const errors=validateCalendarMeetingCandidate(candidate,original,mapping,capacity,context);if(errors.length)throw new Error(errors.join(' '));
  return {fingerprint:request.fingerprint,mode,candidate};
}

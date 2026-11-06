import { mergeReconciliationContent } from './meetingReconciliationService';
import { isEmptyAlignmentMeeting, meetingSlotIssue, simulateMeetingSlotJP } from './meetingContentService';
export { isEmptyAlignmentMeeting } from './meetingContentService';
import type { ATPData, ATPUnitMappingData, LearningActivity, LearningMeeting, TPData, UnitExecutionPlanData, UnitExecutionPlan } from '../types';
import { resolveUnitSemesterPlacement } from './unitSemesterPlanningService';
import { validateUnitExecutionPlan } from './unitExecutionPlanService';

export interface AlignmentCapacity {
  semester1: { isReady: boolean; targetMeetingCount: number; totalJP?: number; capacitySource?: string };
  semester2: { isReady: boolean; targetMeetingCount: number; totalJP?: number; capacitySource?: string };
}
export interface MeetingAlignmentContext {
  calendarErrors?: string[];
  atp?: ATPData;
  tp?: TPData;
  sourceFingerprint: string;
  protectedMeetings: Record<string, string[]>;
  protectedContent: Record<string, LearningMeeting>;
  slotJP: { semester1: number[]; semester2: number[] };
  slotDetails?: { semester1: { id: string; date: string; sessionId: string; sessionOrder?: number; jp: number }[]; semester2: { id: string; date: string; sessionId: string; sessionOrder?: number; jp: number }[] };
  protectedSlots?: Record<string, { date: string; sessionId: string; jp: number }>;
  minutesPerJP?: number;
  impacts: string[];
  errors: string[];
}
export interface AlignmentRow { unitId: string; title: string; semester: 1 | 2; before: number; proposed: number }
export type AlignmentStrategy = 'REMOVE_EMPTY' | 'REDUCE_REDUNDANT' | 'MERGE' | 'COMPACT' | 'REDISTRIBUTE' | 'ADD';
export interface AlignmentOperation {
  type: AlignmentStrategy;
  unitId: string;
  meetingIds: string[];
  survivorId?: string;
  titles: string[];
  materialIds: string[];
  linkedAtpItemIds: string[];
  linkedTpIds: string[];
  requiredJP?: number;
  slotJP?: number;
  reason: string;
  before: LearningMeeting[];
  after: LearningMeeting[];
}
export interface MeetingOptimizationDraft {
  sourceFingerprint: string;
  reason: string;
  edits: Array<Pick<LearningMeeting, 'id'> & Partial<Pick<LearningMeeting, 'title' | 'plannedJP' | 'activities' | 'materialIds' | 'linkedAtpItemIds' | 'linkedTpIds'>>>;
}
export interface MeetingAlignmentProposal {
  fingerprint: string;
  addSlots: boolean;
  optimizationDraft?: MeetingOptimizationDraft;
  proposedUnits: UnitExecutionPlan[];
  rows: AlignmentRow[];
  operations: AlignmentOperation[];
  errors: string[];
  conflicts: string[];
  impacts: string[];
  totals: { semester: number; target: number; allocated: number }[];
  simulation: (ReturnType<typeof simulateMeetingSlotJP>['rows'][number] & { semester: 1 | 2 })[];
  meetingStatus: 'WITHIN_CAPACITY' | 'OVER_CAPACITY';
  slotStatus: 'VALID' | 'UNKNOWN' | 'CONFLICT';
  curriculumJPStatus: 'SEPARATE_REVIEW';
}
export type MeetingAlignmentApproval = { draft: UnitExecutionPlanData; proposal: MeetingAlignmentProposal } | { draft: UnitExecutionPlanData; calendarGeneration: import('./unitMeetingAllocationService').CalendarGenerationReview };
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
const normalized = (text: string) => text.trim().replace(/\s+/g,' ').toLocaleLowerCase('id');
const assessment = /\b(asesmen|assessment|ujian|sumatif|summative|evaluasi|penilaian|tes|pas|sas|pts|psts|sts|pat|sat)\b/i;
const knownFields = new Set(['id','unitId','order','title','materialIds','linkedAtpItemIds','linkedTpIds','alignmentMerge','plannedJP','activities']);
const references = (meetings: LearningMeeting[], key: 'materialIds'|'linkedAtpItemIds'|'linkedTpIds') => [...new Set(meetings.flatMap(m => m[key]))];
const hasAssessment = (m: LearningMeeting) => assessment.test(m.title) || (m.activities || []).some(a => assessment.test(`${a.title || ''} ${a.description} ${a.activityType || ''}`));
const sameScope = (a: LearningMeeting,b: LearningMeeting) => (['materialIds','linkedAtpItemIds','linkedTpIds'] as const).every(key => sameSet(a[key],b[key]));

/** Meeting demand is explicit or derived from quantified activities. ATP JP is never a fallback. */
export function meetingPlannedJP(meeting: LearningMeeting, context: Pick<MeetingAlignmentContext,'minutesPerJP'>): number | null {
  if (meeting.plannedJP !== undefined) return Number.isFinite(meeting.plannedJP) && meeting.plannedJP>0 ? meeting.plannedJP : null;
  if (!context.minutesPerJP || !meeting.activities?.length || meeting.activities.some(a => !Number.isFinite(a.durationMinutes) || !(a.durationMinutes!>0))) return null;
  return meeting.activities.reduce((sum,a) => sum+a.durationMinutes!,0)/context.minutesPerJP;
}
function activityBudgetIssue(m: LearningMeeting, context: MeetingAlignmentContext): string | null {
  if (!m.activities?.length) return null;
  if (!context.minutesPerJP || m.activities.some(a => !Number.isFinite(a.durationMinutes) || !(a.durationMinutes!>0))) return `Durasi kegiatan ${m.id} belum diketahui; lengkapi menit kegiatan dan konteks JP.`;
  const demand=meetingPlannedJP(m,context);
  if (demand===null || Math.abs(m.activities.reduce((sum,a)=>sum+a.durationMinutes!,0)-demand*context.minutesPerJP)>1e-6) return `Kegiatan ${m.id} tidak cocok dengan kebutuhan JP pertemuan.`;
  return null;
}
export function validateMeetingATPOrder(meetings: LearningMeeting[], atp?: ATPData): string | null {
  if (!atp) return 'ATP canonical belum tersedia.';
  const introduced=new Set<string>(); let previous=-Infinity;
  for (const meeting of [...meetings].sort((a,b)=>a.order-b.order)) {
    const steps=meeting.linkedAtpItemIds.filter(id=>!introduced.has(id)).map(id=>atp.items.find(item=>item.id===id)).sort((a,b)=>(a?.stepNumber||0)-(b?.stepNumber||0));
    for(const step of steps) {
      if(!step || !Number.isFinite(step.stepNumber) || step.stepNumber<previous) return `Urutan/prasyarat ATP pada ${meeting.id} perlu ditinjau; langkah baru tidak boleh mendahului prasyaratnya.`;
      introduced.add(step.id);previous=step.stepNumber;
    }
  }
  return null;
}
function groupIssue(group: LearningMeeting[], context: MeetingAlignmentContext): string | null {
  for(const m of group) {
    if(context.protectedMeetings[m.id]?.length) return `${m.id}: ${context.protectedMeetings[m.id].join(', ')}`;
    if(Object.keys(m).some(key=>!knownFields.has(key))) return `${m.id}: konten legacy tambahan memerlukan tinjauan manual.`;
    if(hasAssessment(m)) return `${m.id}: asesmen penting tidak boleh dipadatkan otomatis.`;
    if(!m.materialIds.length || !m.linkedAtpItemIds.length || !m.linkedTpIds.length) return `${m.id}: lineage/kegiatan belum lengkap.`;
    if(meetingPlannedJP(m,context)===null) return `${m.id}: kebutuhan JP pertemuan belum diketahui; JP ATP bukan durasi pertemuan.`;
    const issue=activityBudgetIssue(m,context);if(issue)return issue;
  }
  if(group.some(m=>!sameScope(m,group[0])) && group.some(m=>!m.activities?.length)) return 'Lingkup berbeda memerlukan bukti kegiatan dan urutan substansi; jangan menggabungkan hanya berdasarkan ID.';
  return validateMeetingATPOrder(group,context.atp);
}
function mergeGroup(group: LearningMeeting[], context: MeetingAlignmentContext, redundant=false): LearningMeeting {
  const merged=group.slice(1).reduce((target,m)=>mergeReconciliationContent(target,m),structuredClone(group[0]));
  merged.title=redundant ? group[0].title : group.map(m=>m.title).join(' / ');
  merged.plannedJP=redundant ? meetingPlannedJP(group[0],context)! : group.reduce((sum,m)=>sum+meetingPlannedJP(m,context)!,0);
  if(group.some(m=>m.activities?.length)) merged.activities=(redundant ? group[0].activities! : group.flatMap(m=>m.activities || [])).map(a=>({...a,learningMeetingId:merged.id}));
  merged.alignmentMerge={sources:structuredClone(group),requiredJP:merged.plannedJP,strategy:redundant?'REDUCE_REDUNDANT':'MERGE'};
  return merged;
}
function redundantIssue(group: LearningMeeting[], context: MeetingAlignmentContext): string | null {
  const issue=groupIssue(group,context);if(issue)return issue;
  const [a,b]=group;
  if(!sameScope(a,b) || normalized(a.title)!==normalized(b.title) || !a.activities?.length || !b.activities?.length) return 'Redundansi memerlukan substansi dan kegiatan identik, bukan hanya TP/ATP sama.';
  if([...a.activities,...b.activities].some(x=>x.essential!==false || assessment.test(`${x.description} ${x.activityType || ''}`))) return 'Kegiatan esensial/belum ditinjau atau asesmen tidak boleh dianggap redundan.';
  const substance=(m:LearningMeeting)=>m.activities!.map(({id,learningMeetingId,...a})=>a);
  if(JSON.stringify(substance(a))!==JSON.stringify(substance(b)) || meetingPlannedJP(a,context)!==meetingPlannedJP(b,context)) return 'Substansi, urutan kegiatan atau kebutuhan JP berbeda.';
  return null;
}
function redistribute(group: LearningMeeting[], budgets: number[], context: MeetingAlignmentContext): LearningMeeting[] | null {
  if(groupIssue(group,context) || !context.minutesPerJP || group.some(m=>!sameScope(m,group[0]) || !m.activities?.length)) return null;
  const activities=group.flatMap(m=>m.activities!);let cursor=0;
  const outputs:LearningMeeting[]=[];
  for(let i=0;i<budgets.length;i++) {
    const assigned:LearningActivity[]=[];let used=0;
    while(cursor<activities.length && used+activities[cursor].durationMinutes!<=budgets[i]*context.minutesPerJP+1e-6) {
      // Leave a meaningful activity for each remaining output.
      if(activities.length-cursor<=budgets.length-i-1)break;
      assigned.push(activities[cursor]);used+=activities[cursor++].durationMinutes!;
    }
    if(!assigned.length)return null;
    const m={...structuredClone(group[i]),title:group.map(m=>m.title).join(' / ')+` (${i+1}/${budgets.length})`,plannedJP:used/context.minutesPerJP,
      activities:assigned.map(a=>({...a,learningMeetingId:group[i].id})),
      alignmentMerge:{sources:structuredClone(group),requiredJP:used/context.minutesPerJP,strategy:(budgets.length<group.length?'COMPACT':'REDISTRIBUTE') as 'COMPACT'|'REDISTRIBUTE'}};
    outputs.push(m);
  }
  return cursor===activities.length ? outputs : null;
}
function operation(type:AlignmentStrategy, before:LearningMeeting[], after:LearningMeeting[], reason:string, budget?:number):AlignmentOperation {
  return {type,unitId:before[0]?.unitId || after[0].unitId,meetingIds:before.map(m=>m.id),survivorId:after[0]?.id,titles:before.map(m=>m.title),materialIds:references(after,'materialIds'),linkedAtpItemIds:references(after,'linkedAtpItemIds'),linkedTpIds:references(after,'linkedTpIds'),requiredJP:after[0]?.plannedJP,slotJP:budget,reason,before:structuredClone(before),after:structuredClone(after)};
}
export function optimizationFingerprint(plan:UnitExecutionPlanData,mapping:ATPUnitMappingData,context:MeetingAlignmentContext) {
  return JSON.stringify([plan,mapping,context.atp,context.tp,context.slotJP]);
}
/** AI edits are drafts: IDs, total demand, activities, source coverage and protected data are checked locally again. */
export function validateMeetingOptimizationDraft(raw:unknown, plan:UnitExecutionPlanData, mapping:ATPUnitMappingData, context:MeetingAlignmentContext): {draft?:MeetingOptimizationDraft; plan?:UnitExecutionPlanData; errors:string[]} {
  const fail=(reason:string)=>({errors:[reason]});
  if(!raw || typeof raw!=='object')return fail('Draf AI tidak valid.');
  const draft=raw as MeetingOptimizationDraft;
  if(draft.sourceFingerprint!==optimizationFingerprint(plan,mapping,context) || typeof draft.reason!=='string' || !Array.isArray(draft.edits))return fail('Draf AI stale atau formatnya tidak valid.');
  const next=structuredClone(plan), seen=new Set<string>();
  const allowed=new Set(['id','title','plannedJP','activities','materialIds','linkedAtpItemIds','linkedTpIds']);
  for(const edit of draft.edits) {
    if(!edit || typeof edit.id!=='string' || seen.has(edit.id) || Object.keys(edit).some(key=>!allowed.has(key)))return fail('Draf AI mengandung ID ganda atau field yang tidak diizinkan.');
    seen.add(edit.id);
    const original=plan.units.flatMap(u=>u.meetings).find(m=>m.id===edit.id), target=next.units.flatMap(u=>u.meetings).find(m=>m.id===edit.id);
    if(!original || !target || context.protectedMeetings[edit.id]?.length)return fail(`AI mencoba mengubah pertemuan terlindungi/tidak dikenal ${edit.id}.`);
    if(edit.title!==undefined && (typeof edit.title!=='string' || !edit.title.trim()))return fail('Judul AI kosong.');
    if(['materialIds','linkedAtpItemIds','linkedTpIds'].some(key=>(edit as any)[key]!==undefined && (!Array.isArray((edit as any)[key]) || (edit as any)[key].some((id:unknown)=>typeof id!=='string'))))return fail('ID canonical AI tidak valid.');
    if(edit.activities!==undefined && (!Array.isArray(edit.activities) || edit.activities.some(a=>!a || typeof a.id!=='string' || typeof a.description!=='string')))return fail('Kegiatan AI tidak valid.');
    Object.assign(target,edit);
    if(!original.activities?.length && ((edit.title!==undefined && !edit.title.includes(original.title)) ||
        (['materialIds','linkedAtpItemIds','linkedTpIds'] as const).some(key=>!sameSet(original[key],target[key]))))return fail('Revisi substansi/redistribusi lineage memerlukan bukti kegiatan; tanpa kegiatan judul dan relasi sumber harus dipertahankan.');
  }
  const validation=validateUnitExecutionPlan(next,mapping,context.atp,context.tp);if(!validation.isValid || validation.isStale)return fail('Lineage draf AI ditolak: '+validation.errors.join(' '));
  for(const unit of plan.units) {
    const updated=next.units.find(u=>u.unitId===unit.unitId)!;
    if((['materialIds','linkedAtpItemIds','linkedTpIds'] as const).some(key=>!sameSet(references(unit.meetings,key),references(updated.meetings,key))))return fail('AI menghilangkan atau mengarang coverage canonical Bab.');
    const before=unit.meetings.map(m=>meetingPlannedJP(m,context)), after=updated.meetings.map(m=>meetingPlannedJP(m,context));
    if(unit.meetings.some(m=>seen.has(m.id)) && (before.some(n=>n===null) || after.some(n=>n===null) || Math.abs(before.reduce<number>((s,n)=>s+n!,0)-after.reduce<number>((s,n)=>s+n!,0))>1e-6))return fail('AI tidak boleh mengarang atau mengurangi kebutuhan JP; durasi sumber harus diketahui dan dipertahankan.');
    const originals=[...unit.meetings].sort((a,b)=>a.order-b.order).flatMap(m=>m.activities || []), activities=[...updated.meetings].sort((a,b)=>a.order-b.order).flatMap(m=>m.activities || []);
    if(originals.length!==activities.length || new Set(activities.map(a=>a.id)).size!==activities.length)return fail('AI menghapus/menduplikasi kegiatan sumber.');
    for(const a of originals) {
      const b=activities.find(b=>b.id===a.id);
      if(!b || !b.description.includes(a.description) || (a.title && !b.title?.includes(a.title)) ||
          Object.entries(a).some(([key,value])=>!['learningMeetingId','description','title'].includes(key) && JSON.stringify((b as any)[key])!==JSON.stringify(value)))return fail('AI mengubah substansi esensial, asesmen atau durasi kegiatan sumber.');
      const beforeOwner=unit.meetings.find(m=>m.activities?.some(x=>x.id===a.id))!;
      const afterOwner=updated.meetings.find(m=>m.activities?.some(x=>x.id===a.id))!;
      if((['materialIds','linkedAtpItemIds','linkedTpIds'] as const).some(key=>beforeOwner[key].some(id=>!afterOwner[key].includes(id))))return fail('Kegiatan yang dipindahkan wajib membawa seluruh lineage materi/TP/ATP sumbernya; tidak boleh mengalihkan substansi ke TP lain.');
    }
    const ids=activities.map(a=>a.id);if(originals.some((a,i)=>ids[i]!==a.id))return fail('AI membalik urutan kegiatan/prasyarat.');
    const issue=validateMeetingATPOrder(updated.meetings,context.atp);if(issue)return fail(issue);
    for(const m of updated.meetings) {const issue=activityBudgetIssue(m,context);if(issue)return fail(issue);}
  }
  return {draft:structuredClone(draft),plan:next,errors:[]};
}

export function proposeMeetingAlignment(plan:UnitExecutionPlanData,mapping:ATPUnitMappingData,capacity:AlignmentCapacity,context:MeetingAlignmentContext,addSlots=false,optimizationDraft?:MeetingOptimizationDraft):MeetingAlignmentProposal {
  const result:MeetingAlignmentProposal={fingerprint:JSON.stringify([plan,mapping,capacity,context,addSlots,optimizationDraft]),addSlots,...(optimizationDraft?{optimizationDraft}:{}),proposedUnits:structuredClone(plan.units),rows:[],operations:[],errors:[...context.errors],conflicts:[],impacts:[],totals:[],simulation:[],meetingStatus:'WITHIN_CAPACITY',slotStatus:'VALID',curriculumJPStatus:'SEPARATE_REVIEW'};
  const placement=resolveUnitSemesterPlacement(plan,mapping), validation=validateUnitExecutionPlan(plan,mapping,context.atp,context.tp);
  if(plan.units.length!==mapping.units.length || mapping.units.some(u=>!plan.units.some(p=>p.unitId===u.id)))result.errors.push('Struktur unit tidak sesuai pemetaan; pulihkan Bab yang hilang sebelum optimalisasi.');
  if(!plan.semesterPlacement || !placement.isValid || placement.isStale)result.errors.push('Pembagian semester belum valid/mutakhir; tidak ada unit yang dipindahkan.');
  if(!validation.isValid || validation.isStale)result.errors.push(...validation.errors,...(validation.isStale?['Struktur/pemetaan stale.']:[]));
  for(const [id,original] of Object.entries(context.protectedContent)) {
    const matches=plan.units.flatMap(u=>u.meetings).filter(m=>m.id===id);
    if(matches.length!==1 || JSON.stringify(matches[0])!==JSON.stringify(original))result.errors.push(`Pertemuan terlindungi ${id} berubah/hilang di draf.`);
  }
  let working=structuredClone(plan);
  if(optimizationDraft) {
    const checked=validateMeetingOptimizationDraft(optimizationDraft,plan,mapping,context);result.errors.push(...checked.errors);
    if(checked.plan) {
      working=checked.plan;
      for(const unit of working.units)for(const m of unit.meetings) {
        const original=plan.units.flatMap(u=>u.meetings).find(x=>x.id===m.id)!;
        if(JSON.stringify(m)!==JSON.stringify(original)) {
          m.alignmentMerge={sources:[structuredClone(original)],requiredJP:meetingPlannedJP(m,context)!,strategy:'REDISTRIBUTE'};
          result.operations.push(operation('REDISTRIBUTE',[original],[m],'Draf AI: '+optimizationDraft.reason));
        }
      }
    }
  }
  for(const unit of working.units)for(const m of unit.meetings) {
    const demand=meetingPlannedJP(m,context);
    if(m.plannedJP===undefined && demand!==null && !context.protectedMeetings[m.id]?.length) {
      const before=structuredClone(m);m.plannedJP=demand;
      result.operations.push(operation('REDISTRIBUTE',[before],[m],'Kebutuhan JP diturunkan dari durasi kegiatan yang tercatat dan menit/JP jenjang; bukan dari JP ATP.'));
    }
  }
  for(const semester of [1,2] as const) {
    const key=semester===1?'semester1':'semester2', cap=capacity[key], slots=context.slotJP[key], details=context.slotDetails?.[key];
    const ids=new Set(semester===1?placement.semester1UnitIds:placement.semester2UnitIds);
    const units=[...mapping.units].sort((a,b)=>a.order-b.order).filter(u=>ids.has(u.id));
    const input=units.flatMap(u=>[...(working.units.find(p=>p.unitId===u.id)?.meetings || [])].sort((a,b)=>a.order-b.order));
    const target=cap.targetMeetingCount;
    result.totals.push({semester,target,allocated:input.length});
    if(input.length>target)result.meetingStatus='OVER_CAPACITY';
    const startErrors=result.errors.length;
    if(!cap.isReady || !Number.isSafeInteger(target) || target<0)result.errors.push(`Kapasitas Semester ${semester} belum valid.`);
    if(units.length>target)result.errors.push(`Minimum ${units.length} Bab Semester ${semester} melampaui kapasitas ${target}.`);
    const beforeSimulation=simulateMeetingSlotJP(input,slots.map(jp=>({jp})));
    const needsOptimization=input.length>target || beforeSimulation.errors.some(e=>!e.includes('tidak memperoleh'));
    let output=input;
    if(needsOptimization && !result.errors.length) {
      if(cap.capacitySource!=='ACTUAL_SLOTS' || slots.length!==target || slots.some(jp=>!Number.isFinite(jp) || jp<=0))result.errors.push(`Semester ${semester}: slot JP aktual berurutan belum valid; tidak memakai estimasi/minimum semester.`);
      for(const m of input) {
        if(!isEmptyAlignmentMeeting(m) && meetingPlannedJP(m,context)===null)result.errors.push(`${m.id}: kebutuhan JP pertemuan belum diketahui. Isi kebutuhan JP/kegiatan; JP ATP tidak boleh digandakan.`);
        const issue=activityBudgetIssue(m,context);if(issue)result.errors.push(issue);
      }
      for(const unit of units) {const issue=validateMeetingATPOrder(input.filter(m=>m.unitId===unit.id),context.atp);if(issue)result.errors.push(issue);}
      const conflicts=new Set<string>(), memo=new Map<string,{cost:number;meetings:LearningMeeting[];operations:AlignmentOperation[]}|null>();
      type Choice={consume:number;out:LearningMeeting[];type?:AlignmentStrategy;cost:number;reason:string};
      const visit=(index:number,slot:number,hasOutput:boolean):{cost:number;meetings:LearningMeeting[];operations:AlignmentOperation[]}|null=>{
        if(index===input.length)return {cost:0,meetings:[],operations:[]};
        const cacheKey=`${index}:${slot}:${hasOutput}`;if(memo.has(cacheKey))return memo.get(cacheKey)!;
        const current=input[index], choices:Choice[]=[];
        const demand=meetingPlannedJP(current,context), known=current.plannedJP===undefined && demand!==null ? {...current,plannedJP:demand} : current;
        choices.push({consume:1,out:[known],cost:0,reason:'Pertahankan pertemuan.'});
        if(isEmptyAlignmentMeeting(current) && !context.protectedMeetings[current.id]?.length)choices.push({consume:1,out:[],type:'REMOVE_EMPTY',cost:1,reason:'Slot kosong tanpa konten/rujukan; seluruh Bab tetap dipertahankan.'});
        const pair=input.slice(index,index+2);
        if(pair.length===2 && pair[1].unitId===current.unitId) {
          const redundant=redundantIssue(pair,context);
          if(!redundant)choices.push({consume:2,out:[mergeGroup(pair,context,true)],type:'REDUCE_REDUNDANT',cost:2,reason:'Substansi dan urutan kegiatan identik; tidak ada kegiatan esensial/asesmen/coverage unik. Sumber tetap diarsipkan.'});
          const issue=groupIssue(pair,context);
          if(!issue) {
            choices.push({consume:2,out:[mergeGroup(pair,context)],type:'MERGE',cost:3,reason:'Seluruh substansi/kegiatan dan lineage digabung berurutan dalam Bab/semester sama.'});
            const redistributed=redistribute(pair,slots.slice(slot,slot+2),context);
            if(redistributed?.length===2 && pair.some((m,i)=>meetingPlannedJP(m,context)!>slots[slot+i]))choices.push({consume:2,out:redistributed,type:'REDISTRIBUTE',cost:4,reason:'Kegiatan utuh didistribusikan mengikuti urutan slot aktual tanpa mengurangi durasi.'});
          } else conflicts.add(`${current.unitId}: ${pair.map(m=>m.id).join(' + ')}: ${issue}`);
          for(let count=3;index+count<=input.length;count++) {
            const group=input.slice(index,index+count);
            if(group.some(m=>m.unitId!==current.unitId))break;
            if(groupIssue(group,context))break;
            const demand=group.reduce((sum,m)=>sum+meetingPlannedJP(m,context)!,0);
            if(demand>slots[slot])break;
            choices.push({consume:count,out:[mergeGroup(group,context)],type:'MERGE',cost:3*(count-1),reason:'Seluruh substansi/kegiatan beberapa pertemuan dipertahankan dalam satu slot aktual yang mencukupi.'});
          }
          const triple=input.slice(index,index+3);
          if(triple.length===3 && triple.every(m=>m.unitId===current.unitId)) {
            const compact=redistribute(triple,slots.slice(slot,slot+2),context);
            if(compact?.length===2)choices.push({consume:3,out:compact,type:'COMPACT',cost:5,reason:'Tiga pertemuan dipadatkan ke dua slot aktual; seluruh kegiatan/durasi tetap utuh dan berurutan.'});
          }
        }
        let best:ReturnType<typeof visit>=null;
        for(const choice of choices) {
          const nextIndex=index+choice.consume, endsUnit=nextIndex===input.length || input[nextIndex].unitId!==current.unitId;
          if(endsUnit && !(hasOutput || choice.out.length))continue;
          if(slot+choice.out.length>target)continue;
          if(choice.out.some((m,i)=>{
            const issue=meetingSlotIssue(m,slots[slot+i]);
            if(issue) {if(choice.type)conflicts.add(issue);return true;}
            const anchor=context.protectedSlots?.[m.id], actual=details?.[slot+i];
            const shifted=!!anchor && (!actual || anchor.date!==actual.date || anchor.sessionId!==actual.sessionId || anchor.jp!==actual.jp);
            if(shifted)conflicts.add(`${m.id}: tanggal/sesi/JP pertemuan terlindungi akan bergeser; tinjau manual.`);
            return shifted || (!!context.protectedMeetings[m.id]?.length && !anchor && slot+i!==input.findIndex(old=>old.id===m.id));
          }))continue;
          const tail=visit(nextIndex,slot+choice.out.length,endsUnit?false:hasOutput || choice.out.length>0);if(!tail)continue;
          const cost=choice.cost+tail.cost;
          if(!best || cost<best.cost)best={cost,meetings:[...choice.out,...tail.meetings],operations:[...(choice.type?[operation(choice.type,input.slice(index,nextIndex),choice.out,choice.reason,slots[slot])]:[]),...tail.operations]};
        }
        memo.set(cacheKey,best);return best;
      };
      if(!result.errors.length) {
        const solution=visit(0,0,false);
        if(solution) {output=solution.meetings;result.operations.push(...solution.operations);}
        else {
          result.errors.push(`Semester ${semester}: ${input.length} → ≤${target} tidak layak terhadap urutan slot ${slots.join('/')} JP, prasyarat atau data terlindungi. Tinjau kebutuhan JP/kegiatan dan rujukan; tidak ada perubahan parsial.`);
          result.conflicts.push(...beforeSimulation.errors);
        }
      }
      result.conflicts.push(...conflicts);
    }
    if(addSlots && output.length<target && !result.errors.length && units.length) {
      // Explicit teacher choice only. Keep all existing meetings/IDs.
      let remaining=target-output.length;
      const counts=units.map(u=>Math.max(1,output.filter(m=>m.unitId===u.id).length)), weights=units.map(u=>Math.max(1,input.filter(m=>m.unitId===u.id).length));
      const extra=target-counts.reduce((s,n)=>s+n,0), sum=weights.reduce((s,n)=>s+n,0);
      if(extra<0)result.errors.push('Slot tambahan tidak cukup untuk minimum Bab.');
      else {
        const quotas=weights.map((w,i)=>{const n=extra*w/sum;counts[i]+=Math.floor(n);return {i,fraction:n-Math.floor(n)};}).sort((a,b)=>b.fraction-a.fraction || a.i-b.i);
        const leftover=target-counts.reduce((s,n)=>s+n,0);for(let n=0;n<leftover;n++)counts[quotas[n].i]++;
        for(let i=0;i<units.length;i++)for(let n=output.filter(m=>m.unitId===units[i].id).length;n<counts[i];n++) {
          const unit=units[i];let id=`alignment-add:${unit.id}:${n}`;while(plan.units.some(u=>u.meetings.some(m=>m.id===id)))id+='-';
          const added:LearningMeeting={id,unitId:unit.id,order:Math.max(0,...output.filter(m=>m.unitId===unit.id).map(m=>m.order))+1,title:'',materialIds:[],linkedAtpItemIds:[],linkedTpIds:[]};
          output.push(added);result.operations.push(operation('ADD',[],[added],'Penambahan slot kosong dipilih guru.'));remaining--;
        }
        output.sort((a,b)=>units.findIndex(u=>u.id===a.unitId)-units.findIndex(u=>u.id===b.unitId) || a.order-b.order);
      }
    }
    for(const unit of units) {
      const meetings=output.filter(m=>m.unitId===unit.id), original=plan.units.find(u=>u.unitId===unit.id);
      const candidate=result.proposedUnits.find(u=>u.unitId===unit.id);if(candidate)candidate.meetings=structuredClone(meetings);
      result.rows.push({unitId:unit.id,title:unit.title,semester,before:original?.meetings.length || 0,proposed:meetings.length});
    }
    const simulated=simulateMeetingSlotJP(output,slots.map(jp=>({jp})));
    result.simulation.push(...simulated.rows.map(row=>({...row,semester})));
    if(simulated.errors.length)result.slotStatus='CONFLICT';else if(simulated.unknownIds.length && result.slotStatus==='VALID')result.slotStatus='UNKNOWN';
    if(result.operations.length && (slots.length!==target || cap.capacitySource!=='ACTUAL_SLOTS'))result.errors.push(`Semester ${semester}: persetujuan perubahan memerlukan slot aktual.`);
    if(result.operations.length)result.errors.push(...simulated.errors,...simulated.unknownIds.map(id=>`${id}: kebutuhan JP belum diketahui; tidak dapat menyetujui optimalisasi sebagai layak JP.`));
    if(result.operations.length)for(const row of simulated.rows) {
      if(!context.protectedMeetings[row.meetingId]?.length)continue;
      const anchor=context.protectedSlots?.[row.meetingId], actual=details?.[row.slotIndex];
      if(anchor ? !actual || anchor.date!==actual.date || anchor.sessionId!==actual.sessionId || anchor.jp!==actual.jp : row.slotIndex!==input.findIndex(m=>m.id===row.meetingId))result.errors.push(`${row.meetingId}: posisi/tanggal/sesi/JP pertemuan terlindungi akan berubah. Tinjau jadwal/realisasi manual; optimalisasi ditolak.`);
    }
    if(result.errors.length>startErrors)result.slotStatus='CONFLICT';
  }
  const candidate={...plan,units:result.proposedUnits};
  for(const [id, original] of Object.entries(context.protectedContent)) {
    if(JSON.stringify(candidate.units.flatMap(u=>u.meetings).find(m=>m.id===id))!==JSON.stringify(original))result.errors.push(`Hasil mengubah pertemuan terlindungi ${id}.`);
  }
  const after=validateUnitExecutionPlan(candidate,mapping,context.atp,context.tp);
  if(!after.isValid)result.errors.push(...after.errors);
  if(after.coverage.some(c=>{const before=validation.coverage.find(x=>x.unitId===c.unitId);return !before || c.missingMaterialIds.some(id=>!before.missingMaterialIds.includes(id)) || c.missingAtpItemIds.some(id=>!before.missingAtpItemIds.includes(id)) || c.missingTpIds.some(id=>!before.missingTpIds.includes(id));}))result.errors.push('Coverage TP/ATP/materi berkurang.');
  const priority:Record<AlignmentStrategy,number>={REMOVE_EMPTY:0,REDUCE_REDUNDANT:1,MERGE:2,COMPACT:3,REDISTRIBUTE:4,ADD:5};
  result.operations.sort((a,b)=>priority[a.type]-priority[b.type]);
  result.meetingStatus=result.totals.every(t=>result.rows.filter(r=>r.semester===t.semester).reduce((sum,r)=>sum+r.proposed,0)<=t.target)?'WITHIN_CAPACITY':'OVER_CAPACITY';
  result.errors=[...new Set(result.errors)];result.impacts=result.operations.length?context.impacts:[];
  return result;
}
export function applyMeetingAlignment(plan:UnitExecutionPlanData,mapping:ATPUnitMappingData,capacity:AlignmentCapacity,approved:MeetingAlignmentProposal,createId:()=>string,context:MeetingAlignmentContext):UnitExecutionPlanData {
  const current=proposeMeetingAlignment(plan,mapping,capacity,context,approved.addSlots,approved.optimizationDraft);
  if(JSON.stringify(current)!==JSON.stringify(approved))throw new Error('Kapasitas, pemetaan, konten, atau dependensi berubah. Tinjau usulan terbaru.');
  if(current.errors.length)throw new Error(current.errors.join(' '));
  if(!current.operations.length)return structuredClone(plan);
  const next={...structuredClone(plan),units:structuredClone(current.proposedUnits)},used=new Set(plan.units.flatMap(u=>u.meetings.map(m=>m.id)));
  const addedIds=new Set(current.operations.filter(o=>o.type==='ADD').flatMap(o=>o.after.map(m=>m.id)));
  for(const unit of next.units)for(const m of unit.meetings)if(addedIds.has(m.id)) {const id=createId();if(!id || used.has(id))throw new Error('ID pertemuan baru terduplikasi.');used.add(id);m.id=id;}
  next.updatedAt=new Date(Math.max(Date.now(),(Date.parse(plan.updatedAt)||0)+1)).toISOString();
  return next;
}

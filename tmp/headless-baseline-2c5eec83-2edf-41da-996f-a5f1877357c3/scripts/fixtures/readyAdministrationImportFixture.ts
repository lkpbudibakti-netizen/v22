import { createIdentityDuplicationFixture } from './identityDuplicationFixture';
import { createModulAjarRuntimeFixture } from './modulAjarRuntimeFixture';
export function createReadyAdministrationImportFixture() {
const source = createIdentityDuplicationFixture();
const stamp = '2026-01-01T00:00:00Z';
Object.assign(source.profiles[0], { name:'GURU_ASAL_TEST', nip:'111111111111111111' });
Object.assign(source.schools[0], { name:'SEKOLAH_ASAL_TEST', npsn:'11111111', address:'ALAMAT_ASAL_TEST', principalName:'KEPSEK_ASAL_TEST', principalNip:'222222222222222222' });
Object.assign(source.profiles[1], { name:'GURU_TUJUAN_TEST', nip:'333333333333333333' });
Object.assign(source.schools[1], { name:'SEKOLAH_TUJUAN_TEST', npsn:'33333333', address:'ALAMAT_TUJUAN_TEST', principalName:'KEPSEK_TUJUAN_TEST', principalNip:'444444444444444444' });
source.workspaces[0].documentDate = '2026-08-03';
source.semesterData.learningMeetingSchedules![0].value.entries[0].sourceSlotId = 'subject-slot:sp1:session:2026-08-03';
const runtime = createModulAjarRuntimeFixture();
const plan: any = structuredClone(runtime.learningPlans[0]);
Object.assign(plan, { id:'lp', academicSettingId:'sp1', unitId:'u', learningMeetingIds:['meet'], tpIds:['t','t-z'], atpItemIds:['a','az'],
  objectives: source.annualData.tp[0].value.items.map(item => ({ tpId:item.id, code:item.code, statement:item.statement })), allocatedJP:2,
  kktpCriterionIds:['k','k2'], timeAllocationIds:['allocation'], createdAt:stamp, updatedAt:stamp, confirmedAt:stamp,
  learningSteps: { opening:[{ id:'open', learningMeetingId:'meet', description:'Pembukaan', durationMinutes:10 }], core:[{ id:'core', learningMeetingId:'meet', description:'Praktik lempar bola', durationMinutes:50 }], closing:[{ id:'close', learningMeetingId:'meet', description:'Penutup', durationMinutes:10 }] } });
source.semesterData.learningPlan[0].value = [plan];
for (const rows of Object.values(plan.assessmentPlan) as any[][]) for (const item of rows) { item.linkedTpIds = ['t']; if (item.learningMeetingId) item.learningMeetingId = 'meet'; }
source.semesterData.assessmentCriteria[0].value = runtime.assessmentCriteria.slice(0,2).map((criterion: any,index: number) => ({ ...criterion, id:index ? 'k2':'k', academicSettingId:'sp1', tpId:index ? 't-z':'t', updatedAt:stamp }));
source.semesterData.assessmentPlan[0].value = [{ id:'ap', academicSettingId:'sp1', title:'Rencana Asesmen', purpose:'SUMMATIVE', timing:'POST', scopeType:'TP',
  tpIds:['t'], criterionIds:[], learningPlanIds:['lp'], instruments:[{ id:'instrument', type:'WRITTEN_TEST', label:'Tes tertulis' }], workflowStatus:'SIAP', needsReview:false, revision:1, createdAt:stamp, updatedAt:stamp } as any];
source.semesterData.assessmentPackage[0].value = [{ id:'pkg', academicSettingId:'sp1', assessmentPlanId:'ap', title:'Perangkat Asesmen', workflowStatus:'SIAP', needsReview:false, revision:1,
  blueprintItems:[{ id:'blueprint', objectiveRefId:'t', instrumentType:'WRITTEN_TEST', instrumentItemIds:['item'], order:1, assessmentIndicator:'Mengenali lempar bola' }],
  instruments:[{ id:'instrument', type:'WRITTEN_TEST', title:'Tes tertulis', items:[{ id:'item', itemType:'MULTIPLE_CHOICE', prompt:'Gerak untuk memindahkan bola dengan tangan?', options:[{id:'option-a',label:'A',text:'Melempar'},{id:'option-b',label:'B',text:'Berjalan'}], order:1 }] }],
  answerKeys:[{ id:'key', instrumentId:'instrument', instrumentItemId:'item', answerType:'OPTION', optionIds:['option-a'] }], scoringGuides:[], rubrics:[], createdAt:stamp, updatedAt:stamp,
  snapshot:{ teacherName:'GURU_ASAL_TEST', schoolName:'SEKOLAH_ASAL_TEST' } } as any];
source.documents = [{ id:'old-doc', type:'MODUL_AJAR', title:'Dokumen lama', status:'completed', academicSettingId:'sp1', workspaceId:'w', snapshot:{ teacherName:'GURU_ASAL_TEST',schoolName:'SEKOLAH_ASAL_TEST' } as any }];
source.semesterData.roster = [{ semesterPlanId:'sp1', value:[{id:'student',academicSettingId:'sp1',name:'MURID_ASAL'}] }];
source.semesterData.attendance = [{ semesterPlanId:'sp1', value:{ sessions:[{id:'att',academicSettingId:'sp1',date:'2026-08-03',meetingNumber:1,createdAt:stamp}],records:[{id:'record',sessionId:'att',studentId:'student',status:'H'}] } }];
source.semesterData.journalRealizations = [{ semesterPlanId:'sp1', value:[{ meetingId:'meet',semesterPlanId:'sp1',outcome:'HASIL_ASAL',updatedAt:stamp }] }];
return source;
}

export function createTwoSemesterAdministrationImportFixture() {
  const source = createReadyAdministrationImportFixture();
  const unit = source.annualData.atpUnitMappings![0].value.units[0];
  const execution = source.annualData.unitExecutionPlans![0].value.units[0];
  const scope: Record<string, any> = {};
  for (const [key, entries] of Object.entries(source.semesterData)) {
    const entry = entries.find(item=>item.semesterPlanId==='sp1');
    if (entry) scope[key] = entry.value;
  }
  const ids = new Map<string,string>([['sp1','sp2']]);
  const collect = (node:any) => { if (!node || typeof node!=='object') return; if (typeof node.id==='string') ids.set(node.id,node.id+'-s2'); for (const value of Object.values(node)) collect(value); };
  collect([scope,unit,execution]);
  const remap = (node:any,key=''):any => {
    if (typeof node==='string') {
      if ((key==='id' || /Ids?$/.test(key)) && ids.has(node)) return ids.get(node);
      if (['date','startDate','endDate'].includes(key) && node==='2026-08-03') return '2027-01-04';
      return node;
    }
    if (Array.isArray(node)) return node.map(value=>remap(value,key));
    return node && typeof node==='object' ? Object.fromEntries(Object.entries(node).map(([key,value])=>[key,remap(value,key)])) : node;
  };
  const unit2 = remap(unit); unit2.order=2; unit2.title='Bab Semester 2';
  source.annualData.atpUnitMappings![0].value.units.push(unit2);
  source.annualData.unitExecutionPlans![0].value.units.push(remap(execution));
  for (const [key,value] of Object.entries(scope)) (source.semesterData as any)[key].push({semesterPlanId:'sp2',value:remap(value)});
  const calendar = source.semesterData.academicCalendar.find(entry=>entry.semesterPlanId==='sp2')!.value.calendar; calendar.semester='2';
  const schedule = source.semesterData.learningMeetingSchedules!.find(entry=>entry.semesterPlanId==='sp2')!.value;
  for (const entry of schedule.entries) entry.sourceSlotId=`subject-slot:sp2:${entry.sessionId}:${entry.date}`;
  source.semesterJPSettings.push({semesterPlanId:'sp2',value:{...source.semesterJPSettings[0].value,semesterPlanId:'sp2'}});
  return source;
}

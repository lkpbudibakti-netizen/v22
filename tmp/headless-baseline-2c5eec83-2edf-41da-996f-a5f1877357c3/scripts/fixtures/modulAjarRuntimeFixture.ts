export function createModulAjarRuntimeFixture() {
const stamp = '2026-10-17T00:00:00Z';
const tpIds = ['t1', 't2'];
const atpIds = ['a1', 'a2'];
const setting: any = { id: 'sem', curriculumType: 'KURIKULUM_MERDEKA', curriculum: 'Kurikulum Merdeka', semester: '1', subject: 'PJOK', grade: '7', level: 'SMP' };
const tp: any = { id: 'tp', academicSettingId: 'sem', workflowStatus: 'SIAP', updatedAt: stamp,
  items: tpIds.map((id,i) => ({ id, code: id, statement: 'Kompetensi '+id, order:i+1 })) };
const atp: any = { id: 'atp', academicSettingId: 'sem', workflowStatus: 'SIAP', updatedAt: stamp, basedOnTpUpdatedAt: stamp,
  items: atpIds.map((id,i) => ({ id, tpId: tpIds[i], linkedTpIds:[tpIds[i]], stepNumber:i+1, semester:1, jp:3 })) };
const mapping: any = { id: 'mapping', academicSettingId:'sem', updatedAt:stamp, units:[{
  id:'unit', title:'Unit', order:1, linkedTpIds:tpIds, linkedAtpItemIds:atpIds,
  materials:tpIds.map((id,i)=>({ id:'mat'+i, title:'Materi '+id, order:i+1, linkedTpIds:[id], linkedAtpItemIds:[atpIds[i]] }))
}] };
const meetings = [3,1,2].map(order => ({ id:'m'+order, title:'Judul '+order, unitId:'unit', order, jp:2,
  linkedTpIds:[tpIds[order===2?1:0]], linkedAtpItemIds:[atpIds[order===2?1:0]], materialIds:['mat'+(order===2?1:0)] }));
const execution: any = { id:'execution', academicSettingId:'sem', mappingId:'mapping', basedOnMappingUpdatedAt:stamp, units:[{unitId:'unit', meetings}] };
const schedules: any = [{ semesterPlanId:'sem', semester:1, schedule:{ semesterPlanId:'sem', status:'COMPLETE', entries:meetings.map(m=>({ meetingId:m.id, semesterPlanId:'sem', unitId:'unit', date:'2026-10-'+(18+m.order), jp:2, mode:'MANUAL', dayOfWeek:1, weekIndex:m.order })) } }];
const criteria: any = [...tpIds,'unrelated'].map(id=>({ id:'c'+id, academicSettingId:'sem', tpId:id, description:'KKTP '+id, approach:'deskripsi', indicators:['Indikator '+id], levels:[{level:'Baik',description:'Mandiri'}], workflowStatus:'SIAP', updatedAt:stamp }));
const assessment = (type:string) => ({ id:type, type, linkedTpIds:['t1'], description:'Asesmen '+type });
const plan: any = { id:'lp', curriculumType:'KURIKULUM_MERDEKA', academicSettingId:'sem', unitId:'unit', learningMeetingIds:['m3','m1','m2'], tpIds, atpItemIds:atpIds,
  kktpCriterionIds:['ct1','ct2'], sourceType:'MANUAL', status:'SIAP', confirmedAt:stamp, createdAt:stamp, updatedAt:stamp,
  objectives:tp.items.map((t:any)=>({ ...t, tpId:t.id })), topic:'Topik', allocatedJP:6,
  initialCompetency:'Kompetensi awal', graduateProfileDimensions:['Kemandirian'], resources:[{id:'r',title:'Buku'}], learningModel:'Praktik',
  learningExperiences:['UNDERSTAND','APPLY','REFLECT'].map((phase,i)=>({id:'e'+i,phase,description:'Kegiatan '+phase})),
  learningSteps: {
    opening: [3,1,2].map(order=>({id:'opening'+order,learningMeetingId:'m'+order,description:'Awal khusus '+order,durationMinutes:10})),
    core: [3,1,2].map(order=>({id:'activity'+order,learningMeetingId:'m'+order,description:'Aktivitas khusus '+order,durationMinutes:60})),
    closing: [3,1,2].map(order=>({id:'closing'+order,learningMeetingId:'m'+order,description:'Akhir khusus '+order,durationMinutes:10})),
  },
  assessmentPlan:{ initial:[assessment('INITIAL')], formative:[{...assessment('FORMATIVE'), learningMeetingId:'m1'}], summative:[assessment('SUMMATIVE')] },
  differentiation:{content:'Konten'}, enrichmentPlan:'Pengayaan', remedialPlan:'Remedial', reflection:{teacherReflection:'Guru',studentReflection:'Murid'} };
const context: any = { school:{name:'Sekolah'},profile:{name:'Guru'}, academicSetting:setting,tp,atp, atpUnitMapping:mapping, unitExecutionPlan:execution, learningMeetingSchedules:schedules, learningPlans:[plan],activeLearningPlanId:'lp',assessmentCriteria:criteria };

return context;
}

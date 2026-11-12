import { createReadyV21WorkflowFixture, v21DocumentContext } from './v21ReadyWorkflowFixture';
import { saveStorageV5 } from '../../src/services/storageV5';
import type { DocumentGenerationContext } from '../../src/services/documentEngine/types';

export function createIdentityExportFixture(semester: 1 | 2 = 1) {
  const storage = new Map<string,string>();
  Object.assign(globalThis, { localStorage: { getItem:(k:string)=>storage.get(k)??null, setItem:(k:string,v:string)=>storage.set(k,v), removeItem:(k:string)=>storage.delete(k) } });
  const state = createReadyV21WorkflowFixture();
  Object.assign(state.schools[0], { name:'IDENTITY_SCHOOL_9C71', npsn:'93472168', address:'IDENTITY_ADDRESS_9C71',
    village:'IDENTITY_VILLAGE_9C71', district:'IDENTITY_DISTRICT_9C71', regency:'IDENTITY_REGENCY_9C71', province:'IDENTITY_PROVINCE_9C71',
    principalName:'IDENTITY_PRINCIPAL_9C71', principalNip:'197912312008011973', principalSource:'IDENTITY_SOURCE_9C71', principalSourceUrl:'https://identity.invalid/9C71' });
  Object.assign(state.profiles[0], { name:'IDENTITY_TEACHER_9C71', nip:'198912312013012973', nuptk:'IDENTITY_NUPTK_9C71' });
  const mapping=state.annualData.atpUnitMappings![0].value;
  // Populate legacy document labels consistently from the fixture's canonical units.
  for(const unit of mapping.units) for(const id of unit.linkedAtpItemIds || []) {
    state.annualData.atp[0].value.items.find(item=>item.id===id)!.unitTitle=unit.title;
  }
  for(const [i,sp] of state.semesterPlans.filter(s=>s.yearPlanId==='y').entries()) {
    const unit=mapping.units[i];
    const plans=state.semesterData.learningPlan.find(e=>e.semesterPlanId===sp.id)!.value;
    for(const plan of plans) {
      plan.tpIds=[...unit.linkedTpIds!];plan.atpItemIds=[...unit.linkedAtpItemIds!];
      plan.objectives=state.annualData.tp[0].value.items.filter(tp=>plan.tpIds.includes(tp.id)).map(tp=>({id:tp.id,tpId:tp.id,code:tp.code,statement:tp.statement}));
      plan.kktpCriterionIds=state.semesterData.assessmentCriteria.find(e=>e.semesterPlanId===sp.id)!.value.filter(k=>plan.tpIds.includes(k.tpId)).map(k=>k.id);
      plan.allocatedJP=3;
      plan.learningSteps!.core![0].durationMinutes=85; // SD: 3 JP × 35 = 105 minutes including opening/closing.
      for(const items of Object.values(plan.assessmentPlan)) for(const item of items || []) item.linkedTpIds=[...plan.tpIds];
    }
    const aps=state.semesterData.assessmentPlan.find(e=>e.semesterPlanId===sp.id)!.value;
    aps.forEach(ap=>ap.tpIds=[...unit.linkedTpIds!]);
    state.semesterData.assessmentPackage.find(e=>e.semesterPlanId===sp.id)!.value.forEach(pkg=>pkg.blueprintItems.forEach(bp=>bp.objectiveRefId=unit.linkedTpIds![0]));
  }
  saveStorageV5(state);
  const context=v21DocumentContext(state,semester), sp=context.academicSetting.id;
  const read=(key:string)=>(state.semesterData as any)[key]?.find((e:any)=>e.semesterPlanId===sp)?.value;
  Object.assign(context, { workspace:state.workspaces[0], learningPlans:read('learningPlan'), assessmentPlans:read('assessmentPlan'),
    assessmentPackages:read('assessmentPackage'), assessmentCriteria:read('assessmentCriteria'), students:read('roster'),
    attendanceSessions:read('attendance')?.sessions, attendanceRecords:read('attendance')?.records, assessments:read('grade')?.assessments,
    assessmentResults:read('grade')?.results, journalRealizations:read('journalRealizations'), remedials:read('remedial'), enrichments:read('enrichment'),
    zipAnnualSource:{ yearPlan:state.yearPlans.find(y=>y.id==='y')!, semesterPlans:state.semesterPlans.filter(s=>s.yearPlanId==='y'), semesterData:state.semesterData, semesterJPSettings:state.semesterJPSettings } });
  return { state, context, storage };
}

export function withK13ExportData(context:DocumentGenerationContext):DocumentGenerationContext {
  const id=context.academicSetting.id;
  const analysis:any={id:'k13',academicSettingId:id,updatedAt:'2026-01-01T00:00:00Z',items:[{id:'kd1',skl:'SUBSTANCE_SKL',ki:'SUBSTANCE_KI',kd:'SUBSTANCE_KD',indikator:'SUBSTANCE_INDICATOR',materi:'SUBSTANCE_MATERIAL',alokasiJp:3,kegiatan:'SUBSTANCE_ACTIVITY'}]};
  const allocations:any[]=[{id:'ta-kd1',academicSettingId:id,sourceType:'KD',sourceId:'kd1',allocatedJP:3,jp:3,semester:1,month:8,weekNumber:1}];
  return {...context,academicSetting:{...context.academicSetting,curriculum:'Kurikulum 2013',curriculumType:'K13'},k13Analysis:analysis,
    k13KKM:{id:'kkm',academicSettingId:id,updatedAt:analysis.updatedAt,kkmTotal:75,items:[{id:'kd1',kd:'SUBSTANCE_KD',indikator:'SUBSTANCE_INDICATOR',kompleksitas:75,dayaDukung:75,intake:75,kkmIndikator:75}]} as any,
    timeAllocations:allocations,protaSemesterAllocations:[{semesterPlanId:id,semester:1,allocations}]};
}

import type { DocumentGenerationContext } from '../../src/services/documentEngine/types';

/** Current graph prerequisites for legacy pedagogical/print fixtures. Preserve
 * dangling TP/ATP references so negative cases still reject them. */
export function withCanonicalLearningPlanContext(context:DocumentGenerationContext):DocumentGenerationContext {
  const result=structuredClone(context);const stamp='2026-01-01T00:00:00Z';
  const plans=(result.learningPlans||[]).map(plan=>{
    const ids=plan.learningMeetingIds?.length?plan.learningMeetingIds:['meeting-'+plan.id];
    return {...plan,unitId:plan.unitId||'unit-'+plan.id,learningMeetingIds:ids,
      learningSteps:plan.learningSteps?Object.fromEntries(Object.entries(plan.learningSteps).map(([phase,items])=>[phase,items?.map(item=>({...item,learningMeetingId:item.learningMeetingId||ids[0]}))])):undefined};
  });
  result.learningPlans=plans;
  const units=plans.map((plan,index)=>({id:plan.unitId!,title:plan.title||plan.topic||'Unit fixture',order:index+1,linkedTpIds:plan.tpIds,linkedAtpItemIds:plan.atpItemIds,
    materials:[{id:'material-'+plan.id,title:'Materi fixture',order:1,linkedTpIds:plan.tpIds,linkedAtpItemIds:plan.atpItemIds}]}));
  result.atpUnitMapping={id:'fixture-mapping',academicSettingId:result.academicSetting.id,atpId:result.atp?.id||'missing-atp',units,updatedAt:stamp};
  result.unitExecutionPlan={id:'fixture-plan',academicSettingId:result.academicSetting.id,mappingId:'fixture-mapping',basedOnMappingUpdatedAt:stamp,updatedAt:stamp,
    units:plans.map(plan=>({unitId:plan.unitId!,meetings:plan.learningMeetingIds!.map((id,index)=>({id,unitId:plan.unitId!,order:index+1,title:'Pertemuan fixture',linkedTpIds:plan.tpIds,linkedAtpItemIds:plan.atpItemIds,materialIds:['material-'+plan.id]}))}))};
  result.learningMeetingSchedules=[{semesterPlanId:result.academicSetting.id,semester:1,schedule:{id:'fixture-schedule',semesterPlanId:result.academicSetting.id,status:'COMPLETE',unresolvedMeetingIds:[],updatedAt:stamp,basedOnMappingUpdatedAt:stamp,basedOnUnitExecutionPlanUpdatedAt:stamp,basedOnCalendarUpdatedAt:stamp,basedOnSubjectWeeklyScheduleUpdatedAt:stamp,basedOnWeeklyJP:3,
    entries:plans.flatMap(plan=>plan.learningMeetingIds!.map((id,index)=>({meetingId:id,unitId:plan.unitId!,semesterPlanId:result.academicSetting.id,sessionId:'session-'+id,sourceSlotId:`subject-slot:${result.academicSetting.id}:session-${id}:2026-08-03`,date:'2026-08-03',dayOfWeek:1,jp:plan.allocatedJP||3,weekIndex:index+1,mode:'MANUAL_OVERRIDE' as const})))}}];
  return result;
}

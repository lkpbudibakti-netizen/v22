import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as assessment from '../../src/services/annualJPAssessment';
import * as storage from '../../src/services/storageV5';
import * as jp from '../../src/services/jpEngine';
import * as execution from '../../src/services/unitExecutionPlanService';
import * as placement from '../../src/services/unitSemesterPlanningService';
import * as slots from '../../src/services/subjectScheduleService';
import * as schedule from '../../src/services/learningMeetingScheduleService';
import * as mappingValidation from '../../src/services/atpUnitMappingValidationService';
import * as readiness from '../../src/services/atpMappingReadinessService';

/** Actual component and handlers with deterministic hooks; all resolvers/storage remain real. */
export function annualPlanningManagerHarness(props: any) {
  const values: any[] = []; let cursor = 0;
  const source = readFileSync('src/components/AnnualPlanningManager.tsx', 'utf8');
  const compiled = ts.transpileModule(source.slice(source.indexOf('export const AnnualPlanningManager:')), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, React, console,
    ...assessment, ...storage, ...jp, ...execution, ...placement, ...slots, ...schedule, ...mappingValidation, ...readiness,
    useState: (initial: any) => { const i=cursor++; if (!(i in values)) values[i]=typeof initial==='function'?initial():initial; return [values[i],(next:any)=>{values[i]=typeof next==='function'?next(values[i]):next;}]; },
    useMemo: (factory:()=>any)=>factory(), useEffect: ()=>{},
    window: {setTimeout:(fn:()=>void)=>fn()}, document:{getElementById:()=>null},
    CalendarRange:'icon',ArrowRight:'icon',ArrowLeft:'icon',Calendar:'icon',CheckCircle2:'icon',AlertCircle:'icon',Layers:'icon',Info:'icon',
    AnnualPlanningTaskRail:'task-rail',TimePlanningManager:'time-manager',UnitExecutionPlanManager:'execution-manager',UnitSemesterPlanningManager:'placement-manager',
  });
  const nodes = (element:any):any[] => !React.isValidElement(element) ? [] : [element,...React.Children.toArray((element.props as any).children).flatMap(nodes)];
  return { nodes:()=>{cursor=0;return nodes(exports.AnnualPlanningManager(props));} };
}

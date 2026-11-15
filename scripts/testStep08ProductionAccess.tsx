import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { annualPlanningManagerHarness } from './fixtures/annualPlanningManagerHarness';
import { createTwoSemesterAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { AnnualPlanningTaskRail } from '../src/components/AnnualPlanningTaskRail';
import { TimePlanningManager } from '../src/components/administration/TimePlanningManager';
import { UnitSemesterPlanningManager } from '../src/components/UnitSemesterPlanningManager';
import { UnitExecutionPlanManager } from '../src/components/UnitExecutionPlanManager';
import { STORAGE_KEY_V5, loadStorageV5, saveUnitExecutionPlanV5 } from '../src/services/storageV5';
import { validateUnitExecutionPlan } from '../src/services/unitExecutionPlanService';
import { resolveUnitSemesterPlacement } from '../src/services/unitSemesterPlanningService';
import { initializer, evaluateExpression, nodes, nodeText } from './helpers/uiContractHarness';

const memory = new Map<string, string>(); let writes = 0;
let aiCalls = 0;
globalThis.fetch = (async () => { aiCalls++; throw new Error('Navigation must not call AI/network'); }) as typeof fetch;
(globalThis as any).localStorage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { writes++; memory.set(key, value); } };
const baseline = createTwoSemesterAdministrationImportFixture();
function mount(state = structuredClone(baseline), productionMode = true) {
  memory.set(STORAGE_KEY_V5, JSON.stringify(state));
  const year = state.yearPlans[0];
  const read = (key: string) => (state.annualData as any)[key][0]?.value;
  const saves: any[] = [];
  const props: any = { productionMode, yearPlan: year, school: state.schools[0], profile: state.profiles[0],
    academicSetting: { ...year, id: year.id, curriculum: 'Kurikulum Merdeka', semester: '', phase: year.phase || '' },
    semesterPlans: state.semesterPlans, mapping: read('atpUnitMappings'), unitExecutionPlan: read('unitExecutionPlans'), tp: read('tp'), atp: read('atp'),
    onSaveCalendar: () => { saves.push('calendar'); return true; }, onSaveTimeAllocations: () => { saves.push('allocation'); return true; },
    onSaveUnitExecutionPlan: (...args: any[]) => { saves.push(args); return true; }, onNextStep: () => {}, onBackToMapping: () => {} };
  const h = annualPlanningManagerHarness(props, true);
  const rail = () => h.nodes().find(n => n.type === 'task-rail');
  return { ...h, props, saves, rail, state };
}
function allTasks(view: ReturnType<typeof mount>) {
  const snapshot = memory.get(STORAGE_KEY_V5), before = JSON.stringify(view.state), writeCount = writes;
  const rail = view.rail(); assert(rail, 'Actual AnnualPlanningManager must render, not its readiness early return');
  for (const id of ['time-s1', 'time-s2', 'placement', 'meetings', 'time-allocation']) {
    assert.equal(rail.props.tasks.find((t: any) => t.id === id).isLocked, false, id);
    rail.props.onSelectTask(id);
    assert.equal(view.rail().props.activeTaskId, id, 'Active-task effect must not bounce to a prerequisite');
    const cta = view.nodes().find(n => n.type === 'button' && nodeText(n).startsWith('Lanjut ke '));
    if (cta) { assert(!cta.props.disabled); cta.props.onClick(); }
  }
  // Real rail mobile handler progresses by position, not first unfinished task.
  view.rail().props.onSelectTask('time-s1');
  for (const expected of ['time-s2', 'placement', 'meetings', 'time-allocation', 'time-s1']) {
    const tree = AnnualPlanningTaskRail(view.rail().props);
    const button = nodes(tree, n => n.type === 'button' && nodeText(n).startsWith('Buka '))[0];
    assert(button); button.props.onClick();
    assert.equal(view.rail().props.activeTaskId, expected);
  }
  assert.equal(view.saves.length, 0); assert.equal(writes, writeCount);
  assert.equal(aiCalls, 0);
  assert.equal(memory.get(STORAGE_KEY_V5), snapshot); assert.equal(JSON.stringify(view.state), before);
}

const draft = structuredClone(baseline);
draft.annualData.tp[0].value.workflowStatus = 'DRAFT'; draft.annualData.tp[0].value.needsReview = true;
draft.annualData.tp[0].value.items.forEach(tp => { tp.competence = 'Menganalisis'; });
draft.annualData.atp[0].value.workflowStatus = 'DRAFT'; draft.annualData.atp[0].value.needsReview = true;
draft.annualData.cp[0].value.updatedAt = '2030-01-01T00:00:00Z';
draft.annualData.cpAnalysis[0].value.updatedAt = '2030-01-02T00:00:00Z';
draft.annualData.cpAnalysis[0].value.items[0].cpText = 'Peringatan cakupan tekstual';
allTasks(mount(draft));
assert(!mount(draft, false).rail(), 'Normal retains TP/ATP readiness lock');
for (const warning of ['draft', 'review', 'cp-analysis', 'metadata', 'mapping-stale']) {
  const source = structuredClone(baseline);
  if (warning === 'draft') for (const key of ['tp', 'atp'] as const) source.annualData[key][0].value.workflowStatus = 'DRAFT';
  if (warning === 'review') for (const key of ['tp', 'atp'] as const) source.annualData[key][0].value.needsReview = true;
  if (warning === 'cp-analysis') {
    source.annualData.cp[0].value.updatedAt = '2030-01-01T00:00:00Z';
    source.annualData.cpAnalysis[0].value.needsReview = true;
    source.annualData.cpAnalysis[0].value.items[0].cpText = 'Peringatan cakupan tekstual';
  }
  if (warning === 'metadata') source.annualData.tp[0].value.items[0].competence = 'Menganalisis';
  if (warning === 'mapping-stale') source.annualData.atpUnitMappings![0].value.basedOnTpFingerprint = 'old-substance';
  allTasks(mount(source));
}
console.log('PASS draft/review/stale CP/analysis/competence metadata: five actual Step08 tasks, CTA and mobile rail open; Normal stays locked');

const empty = structuredClone(draft);
empty.semesterData.academicCalendar = []; empty.semesterData.subjectWeeklySchedules = [];
empty.semesterData.learningMeetingSchedules = []; empty.semesterJPSettings = [];
const emptyView = mount(empty); allTasks(emptyView);
emptyView.rail().props.onSelectTask('time-s2');
const time = emptyView.nodes().find(n => n.type === 'time-manager')!;
assert.equal(time.props.calendar, undefined); assert.equal(time.props.subjectWeeklySchedule, undefined);
assert.equal(time.props.explicitSemesterPlanId, 'sp2');
const noDates = renderToStaticMarkup(<TimePlanningManager {...time.props} />);
assert(!/type="date"[^>]*value="\d{4}-/.test(noDates), 'Missing calendar must not fabricate a date');
const normalEmpty = mount({ ...empty, annualData: structuredClone(baseline.annualData) }, false);
assert(normalEmpty.rail().props.tasks.find((t: any) => t.id === 'placement').isLocked);
console.log('PASS missing calendar/schedule: settings accessible, no automatic date/save; Normal prerequisite rail preserved');

for (const kind of ['tp', 'atp', 'unit', 'identity', 'missing']) {
  const bad = structuredClone(draft);
  const mapping = bad.annualData.atpUnitMappings![0].value;
  if (kind === 'tp') bad.annualData.atp[0].value.items[0].linkedTpIds = ['broken-tp'];
  if (kind === 'atp') mapping.units[0].materials[0].linkedAtpItemIds = ['broken-atp'];
  if (kind === 'unit') bad.annualData.unitExecutionPlans![0].value.units[0].unitId = 'broken-unit';
  if (kind === 'identity') mapping.academicSettingId = 'foreign-year';
  if (kind === 'missing') bad.annualData.atpUnitMappings = [];
  const view = mount(bad); allTasks(view);
  view.rail().props.onSelectTask('meetings');
  assert(!view.nodes().some(n => n.type === 'execution-manager'), 'Broken references cannot reach generation/AI actions');
  const errors = view.nodes().filter(n => n.props.role === 'alert').map(nodeText).join(' ');
  assert(errors.includes(kind === 'identity' ? 'academicSettingId' : kind === 'missing' ? 'Pemetaan' : `broken-${kind}`), errors);
  view.rail().props.onSelectTask('time-allocation');
  const time = view.nodes().find(n => n.type === 'time-manager')!;
  assert(time.props.allocationBlockers.length);
  for (const name of ['handleAutoAllocate', 'handleSaveAllocations']) {
    let message = '';
    evaluateExpression(initializer('src/components/administration/TimePlanningManager.tsx', name), {
      allocationBlockers: time.props.allocationBlockers, setSaveNotification: (value: string) => message = value,
      onSaveTimeAllocations: () => assert.fail('Invalid references must not save'),
    })();
    assert(message.length, 'Action must explain rejection');
  }
  assert.equal(view.saves.length, 0);
}
console.log('PASS broken TP/ATP/unit/context and missing sources: pages accessible, dependent actions rejected with specific reasons');

// Stale plan alone is advisory in Production; explicit save revalidates/rebases
// only the submitted copy. Original source and global validator stay unchanged.
const stalePlanState = structuredClone(draft);
stalePlanState.annualData.atpUnitMappings![0].value.updatedAt = '2030-02-01T00:00:00Z';
const staleView = mount(stalePlanState); allTasks(staleView);
staleView.rail().props.onSelectTask('placement');
const placement = staleView.nodes().find(n => n.type === 'placement-manager')!;
assert(placement && placement.props.productionMode);
const execution = staleView.nodes().find(n => n.type === 'execution-manager')!;
assert(execution && execution.props.productionMode);
const original = JSON.stringify(staleView.state);
const plan = staleView.props.unitExecutionPlan;
assert(validateUnitExecutionPlan(plan, staleView.props.mapping, staleView.props.atp, staleView.props.tp).isStale);
assert(execution.props.onSave(plan));
assert.equal(staleView.saves[0][0].basedOnMappingUpdatedAt, staleView.props.mapping.updatedAt);
assert.equal(JSON.stringify(staleView.state), original);
const brokenCandidate = structuredClone(plan); brokenCandidate.units[0].unitId = 'bad-candidate';
assert.equal(execution.props.onSave(brokenCandidate), false); assert.equal(staleView.saves.length, 1);
staleView.props.onSaveUnitExecutionPlan = (value: any) => { saveUnitExecutionPlanV5('y', value); return true; };
const realSave = staleView.nodes().find(n => n.type === 'execution-manager')!.props.onSave;
assert(realSave(plan));
const reloaded = loadStorageV5();
assert.equal(reloaded.annualData.unitExecutionPlans![0].value.basedOnMappingUpdatedAt, staleView.props.mapping.updatedAt);
for (const key of ['cp', 'cpAnalysis', 'tp', 'atp', 'atpUnitMappings'] as const) assert.deepEqual(reloaded.annualData[key], stalePlanState.annualData[key]);
// Actual child save handlers, not only the parent or WorkflowStepper.
for (const productionMode of [true, false]) {
  const changes: any[] = []; const messages: any[] = [];
  evaluateExpression(initializer('src/components/UnitSemesterPlanningManager.tsx', 'handleSave'), {
    productionMode, placementDraft: { mode: 'CONTIGUOUS_BOUNDARY', semester1LastUnitId: 'u' },
    validation: resolveUnitSemesterPlacement(plan, staleView.props.mapping), unitExecutionPlan: plan,
    onSave: (value: any) => { changes.push(value); return true; }, setSaveNotice: (value: any) => messages.push(value), setTimeout: () => 0,
  })();
  assert.equal(changes.length, productionMode ? 1 : 0);
  changes.length = 0;
  evaluateExpression(initializer('src/components/UnitExecutionPlanManager.tsx', 'handleSave'), {
    productionMode, clearedDraftBackup: null, draft: plan,
    validation: validateUnitExecutionPlan(plan, staleView.props.mapping, staleView.props.atp, staleView.props.tp),
    onSave: (value: any) => { changes.push(value); return true; }, setSaveNotice: (value: any) => messages.push(value), setTimeout: () => 0,
  })();
  assert.equal(changes.length, productionMode ? 1 : 0);
  const html = renderToStaticMarkup(<UnitSemesterPlanningManager {...placement.props} productionMode={productionMode} />);
  assert(html.includes('Pembagian Unit/Bab'));
}
const meetingHtml = renderToStaticMarkup(<UnitExecutionPlanManager {...execution.props} />);
assert(meetingHtml.includes('Struktur Pertemuan'));
const saveButton = meetingHtml.split('<button').find(button => button.split('</button>')[0].includes('Simpan Struktur'));
assert(saveButton && !saveButton.split('>')[0].includes('disabled'), 'Production permits explicit stale-source revalidation without editing the content');
console.log('PASS stale-plan warning and explicit validated save only; child placement handler, meeting component and global validator retain Normal rules');
console.log('PASS Step08 Production access. Actual component/handlers with deterministic hooks and real resolvers; no Gemini or browser-live claim.');
assert.equal(aiCalls, 0);

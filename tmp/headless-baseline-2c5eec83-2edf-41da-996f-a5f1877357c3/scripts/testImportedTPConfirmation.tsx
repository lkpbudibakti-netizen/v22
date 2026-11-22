import assert from 'node:assert/strict';
import React from 'react';
import * as icons from 'lucide-react';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createReadyAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import * as workflow from '../src/services/cpWorkflowService';
import * as fidelity from '../src/services/tpSemanticFidelity';
import { normalizeCPVerificationStatus } from '../src/types';
import { CANONICAL_MERDEKA_TP_CODE_REGEX } from '../src/services/tpCodeContract';
import { computeTpSubstantiveFingerprint } from '../src/services/atpMappingActionApplyService';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { prepareCompleteAdministrationProjectImport } from '../src/services/administrationProjectImportService';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';
import { STORAGE_KEY_V5, saveTPV5, loadStorageV5 } from '../src/services/storageV5';
import { resolveATPUnitMappingReadiness } from '../src/services/atpMappingReadinessService';

// Execute actual handlers with deterministic hooks. This is not a browser/Gemini live test.
function mount(props: any, generate: () => Promise<any> = async () => { throw Error('AI must not run'); }) {
  const values: any[] = []; let cursor = 0; const alerts: string[] = [];
  const source = readFileSync('src/components/TPManager.tsx', 'utf8');
  const exports: any = {};
  runInNewContext(ts.transpileModule(source.slice(source.indexOf('export const TPManager')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, { exports, React, ...icons, ...workflow, ...fidelity, normalizeCPVerificationStatus,
    CANONICAL_MERDEKA_TP_CODE_REGEX, P3_DIMENSIONS: [],
    useState: (initial: any) => { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], (next: any) => values[i] = typeof next === 'function' ? next(values[i]) : next]; },
    useEffect: () => {}, useRef: (initial: any) => { const i = cursor++; return values[i] ||= { current: initial }; },
    alert: (text: string) => alerts.push(text), generateTPWithAI: generate, recordDiagnosticEvent: () => {}, console,
  });
  const walk = (node: any): any[] => React.isValidElement(node) ? [node, ...React.Children.toArray((node.props as any).children).flatMap(walk)] : [];
  const text = (node: any): string => React.isValidElement(node) ? React.Children.toArray((node.props as any).children).map(text).join('') : String(node ?? '');
  const nodes = () => { cursor = 0; return walk(exports.TPManager(props)); };
  return { props, alerts, nodes, text, click: async (label: string) => {
    const button = nodes().find(node => node.type === 'button' && text(node).includes(label));
    assert(button && !button.props.disabled, label); await button.props.onClick();
  }};
}

const source = createReadyAdministrationImportFixture();
const archive = await readCompleteProjectZip(await createCompleteProjectZip(source, 'y'));
const imported = prepareCompleteAdministrationProjectImport(source, archive, {
  mode: 'CONTINUE_EDITING', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-13',
});
const year = imported.state.yearPlans.find(y => y.id === imported.yearPlanId)!;
const get = (key: 'cp' | 'cpAnalysis' | 'tp' | 'atp') => imported.state.annualData[key].find(e => e.yearPlanId === year.id)!.value as any;
const originalTP = structuredClone(get('tp'));
const cp = get('cp'), cpAnalysis = get('cpAnalysis');
const setting: any = { ...year, subject: year.subject, curriculum: 'Kurikulum Merdeka', semester: '1 (Ganjil)' };
let saved: any, continued = 0;
const props: any = { tp: { ...originalTP, workflowStatus: 'DRAFT', needsReview: true }, cp, cpAnalysis,
  academicSetting: setting, context: { ...setting, profileId: year.profileId, schoolId: year.schoolId }, profile: {},
  onSaveTP: (tp: any) => { saved = tp; }, onNextStep: () => continued++, onBackToCP: () => {} };
const before = JSON.stringify({ cp, cpAnalysis, originalTP });
const ui = mount(props);
await ui.click('Validasi & Konfirmasi TP');
assert(saved, ui.alerts.join('; '));
assert.equal(saved.workflowStatus, 'SIAP');
assert.deepEqual(saved.items, originalTP.items);
assert.equal(saved.updatedAt, originalTP.updatedAt, 'Confirmation alone must not stale ATP/mapping');
assert.equal(computeTpSubstantiveFingerprint(saved), computeTpSubstantiveFingerprint(originalTP));
assert(workflow.validateATPDataWorkflow(get('atp'), saved, undefined, cp, cpAnalysis).isSiap);
const storage = new Map([[STORAGE_KEY_V5, JSON.stringify(imported.state)]]);
(globalThis as any).localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
saveTPV5(year.id, saved);
const reloaded = loadStorageV5();
const reloadedTP = reloaded.annualData.tp.find(e => e.yearPlanId === year.id)!.value;
assert.deepEqual(reloadedTP.items, originalTP.items);
assert(workflow.validateATPDataWorkflow(get('atp'), reloadedTP, undefined, cp, cpAnalysis).isSiap);
const mapping = reloaded.annualData.atpUnitMappings!.find(e => e.yearPlanId === year.id)!.value;
assert(resolveATPUnitMappingReadiness(mapping, get('atp'), reloadedTP).canProceed, 'Confirmation/reload must preserve valid Step 07/checkpoint source');
props.tp = saved;
await ui.click('Lanjut');
assert.equal(continued, 1);
assert.equal(JSON.stringify({ cp, cpAnalysis, originalTP }), before);

// Deliberately incomplete coverage: code/ID valid is insufficient.
const incomplete = { ...originalTP, items: originalTP.items.map((i: any) => ({ ...i, competence: 'Mengenal', statement: 'Mengenal bola', contentScope: 'Bola' })) };
assert(!workflow.validateTPDataWorkflow(incomplete, cp, cpAnalysis, setting).isSiap);
assert(fidelity.getUncoveredTPChunks(incomplete.items, cpAnalysis.items[0]).some(s => s.includes('sinyal terwakili:') && s.includes('perlu ditinjau:')));
saved = undefined;
const badUI = mount({ ...props, tp: incomplete });
await badUI.click('Validasi & Konfirmasi TP');
assert.equal(saved, undefined);
assert(badUI.alerts.some(a => a.includes('Mempraktikkan') && a.includes('Revisi TP secara manual')));
const unsupportedReview = [{ analysisId: cpAnalysis.items[0].id, fingerprint: fidelity.tpSubstanceFingerprint(incomplete.items, cpAnalysis.items[0]), rationale: 'Saya menyatakan tujuan ini lengkap walaupun baru mengenal bola dan belum mempraktikkan gerak.' }];
assert(!fidelity.checkTPSemanticFidelity(incomplete.items, cpAnalysis.items, unsupportedReview).isValid, 'Review must not override an explicit missing competence');
const revisedUI = mount({ ...props, tp: { ...originalTP, workflowStatus: 'DRAFT' } });
await revisedUI.click('Validasi & Konfirmasi TP');
assert.equal(saved.workflowStatus, 'SIAP', 'Manual revision can validate without AI');

// Teacher semantic judgment is separate from lexical screening; exact-source bound.
const analysis = { id: 'paraphrase', cpCompetence: 'Memahami', materialScope: 'teks sederhana' };
const paraphrase = [{ id: 'p', code: 'E1-TKS-01', statement: 'Menjelaskan isi bacaan pendek', competence: 'Menjelaskan', contentScope: 'Bacaan pendek', cpAnalysisItemIds: ['paraphrase'] }];
const review = [{ analysisId: analysis.id, fingerprint: fidelity.tpSubstanceFingerprint(paraphrase, analysis), rationale: 'Menjelaskan isi bacaan pendek menunjukkan pemahaman terhadap teks sederhana yang dirujuk.' }];
assert(!fidelity.checkTPSemanticFidelity(paraphrase, [analysis]).isValid);
assert(fidelity.checkTPSemanticFidelity(paraphrase, [analysis], review).isValid);
assert(!fidelity.checkTPSemanticFidelity([{ ...paraphrase[0], statement: 'Melempar bola' }], [analysis], review).isValid);
assert(!fidelity.checkTPSemanticFidelity(paraphrase, [{ ...analysis, materialScope: 'puisi kompleks' }], review).isValid);
assert(!fidelity.checkTPSemanticFidelity([], [analysis], review).isValid);
saved = undefined;
const paraphrasedProject = { ...originalTP, needsReview: true, items: originalTP.items.map((item: any, index: number) => ({ ...item,
  statement: index ? 'Melakukan variasi operan menggunakan tangan' : 'Melakukan operan menggunakan tangan',
  competence: 'Melakukan', contentScope: 'Operan menggunakan tangan' })) };
const reviewedUI = mount({ ...props, tp: paraphrasedProject });
const reason = reviewedUI.nodes().find(node => node.type === 'textarea');
assert(reason && !reason.props.disabled);
reason.props.onChange({ target: { value: 'Operan menggunakan tangan pada kedua TP adalah praktik melempar bola dan variasinya, sesuai lingkup gerak sumber.' } });
await reviewedUI.click('Validasi & Konfirmasi TP');
assert(saved?.workflowStatus === 'SIAP', reviewedUI.alerts.join('; '));
assert(saved.substanceReviews.length === 1);
saveTPV5(year.id, saved);
const reviewedReload = loadStorageV5().annualData.tp.find(entry => entry.yearPlanId === year.id)!.value;
assert(workflow.validateTPDataWorkflow(reviewedReload, cp, cpAnalysis, setting).isSiap);
assert.deepEqual(reviewedReload.items, paraphrasedProject.items);
assert(!workflow.validateTPDataWorkflow({ ...originalTP, items: [{ ...originalTP.items[0], code: 'INVALID' }] }, cp, cpAnalysis, setting).isSiap);
assert(!workflow.validateTPDataWorkflow({ ...originalTP, items: [{ ...originalTP.items[0], cpAnalysisItemIds: ['fiction'] }] }, cp, cpAnalysis, setting).isSiap);

// AI produces a preview only, even on empty TP. Malformed wording cannot become SIAP.
saved = undefined;
const malformed = originalTP.items.map((i: any) => ({ ...i, statement: 'Mempraktikkan mempraktikkan lempar bola' }));
const aiUI = mount({ ...props, tp: { ...originalTP, items: [] } }, async () => ({ items: malformed, engine: 'gemini' }));
await aiUI.click('Generate TP dari CP');
assert.equal(saved, undefined);
assert(aiUI.nodes().some(n => n.props.id === 'tp-regeneration-preview'));
assert(aiUI.nodes().some(n => aiUI.text(n).includes('PERLU_DILENGKAPI')));
await aiUI.click('Setujui perubahan TP pada preview');
assert(saved.needsReview && saved.workflowStatus !== 'SIAP');
assert(fidelity.tpWordingIssues(malformed).length > 0);
const runtime = validateWorkflowDependencies({ cp, cpAnalysis, tp: saved, atp: get('atp'), academicSetting: setting } as any);
assert(runtime.stepStates.atp.isBlocked);
console.log('PASS import → TP confirm without AI → ATP; incomplete/manual revision; exact IDs/order/lineage; scoped semantic review invalidation; preview isolation and malformed AI/empty draft gate. Mock handlers, no live Gemini/browser claim.');

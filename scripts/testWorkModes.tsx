import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JSZip from 'jszip';
import { inflateSync } from 'node:zlib';
import { readWorkMode, saveWorkMode, WORK_MODE_STORAGE_KEY } from '../src/services/workMode';
import { createTwoSemesterAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { completeImportModalHarness } from './fixtures/completeImportModalHarness';
import { documentZipHarness } from './fixtures/documentZipHarness';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { prepareCompleteAdministrationProjectImport, importCompleteAdministrationProject } from '../src/services/administrationProjectImportService';
import { buildImportedProjectExportContext, importedProjectExportReadiness } from '../src/services/identityOnlyProjectExport';
import { generateDocument, generatePdfDocument, validateDocumentRequirements } from '../src/services/documentEngine';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { createDocumentSnapshot, resolveEffectiveContext } from '../src/services/documentEngine/snapshot';
import { buildProductionEvaluationReport } from '../src/services/productionEvaluationService';
import { STORAGE_KEY_V5, loadStorageV5 } from '../src/services/storageV5';
import { WorkflowStepper } from '../src/components/WorkflowStepper';
import { evaluateExpression, initializer, jsxCallback } from './helpers/uiContractHarness';

const memory = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) };
assert.equal(readWorkMode(), 'authoring');
memory.set(STORAGE_KEY_V5, 'MASTER_UNCHANGED');
assert(saveWorkMode('production')); assert.equal(readWorkMode(), 'production');
assert.equal(memory.get(STORAGE_KEY_V5), 'MASTER_UNCHANGED');
assert(saveWorkMode('authoring')); assert.equal(readWorkMode(), 'authoring');
assert.equal(memory.get(STORAGE_KEY_V5), 'MASTER_UNCHANGED');
memory.delete(WORK_MODE_STORAGE_KEY);

const ready = createTwoSemesterAdministrationImportFixture();
const draft = structuredClone(ready);
for (const key of ['cp', 'cpAnalysis', 'tp', 'atp'] as const) draft.annualData[key][0].value.workflowStatus = 'DRAFT';
for (const entry of draft.semesterData.learningPlan) for (const plan of entry.value) { plan.status = 'DRAFT'; plan.confirmedAt = undefined; }
for (const entry of draft.semesterData.assessmentPlan) for (const plan of entry.value) { plan.workflowStatus = 'DRAFT'; plan.needsReview = true; }
for (const entry of draft.semesterData.assessmentPackage) for (const pkg of entry.value) { pkg.workflowStatus = 'DRAFT'; pkg.needsReview = true; }
for (const entry of draft.semesterData.academicCalendar) entry.value.calendar.workflowStatus = 'UNRESOLVED';
for (const entry of draft.semesterData.learningMeetingSchedules || []) entry.value.status = 'DRAFT';
const sourceBefore = JSON.stringify(draft);
const bytes = await createCompleteProjectZip(draft, 'y');
const archive = await readCompleteProjectZip(bytes);
const options = { mode: 'IDENTITY_ONLY' as const, targetProfileId: 'p2', targetSchoolId: 's2', documentDate: '2026-11-15', workMode: 'production' as const };
const imported = prepareCompleteAdministrationProjectImport(draft, archive, options);
assert.equal(imported.nextStep, 'admin');
const year = imported.state.yearPlans.find(year => year.id === imported.yearPlanId)!;
assert.equal(year.identityOnlyImport?.factualDataExcluded, true);
const semesterIds = new Set(imported.state.semesterPlans.filter(plan => plan.yearPlanId === year.id).map(plan => plan.id));
for (const key of ['roster', 'attendance', 'grade', 'remedial', 'enrichment', 'journalRealizations'] as const) {
  assert(!imported.state.semesterData[key]?.some(entry => semesterIds.has(entry.semesterPlanId)), 'No source factual data: ' + key);
}
const context = { ...buildImportedProjectExportContext(imported.state, year.id), workMode: 'production' as const, skipDownload: true };
assert.equal(context.tp!.workflowStatus, 'DRAFT'); assert.equal(context.atp!.workflowStatus, 'DRAFT');
const importedBefore = JSON.stringify(imported.state);

const productionSteps = renderToStaticMarkup(<WorkflowStepper currentStep="atp" onSelectStep={() => {}} {...context} productionMode />);
assert(!productionSteps.includes('disabled=""'));
const normalSteps = renderToStaticMarkup(<WorkflowStepper currentStep="atp" onSelectStep={() => {}} {...context} />);
assert(normalSteps.includes('disabled=""'));
for (const file of ['ATPManager', 'TPManager', 'ATPUnitMappingManager']) {
  const name = file === 'ATPManager' ? 'handleSaveAndNext' : file === 'TPManager' ? 'handleContinue' : 'handleProceedNext';
  let next = 0;
  const go = evaluateExpression(initializer('src/components/' + file + '.tsx', name), { productionMode: true, onNextStep: () => { next++; } });
  go(); assert.equal(next, 1, file + ' continuation must not save/finalize or call AI');
  assert.equal(jsxCallback(file, 'productionMode', { productionMode: true }), true);
}

function pdfText(buffer: Uint8Array): string {
  let text = Buffer.from(buffer).toString('latin1');
  for (const match of [...text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]) {
    try { text += '\n' + inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { /* Not a flate stream. */ }
  }
  return text;
}
async function xml(blob: Blob) { return (await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()))).file('word/document.xml')!.async('string'); }

for (const type of ['CP', 'TP', 'ATP', 'PROTA', 'PROMES', 'MODUL_AJAR', 'ASESMEN', 'KKTP', 'KALENDER_AKADEMIK'] as const) {
  const validation = validateDocumentRequirements(type, context);
  assert(validation.isValid, type + ': ' + validation.missingFields.join('; '));
  const docx = await generateDocument(type, context); assert(docx.blob!.size > 0);
  const pdf = await generatePdfDocument(type, context); assert(pdf.blob.size > 0);
  const content = await xml(docx.blob!);
  assert(content.includes(context.profile.name), type + ' uses destination teacher');
  assert(!content.includes('GURU_ASAL_TEST') && !content.includes('SEKOLAH_ASAL_TEST'), type + ' must not leak source identity');
}
assert.equal(validateDocumentRequirements('MODUL_AJAR', { ...context, workMode: 'authoring' }).isValid, false);
assert.equal(validateDocumentRequirements('DAFTAR_HADIR', context).isValid, false);
const orphan = structuredClone(context); orphan.assessmentCriteria!.forEach(criterion => { criterion.tpId = 'missing'; });
assert.equal(validateDocumentRequirements('KKTP', orphan).isValid, false);
const contaminated = structuredClone(context); contaminated.tp!.items[0].statement += ' GURU_ASAL_TEST';
assert.equal(validateDocumentRequirements('TP', contaminated).isValid, false);
assert.equal(validateDocumentRequirements('CP', contaminated).isValid, true);

const stale = createDocumentSnapshot({ ...context, profile: { ...context.profile, name: 'GURU_LAMA' } });
assert.equal(resolveEffectiveContext({ ...context, snapshot: stale }).profile.name, context.profile.name);
assert.equal(resolveEffectiveContext({ ...context, workMode: 'authoring', snapshot: stale }).profile.name, 'GURU_LAMA');
const incomplete = structuredClone(context); incomplete.learningMeetingSchedules = []; incomplete.learningPlans![0].initialCompetency = '';
const projection = buildModulAjarProjection(incomplete);
assert(projection.isReady); assert.equal(projection.sections?.length, 7);
const incompleteWord = await xml((await generateDocument('MODUL_AJAR', incomplete)).blob!);
const incompletePdf = pdfText(new Uint8Array(await (await generatePdfDocument('MODUL_AJAR', incomplete)).blob.arrayBuffer()));
for (const heading of ['INFORMASI UMUM', 'KOMPONEN INTI', 'RENCANA PERTEMUAN', 'ASESMEN', 'DIFERENSIASI', 'REFLEKSI']) {
  assert(incompleteWord.includes(heading), 'DOCX section ' + heading); assert(incompletePdf.includes(heading), 'PDF section ' + heading);
}
assert(incompletePdf.includes(projection.resolvedTPs[0].statement));
assert(!incompletePdf.includes('undefined JP'));
assert(buildProductionEvaluationReport(incomplete).includes('WARNING'));

// Equal ready master => the same DOCX body, independent of the operating mode.
const authoring = { ...buildImportedProjectExportContext(ready, 'y'), skipDownload: true };
const normalXml = await xml((await generateDocument('MODUL_AJAR', authoring)).blob!);
const productionXml = await xml((await generateDocument('MODUL_AJAR', { ...authoring, workMode: 'production' })).blob!);
assert.equal(productionXml, normalXml, 'Both modes must share the same module format for a ready master');

// Exercise the real import modal: no export function may be called by Production import.
memory.set(STORAGE_KEY_V5, JSON.stringify(draft));
let received: any; let nextStep = '';
const modal = completeImportModalHarness({ state: { ...draft, activeProfileId: 'p2' }, workMode: 'production', onClose: () => {}, onSuccess: (result: any) => { received = result; }, onContinue: (step: string) => { nextStep = step; } }, {
  readCompleteProjectZip, prepareCompleteAdministrationProjectImport, importCompleteAdministrationProject, importedProjectExportReadiness, loadStorageV5,
  importCompleteAdministrationProjectAndExport: () => assert.fail('Production import must not auto-export'),
  generateZipBundle: () => assert.fail('Production import must not auto-download'),
});
await modal.nodes().find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ arrayBuffer: async () => bytes }] } });
const importButton = modal.nodes().find(node => node.type === 'button' && modal.text(node).includes('Impor Master & Periksa Dokumen'));
assert(importButton && !importButton.props.disabled); await importButton.props.onClick();
assert(received); assert.equal(nextStep, 'admin');

// The actual individual-export handler must use current identity without saving records.
let singleDownloads = 0;
const single = evaluateExpression(initializer('src/components/AdminDocsExport.tsx', 'handleGenerateSingleDoc'), {
  context, academicSetting: context.academicSetting, workspace: context.workspace, documentMode: 'data',
  localDocs: [], historicalModulSnapshot: undefined,
  getDocRecord: () => ({ id: 'old-record', type: 'TP', snapshot: stale }),
  resolveEffectiveContext, createDocumentSnapshot, validateDocumentRequirements, generateDocument, generatePdfDocument,
  saveAs: () => { singleDownloads++; },
  setGeneratingDocType: () => {}, setExportErrorMessage: (message: string | null) => { if (message) assert.fail(message); },
  setExportSuccessMessage: () => {}, setTimeout: () => 0,
  setLocalDocs: () => assert.fail('Production exports must not save document records'),
  onUpdateDocuments: () => assert.fail('Production exports must not change persisted documents'),
  formatOfficialSnapshotDate: (date: string) => date,
});
await single('TP', 'pdf'); assert.equal(singleDownloads, 1);
await single('TP', 'docx');

// Real bundle orchestration generates bytes and invokes the download once at the end.
const zip = documentZipHarness();
const result = await zip.generateZipBundle({ types: ['TP', 'MODUL_AJAR', 'ASESMEN', 'DAFTAR_HADIR'], format: 'both' }, { ...context, skipDownload: false });
assert.equal(zip.downloads.length, 1); assert(result.zipBlob!.size > 0);
assert(result.itemResults?.some(item => item.status === 'SUCCESS'));
assert(result.itemResults?.some(item => item.type === 'DAFTAR_HADIR' && item.status === 'SKIPPED'));
assert.equal(JSON.stringify(imported.state), importedBefore);
assert.equal(JSON.stringify(draft), sourceBefore);
console.log('PASS: mode switch isolation, full navigation, no automatic import download, shared DOCX/PDF format, draft exports, target identity, minimum substance, ZIP download once and immutable master');

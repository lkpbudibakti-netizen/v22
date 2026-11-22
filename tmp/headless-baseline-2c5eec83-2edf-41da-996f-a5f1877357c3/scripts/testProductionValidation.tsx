import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JSZip from 'jszip';
import { createTwoSemesterAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { documentZipHarness } from './fixtures/documentZipHarness';
import { buildImportedProjectExportContext } from '../src/services/identityOnlyProjectExport';
import { generateDocument, generatePdfDocument, validateDocumentRequirements } from '../src/services/documentEngine';
import { buildProductionEvaluationReport } from '../src/services/productionEvaluationService';
import { assertProductionDocumentFile, ProductionExportError } from '../src/services/productionValidation';
import { WorkflowStepper } from '../src/components/WorkflowStepper';
import { validateCPAnalysisDataWorkflow } from '../src/services/cpWorkflowService';

const memory = new Map<string,string>();
(globalThis as any).localStorage = { getItem:(key:string)=>memory.get(key) ?? null, setItem:(key:string,value:string)=>memory.set(key,value), removeItem:(key:string)=>memory.delete(key) };
const state = createTwoSemesterAdministrationImportFixture();
const normal = { ...buildImportedProjectExportContext(state, 'y'), skipDownload:true };
const base = { ...normal, workMode:'production' as const };
const original = JSON.stringify(state);
async function exportable(context: typeof base) {
  for (const type of ['TP','ATP'] as const) {
    assert(validateDocumentRequirements(type,context).isValid, type);
    await assertProductionDocumentFile((await generateDocument(type,context)).blob,'docx');
    await assertProductionDocumentFile((await generatePdfDocument(type,context)).blob,'pdf');
  }
}
const stale = structuredClone(base);
stale.cp!.updatedAt = '2030-01-01T00:00:00.000Z';
stale.cpAnalysis!.updatedAt = '2030-01-02T00:00:00.000Z';
stale.tp!.needsReview = true;
assert(!renderToStaticMarkup(<WorkflowStepper currentStep="atp" onSelectStep={()=>{}} {...stale} productionMode />).includes('disabled=""'));
await exportable(stale);
assert(buildProductionEvaluationReport(stale).includes('WARNING'));
console.log('PASS 1: stale CP/analysis permits navigation and export');

const coverage = structuredClone(base);
coverage.cpAnalysis!.items[0].cpText = 'Teks rujukan berbeda untuk uji cakupan tekstual';
const coverageIssue = validateCPAnalysisDataWorkflow(coverage.cpAnalysis,coverage.cp).issues.find(issue=>issue.includes('Teks CP'));
assert(coverageIssue);
assert(buildProductionEvaluationReport(coverage).split('\n').some(line=>line.includes(coverageIssue!) && line.includes('WARNING')));
await exportable(coverage);
console.log('PASS 2: textual CP warning remains advisory');

const metadata = structuredClone(base);
metadata.tp!.items[0].competence = '';
await exportable(metadata);
assert(buildProductionEvaluationReport(metadata).split('\n').some(line=>line.includes('Kompetensi') && line.includes('WARNING')));
console.log('PASS 3: incomplete competency metadata permits export');

const draft = structuredClone(base); draft.atp!.workflowStatus='DRAFT'; draft.tp!.workflowStatus='DRAFT';
await exportable(draft);
console.log('PASS 4: minimum ATP substance exports without SIAP');

const identity = structuredClone(base);
identity.zipAnnualSource!.yearPlan.identityOnlyImport = { ...(identity.zipAnnualSource!.yearPlan.identityOnlyImport || {}), sourceIdentityTokens:['SEKOLAH ASAL TERLARANG'] } as any;
identity.cp!.generalDescription += ' SEKOLAH ASAL TERLARANG';
const identityCheck = validateDocumentRequirements('CP',identity);
assert(!identityCheck.isValid);
assert(identityCheck.findings?.every(f=>f.classification==='BLOCKER_DOKUMEN'));
assert(validateDocumentRequirements('TP',identity).isValid);
const isolated = await documentZipHarness().generateZipBundle({types:['CP','TP'],format:'docx'},identity);
assert.equal(isolated.successCount,1);
console.log('PASS 5: source identity blocks only affected document');

const generator = documentZipHarness({failTypes:['CP']});
const partial = await generator.generateZipBundle({types:['CP','TP'],format:'both'},{...base,skipDownload:false});
assert.equal(generator.downloads.length,1);
assert(!partial.isComplete && partial.exportedCount === 1 && partial.failedCount === 1);
const archive = await JSZip.loadAsync(await partial.zipBlob!.arrayBuffer());
const reportEntry = Object.values(archive.files).find(file=>file.name.endsWith('Laporan_Ekspor.txt'))!;
const report = await reportEntry.async('string');
assert(report.includes('TIDAK LENGKAP') && report.includes('BLOCKER_DOKUMEN') && !report.includes('BLOCKER_PAKET'));
console.log('PASS 6-7: generator failure isolated; partial ZIP downloaded with failure report');

const allFailed = documentZipHarness({failTypes:['CP','TP']});
await assert.rejects(()=>allFailed.generateZipBundle({types:['CP','TP'],format:'docx'},base),error=>error instanceof ProductionExportError && error.findings.some(f=>f.classification==='BLOCKER_PAKET'));
assert.equal(allFailed.downloads.length,0);
console.log('PASS 8: zero generated documents yields BLOCKER_PAKET');

const normalDraft = structuredClone(normal);
normalDraft.learningPlans![0].status='DRAFT';
assert(!validateDocumentRequirements('MODUL_AJAR',normalDraft).isValid);
assert(validateDocumentRequirements('MODUL_AJAR',{...normalDraft,workMode:'production'}).isValid);
const normalZip = await documentZipHarness().generateZipBundle({types:['TP'],format:'docx'},normal);
assert(normalZip.isComplete);
const normalArchive = await JSZip.loadAsync(await normalZip.zipBlob!.arrayBuffer());
assert(!Object.keys(normalArchive.files).some(name=>name.endsWith('Laporan_Ekspor.txt')));
console.log('PASS 9: Normal retains strict workflow and ZIP contents');
console.log('SKIP 10: PAI V6.1 fixture not available in repository');

for (const options of [{failDownload:true},{failZip:true}]) await assert.rejects(()=>documentZipHarness(options).generateZipBundle({types:['TP'],format:'docx'},{...base,skipDownload:false}),error=>error instanceof ProductionExportError && error.findings.some(f=>f.classification==='BLOCKER_PAKET'));
const invalid = await documentZipHarness({invalidTypes:['CP']}).generateZipBundle({types:['CP','TP'],format:'both'},base);
assert.equal(invalid.failedCount,1); assert.equal(invalid.exportedCount,1);
await assert.rejects(()=>assertProductionDocumentFile(new Blob(['broken']),'pdf'));
await assert.rejects(()=>assertProductionDocumentFile(new Blob(['broken']),'docx'));
const orphan = structuredClone(base); orphan.atp!.items[0].linkedTpIds!.push('missing-tp');
assert(!validateDocumentRequirements('ATP',orphan).isValid);
assert(validateDocumentRequirements('TP',orphan).isValid);
assert.equal(JSON.stringify(state),original);
console.log('PASS: corrupt files, orphan references, ZIP/download failures and project immutability');


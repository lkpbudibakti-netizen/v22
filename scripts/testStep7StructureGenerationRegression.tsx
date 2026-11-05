import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ATPUnitMappingManager } from '../src/components/ATPUnitMappingManager';
import { generateCanonicalATPUnitMappingWithAI } from '../src/services/aiService';
import { prepareMappingGenerationPreview, approveMappingGenerationPreview } from '../src/services/atpMappingGenerationPreview';
import { validateATPUnitMappingCanonical } from '../src/services/atpUnitMappingValidationService';
import { fallbackAnalyzeMapping } from '../server/mappingAnalysis';
import { fallbackGenerateCanonicalATPUnitMapping } from '../server/curriculumFallback';

const tp: any = { id: 'tp', academicSettingId: 'year', updatedAt: 'now', items: [
  { id: 't1', code: 'E1-BOL-01', statement: 'Mempraktikkan lempar tangkap bola', competence: 'Mempraktikkan', contentScope: 'Lempar tangkap bola', order: 1 },
  { id: 't2', code: 'E2-SEH-01', statement: 'Menerapkan kebersihan tubuh', competence: 'Menerapkan', contentScope: 'Kebersihan tubuh', order: 2 },
] };
const atp: any = { id: 'atp', academicSettingId: 'year', tpDataId: 'tp', updatedAt: 'now', items: [
  { id: 'a1', stepNumber: 1, focus: 'Mempraktikkan lempar tangkap bola', linkedTpIds: ['t1'] },
  { id: 'a2', stepNumber: 2, focus: 'Menerapkan kebersihan tubuh', linkedTpIds: ['t2'] },
] };
const unit = (id: string, title: string, order: number, tpId: string, atpId: string) => ({ id, title, order,
  linkedTpIds: [tpId], linkedAtpItemIds: [atpId], materials: [{ id: 'm-'+id, title, order: 1, linkedTpIds: [tpId], linkedAtpItemIds: [atpId] }] });
const current = [unit('teacher1', 'Lempar tangkap bola', 1, 't1', 'a1'), unit('teacher2', 'Kebersihan tubuh', 2, 't2', 'a2')];
const candidate: any = { id: 'generated', academicSettingId: 'year', atpId: 'atp', tpDataId: 'tp', updatedAt: 'new',
  units: [unit('ai1', 'Lempar tangkap bola', 1, 't1', 'a1'), unit('ai2', 'Kebersihan tubuh', 2, 't2', 'a2')] };
const snapshot = JSON.stringify({ current, candidate, atp, tp });
const preview = prepareMappingGenerationPreview(candidate, current, atp, tp, 2);
assert.deepEqual(preview.candidate.units.map(u => u.id), ['teacher1', 'teacher2']);
assert.deepEqual(preview.candidate.units.map(u => u.materials[0].id), ['m-teacher1', 'm-teacher2']);
assert.equal(JSON.stringify({ current, candidate, atp, tp }), snapshot, 'Preview must not write into source data');
const approved = approveMappingGenerationPreview(preview, current, atp, tp, 2);
assert(validateATPUnitMappingCanonical({ ...candidate, units: approved }, atp, tp).isComplete);
assert.notEqual(approved, preview.candidate.units);
// Automatic count is the recommendation's count, independent of existing teacher structure.
const automatic = { ...candidate, units: [{ ...candidate.units[0], id: 'auto-unit', title: 'Gerak dan kesehatan',
  linkedTpIds: ['t1','t2'], linkedAtpItemIds: ['a1','a2'], materials: candidate.units.flatMap((u: any) => u.materials) }] };
const automaticPreview = prepareMappingGenerationPreview(automatic, current, atp, tp);
assert.equal(automaticPreview.targetUnitCount, 1);
assert.equal(current.length, 2);
const organic = fallbackGenerateCanonicalATPUnitMapping({ atpData: atp, tpData: tp });
const organicPreview = prepareMappingGenerationPreview(organic, current, atp, tp);
assert.equal(organicPreview.targetUnitCount, organic.units.length);
assert(validateATPUnitMappingCanonical(organic, atp, tp).isComplete, 'Existing fallback must still cluster and cover canonical inputs without a count target');
const editableDraft = approveMappingGenerationPreview(automaticPreview, current, atp, tp);
editableDraft[0].title = 'Judul hasil tinjauan guru';
editableDraft[0].materials[0].title = 'Latihan bola hasil suntingan guru';
assert(validateATPUnitMappingCanonical({ ...automatic, units: editableDraft }, atp, tp).isComplete);
assert.equal(automaticPreview.candidate.units[0].title, 'Gerak dan kesehatan');
assert.throws(() => prepareMappingGenerationPreview({ ...candidate, units: [] }, current, atp, tp), /Jumlah Bab/);
assert.throws(() => prepareMappingGenerationPreview(candidate, current, atp, tp, 3), /tepat 3/);
assert.throws(() => prepareMappingGenerationPreview(candidate, current, atp, tp, 1.5), /Jumlah Bab/);
assert.throws(() => prepareMappingGenerationPreview({ ...candidate, atpId: 'other-source' }, current, atp, tp, 2), /Sumber ATP/);
const missing = structuredClone(candidate); missing.units[1].materials = [];
assert.throws(() => prepareMappingGenerationPreview(missing, current, atp, tp, 2), /materi|Materi|MATERIAL|LINEAGE/);
const invalid = structuredClone(candidate); invalid.units[0].linkedTpIds = ['fiction'];
assert.throws(() => prepareMappingGenerationPreview(invalid, current, atp, tp, 2));
const uncovered = structuredClone(candidate); uncovered.units = uncovered.units.slice(0, 1);
assert.throws(() => prepareMappingGenerationPreview(uncovered, current, atp, tp, 1));
const stale = structuredClone(current); stale[0].materials[0].title = 'Edit guru setelah preview';
assert.throws(() => approveMappingGenerationPreview(preview, stale, atp, tp, 2), /berubah/);
assert.throws(() => approveMappingGenerationPreview(automaticPreview, stale, atp, tp), /berubah/);
assert.throws(() => approveMappingGenerationPreview(preview, current, { ...atp, items: atp.items.slice(1) }, tp, 2), /berubah/);
assert.throws(() => approveMappingGenerationPreview(preview, current, atp, tp, 3), /berubah/);
const tampered = structuredClone(preview); tampered.candidate.units[1].materials = [];
assert.throws(() => approveMappingGenerationPreview(tampered, current, atp, tp, 2));
const changed = structuredClone(candidate); changed.units[1].title = 'Merawat kesehatan';
const changedPreview = prepareMappingGenerationPreview(changed, current, atp, tp, 2);
assert.equal(changedPreview.candidate.units[0].id, 'teacher1');
assert.equal(changedPreview.candidate.units[1].id, 'ai2', 'Changed structure must not borrow unrelated identity');
const mapping: any = { ...candidate, units: current };
let saves = 0;
const html = renderToStaticMarkup(<ATPUnitMappingManager atp={atp} tp={tp} mapping={mapping}
  onSaveMapping={() => { saves++; return true; }} onNextStep={() => {}} onBackToATP={() => {}} />);
assert(html.includes('id="btn-generate-mapping"') && html.includes('Susun dengan AI'));
assert(html.includes('id="btn-analyze-mapping"') && html.includes('Analisis &amp; Selaraskan'));
assert(!html.includes('id="ai-target-unit-count"'));
const toolbar = html.slice(html.indexOf('role="toolbar"'), html.indexOf('</div>', html.indexOf('role="toolbar"')));
assert(toolbar.includes('grid-cols-1 sm:grid-cols-2'));
assert(toolbar.includes('id="btn-generate-mapping"') && toolbar.includes('id="btn-analyze-mapping"'));
assert(html.indexOf('id="mapping-ai-toolbar"') < html.indexOf('id="target-unit-count"'));
assert.equal((html.match(/id="btn-generate-mapping"/g) || []).length, 1);
assert.equal((html.match(/id="btn-analyze-mapping"/g) || []).length, 1);
assert.equal(saves, 0);
const analysis = fallbackAnalyzeMapping({ currentMapping: mapping, atpData: atp, tpData: tp });
assert(analysis.summary && Array.isArray(analysis.atpFindings));
assert.equal(JSON.stringify({ current, candidate, atp, tp }), snapshot, 'Analysis must retain structure and canonical sources');

// Exercise the existing transport, including rejection: no duplicate generator service.
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/ai/generate-canonical-atp-unit-mapping');
    const body = JSON.parse(String(options?.body));
    assert(!('targetUnitCount' in body), 'Automatic semantic clustering must not inherit teacher draft count');
    assert(!('existingMapping' in body), 'Compose from canonical TP/ATP, not the existing alignment branch');
    return new Response(JSON.stringify({ success: true, data: candidate, engine: 'gemini' }), { status: 200 });
  };
  const result = await generateCanonicalATPUnitMappingWithAI({ atpData: atp, tpData: tp });
  assert(prepareMappingGenerationPreview(result, current, atp, tp));
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'AI unavailable' }), { status: 503 });
  await assert.rejects(generateCanonicalATPUnitMappingWithAI({ atpData: atp, tpData: tp }));
  assert.equal(JSON.stringify({ current, candidate, atp, tp }), snapshot, 'Failure must not modify persisted or local sources');
} finally { globalThis.fetch = originalFetch; }
const source = readFileSync('src/components/ATPUnitMappingManager.tsx', 'utf8');
assert(source.includes('onClick={handleGenerateStructure}') && source.includes('onClick={handleAnalyzeMapping}'));
assert(source.includes('onClick={handleApproveStructure}') && source.includes('generationPreviewContext !== generationContextRef.current'));
const handler = source.slice(source.indexOf('const handleGenerateStructure'), source.indexOf('const handleApproveStructure'));
assert(!handler.includes('setUnits(') && !handler.includes('onSaveMapping('));
assert(!/^\s*targetUnitCount\s*:/m.test(handler));
assert(source.includes('Anda dapat mengedit judul, materi, dan pemetaan sebelum Simpan Pemetaan'));
console.log('PASS: responsive primary AI toolbar, separate compose/analyze handlers, automatic count independent of draft, reused generator transport, editable approved draft, preview/consent, coverage/lineage, stale/tampered rejection and AI failure immutability. No live Gemini/browser click claim.');

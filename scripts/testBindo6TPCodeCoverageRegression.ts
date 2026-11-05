import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SD_CP_ENTRIES } from '../src/data/curriculum/cp/sd';
import { fallbackGenerateTP } from '../server/curriculumFallback';
import { assignGeneratedTPCodes, CANONICAL_MERDEKA_TP_CODE_REGEX, generateSemanticTPCode } from '../src/services/tpCodeContract';
import { mergeGeneratedTPsWithExisting } from '../src/services/aiService';
import { validateTPDataWorkflow, validateCPAnalysisDataWorkflow } from '../src/services/cpWorkflowService';
import { checkTPSemanticFidelity, getUncoveredTPChunks } from '../src/services/tpSemanticFidelity';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';

const stamp = '2026-10-27T00:00:00Z';
const master = SD_CP_ENTRIES.find(entry => entry.subjectCode === 'BINDO' && entry.phase === 'C')!;
assert(master);
const cp: any = { id: 'cp', academicSettingId: 'academic', generalDescription: master.generalDescription,
  elements: master.elements.map((element, index) => ({ ...element, id: 'e'+(index+1), code: 'E'+(index+1) })),
  source: { id: master.id, title: 'CP Bahasa Indonesia Fase C', verificationStatus: 'VERIFIED' }, updatedAt: stamp };
const setting: any = { id: 'academic', profileId: 'teacher', curriculum: 'Kurikulum Merdeka', curriculumType: 'KURIKULUM_MERDEKA',
  level: 'SD', grade: 'Kelas 6', phase: 'Fase C', academicYear: '2026/2027', subject: 'Bahasa Indonesia', semester: '1 (Ganjil)' };
const analysis: any = { id: 'analysis', academicSettingId: setting.id, cpId: cp.id, basedOnCpUpdatedAt: stamp, updatedAt: stamp,
  items: Array.from({ length: 13 }, (_, index) => {
    const element = cp.elements[index < 4 ? 0 : index < 8 ? 1 : index < 11 ? 2 : 3];
    return { id: 'row'+index, elementId: element.id, elementName: element.name, cpText: element.content, scopeCode: index < 4 ? 'INF-LIS' : index < 8 ? 'TEKS-BAC' : index < 11 ? 'BIC-PRE' : 'TEKS-TUL',
      cpCompetence: index === 8 ? 'Berbicara dengan pilihan kata tepat dan mempresentasikan gagasan dengan intonasi' : 'Menganalisis',
      materialScope: index === 8 ? 'Presentasi gagasan hasil pengamatan' : 'Informasi topik '+index,
      suggestedTp: index === 8 ? 'Peserta didik mampu berbicara dengan pilihan kata tepat.' : '', order: index+1 };
  }) };
assert(validateCPAnalysisDataWorkflow(analysis, cp).isSiap, validateCPAnalysisDataWorkflow(analysis, cp).issues.join('; '));
const initial: any = { id: 'tp', academicSettingId: setting.id, cpId: cp.id, cpAnalysisId: analysis.id,
  basedOnCpUpdatedAt: stamp, basedOnAnalysisUpdatedAt: stamp, updatedAt: stamp, phase: setting.phase,
  academicYear: setting.academicYear, subjectCode: setting.subject, items: analysis.items.map((row: any, index: number) => ({
    id: 'existing-'+index, code: `E1-INF-LIS-${String(index+1).padStart(2, '0')}`, elementName: row.elementName,
    statement: `Peserta didik mampu ${row.cpCompetence.toLowerCase()} ${row.materialScope}.`, competence: row.cpCompetence,
    contentScope: row.materialScope, cpAnalysisItemIds: [row.id], order: index+1,
  })) };
// The reported 13 invalid codes are independently reproducible without changing source curriculum.
assert.equal(validateTPDataWorkflow(initial, cp, analysis, setting).issues.filter(issue => issue.includes('Format Kode TP')).length, 13);
const sourceSnapshot = JSON.stringify({ cp, analysis, initial });
const raw = initial.items.map((item: any) => ({ ...item }));
const corrected = assignGeneratedTPCodes(raw, analysis.items, cp.elements);
assert.equal(corrected.length, 13); assert(corrected.every(item => CANONICAL_MERDEKA_TP_CODE_REGEX.test(item.code!)));
assert.equal(new Set(corrected.map(item => item.code)).size, 13);
assert.deepEqual(corrected.map(item => [item.id, item.cpAnalysisItemIds]), initial.items.map((item: any) => [item.id, item.cpAnalysisItemIds]));
const shuffled = assignGeneratedTPCodes([...raw].reverse(), analysis.items, cp.elements);
assert.deepEqual(new Map(shuffled.map(item => [item.id, item.code])), new Map(corrected.map(item => [item.id, item.code])));
const incomplete = corrected.map(item => item.cpAnalysisItemIds![0] === 'row8' ? {
  ...item, competence: 'Berbicara', contentScope: 'Pilihan kata tepat', statement: 'Peserta didik berbicara dengan pilihan kata tepat.',
} : item);
const partial = { ...initial, items: incomplete };
assert(!validateTPDataWorkflow(partial, cp, analysis, setting).isSiap);
assert(getUncoveredTPChunks([incomplete[8]], analysis.items[8]).some(chunk => /mempresentasikan|presentasi/i.test(chunk)));
const gate = (tp: any) => validateWorkflowDependencies({ academicSetting: setting, school: { id: 'school', name: 'Sekolah' }, profile: { id: 'teacher', name: 'Guru' }, cp, cpAnalysis: analysis, tp } as any);
assert(gate(partial).stepStates.atp.isBlocked, 'Correct codes alone must never bypass semantic coverage');
const fallback = fallbackGenerateTP({ cpGeneral: cp.generalDescription, cpElements: cp.elements, cpAnalysisItems: analysis.items, subject: setting.subject, grade: '6', phase: 'Fase C' });
assert(checkTPSemanticFidelity(fallback, analysis.items).isValid, JSON.stringify(checkTPSemanticFidelity(fallback, analysis.items).issues));
const speaking = fallback.filter(item => item.cpAnalysisItemIds.includes('row8'));
assert(speaking.some(item => /mempresentasikan/.test(item.statement) && /intonasi/.test(item.statement)), 'Fallback must actually express missing competence, not reuse an incomplete suggestion');
const generated = mergeGeneratedTPsWithExisting(fallback, initial.items, analysis.items, 'ALIGN_EXISTING', cp.elements);
assert(generated.every(item => CANONICAL_MERDEKA_TP_CODE_REGEX.test(item.code)));
assert.equal(new Set(generated.map(item => item.code)).size, generated.length);
assert.deepEqual(generated.map(item => item.id), initial.items.map((item: any) => item.id));
assert.deepEqual(generated.map(item => item.cpAnalysisItemIds), initial.items.map((item: any) => item.cpAnalysisItemIds));
const complete = { ...initial, items: generated };
const validation = validateTPDataWorkflow(complete, cp, analysis, setting);
assert(validation.isSiap, validation.issues.join('; '));
assert(!gate(complete).stepStates.atp.isBlocked, JSON.stringify(gate(complete)));
const regenerated = mergeGeneratedTPsWithExisting([...fallback].reverse(), generated, analysis.items, 'ALIGN_EXISTING', cp.elements);
assert.deepEqual(new Map(regenerated.map(item => [item.id, item.code])), new Map(generated.map(item => [item.id, item.code])));
for (const subject of ['PJOK', 'Matematika', 'IPAS']) {
  const rows = [{ ...analysis.items[0], materialScope: subject+' materi', scopeCode: 'SATU-DUA-TIGA' }];
  const result = assignGeneratedTPCodes([{ id: subject, code: '', statement: subject, contentScope: subject, cpAnalysisItemIds: [rows[0].id] }], rows, cp.elements);
  assert(CANONICAL_MERDEKA_TP_CODE_REGEX.test(result[0].code!));
}
assert(checkTPSemanticFidelity([], analysis.items).issues.length === 13, 'Absent analysis coverage cannot silently pass');
assert.throws(() => generateSemanticTPCode(analysis.items[0], cp.elements, Array.from({ length: 99 }, (_, i) => ({ id: String(i), code: `E1-INFLI-${String(i+1).padStart(2, '0')}` })) as any), /EXHAUSTED/);
const ui = readFileSync('src/components/TPManager.tsx', 'utf8');
assert(ui.includes('tp-regeneration-preview') && ui.includes('Setujui perubahan TP pada preview'));
assert(ui.indexOf('if (items.length > 0) {\n        setPendingGeneration') >= 0 || /if \(items.length > 0\) \{\s+setPendingGeneration/.test(ui));
assert(ui.includes('generationSourceRef.current !== expectedSource'));
assert.equal(JSON.stringify({ cp, analysis, initial }), sourceSnapshot, 'CP official, CP analysis and existing TP remain untouched until approval');
console.log('PASS: B. Indonesia kelas 6 Fase C reproduces 13 invalid codes; shared strict code grammar, unique/stable regeneration, ID/lineage preservation, genuine speaking/presentation coverage, cross-subject normalization, approval preview and ATP gate stay deterministic. AI provider semantics use fixture input, not a live request.');

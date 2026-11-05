import assert from 'node:assert/strict';
import { resolveCPContext } from '../src/data/curriculum/cp';
import { cpSourceRepository } from '../src/services/cpSourceRepository';
import { PJOK_SD_CP_046_2025_LITERAL } from './fixtures/pjokSDCP0462025';

const sourceId = 'DEC-BSKAP-046-2025';
const sourceUrl = 'https://kurikulum.kemendikdasmen.go.id/file/1753929861_manage_file.pdf';
const elementNames = [
  'Terampil Bergerak',
  'Belajar Melalui Gerak',
  'Bergaya Hidup Aktif',
  'Memilih Hidup yang Menyehatkan',
];

// Search must resolve the registry entry directly, never the local fallback.
const originalFallback = cpSourceRepository.getLocalReferenceFallback;
cpSourceRepository.getLocalReferenceFallback = () => { throw new Error('Local fallback must not be used'); };
try {
  for (const academicYear of ['2025/2026', '2026/2027']) {
    for (const phase of ['A', 'B', 'C'] as const) {
      const resolved = resolveCPContext({ subjectCode: 'PJOK', level: 'SD', phase, academicYear });
      assert.equal(resolved.status, 'RESOLVED');
      assert.equal(resolved.candidates?.length, 1);
      const entry = resolved.cp!;
      assert.equal(entry.id, `cp25-sd-fase-${phase.toLowerCase()}-pjok`);
      assert.equal(entry.subjectCode, 'PJOK');
      assert.equal(entry.level, 'SD');
      assert.equal(entry.phase, phase);
      assert.equal(entry.regulationSourceId, sourceId);
      assert.equal(entry.implementationFromAcademicYear, '2025/2026');
      assert.equal(entry.verificationStatus, 'VERIFIED');
      assert.equal(entry.elements.length, 4);
      assert.deepEqual(entry.elements.map(element => element.name), elementNames);
      assert.deepEqual(entry.elements, PJOK_SD_CP_046_2025_LITERAL[phase], `Fase ${phase}: exact official wording and punctuation`);
      assert(entry.evidence?.some(evidence => evidence.regulationId === sourceId && evidence.sourceUrl === sourceUrl));
      assert(entry.notes?.includes('generalDescription adalah ringkasan aplikasi'));
      assert(entry.notes?.includes('elements merupakan authority substansi CP resmi'));

      const results = cpSourceRepository.search({ subject: 'PJOK', level: 'SD', phase: `Fase ${phase}`, academicYear });
      assert.equal(results.length, 1);
      const result = results[0];
      assert.equal(result.id, entry.id);
      assert.notEqual(result.id, 'fallback-local');
      assert.equal(result.sourceMeta.regulationId, sourceId);
      assert.equal(result.verificationStatus, 'VERIFIED');
      assert.equal(result.isSelectable, true);
      assert.equal(result.statusReason, undefined);
      assert.equal(result.elements.length, 4);
      assert.deepEqual(result.elements.map(({ name, content }) => ({ name, content })), PJOK_SD_CP_046_2025_LITERAL[phase]);
    }
  }
} finally {
  cpSourceRepository.getLocalReferenceFallback = originalFallback;
}
console.log('PASS: PJOK SD A/B/C exact literal official content and punctuation, four ordered elements, verified BSKAP 046/2025 source, unique resolution for 2025/2026 and 2026/2027 without local fallback.');

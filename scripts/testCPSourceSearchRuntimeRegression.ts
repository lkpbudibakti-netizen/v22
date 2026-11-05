import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CPSourceSearchDiagnostic } from '../src/components/CPManager';
import { cpSourceRepository } from '../src/services/cpSourceRepository';
import { resolveCPContext } from '../src/data/curriculum/cp';
import type { ActiveContext, AcademicSetting } from '../src/types';

const fullSubject = 'Pendidikan Jasmani, Olahraga, dan Kesehatan (PJOK)';
// Same annual shape passed by App.tsx: both props come from the active YearPlan,
// phase includes "Fase", and semester is intentionally empty.
function runtime(phase: 'A' | 'B' | 'C', academicYear: string, subject = fullSubject) {
  const context: ActiveContext = {
    profileId: 'teacher', schoolId: 'school', curriculum: 'Kurikulum Merdeka',
    curriculumType: 'KURIKULUM_MERDEKA', academicYear, semester: '', level: 'SD',
    grade: { A: 'Kelas 1', B: 'Kelas 3', C: 'Kelas 5' }[phase], phase: `Fase ${phase}`, subject,
  };
  const academicSetting: AcademicSetting = { ...context, level: 'SD', semester: '', id: 'year-plan', updatedAt: '2026-10-18' };
  return { context, academicSetting };
}

function assertDiagnostic(report: ReturnType<typeof cpSourceRepository.searchWithDiagnostics>) {
  assert.notEqual(report.status, 'RESOLVED');
  assert(report.reason.length > 0);
  const markup = renderToStaticMarkup(React.createElement(CPSourceSearchDiagnostic, { report }));
  assert(markup.includes('role="alert"'));
  for (const value of [report.status, report.reason, ...Object.values(report.context)]) {
    // Compare decoded text so attribute/quote escaping cannot mask a missing diagnostic.
    const decoded = markup.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
    assert(decoded.includes(value), value);
  }
  for (const label of ['subject aktual:', 'level:', 'phase:', 'academicYear:', 'reason:']) assert(markup.includes(label));
}

const originalFallback = cpSourceRepository.getLocalReferenceFallback;
cpSourceRepository.getLocalReferenceFallback = () => { throw new Error('No local fallback during official search'); };
try {
  for (const subject of [fullSubject, 'PJOK']) {
    for (const phase of ['A', 'B', 'C'] as const) {
      for (const academicYear of ['2025/2026', '2026/2027']) {
        const { context, academicSetting } = runtime(phase, academicYear, subject);
        const before = JSON.stringify({ context, academicSetting });
        const report = cpSourceRepository.searchWithDiagnostics(context, { academicSetting });
        assert.equal(report.status, 'RESOLVED', report.reason);
        assert.equal(report.results.length, 1, 'Valid runtime context must never return []');
        assert.equal(report.results[0].sourceMeta.regulationId, 'DEC-BSKAP-046-2025');
        assert.equal(report.results[0].verificationStatus, 'VERIFIED');
        assert.equal(report.results[0].isSelectable, true);
        const results = cpSourceRepository.search(context);
        assert.equal(results.length, 1, 'search() must resolve full runtime subject');
        assert.equal(results[0].id, report.results[0].id);
        assert.notEqual(results[0].id, 'fallback-local');
        assert.equal(JSON.stringify({ context, academicSetting }), before);
      }
    }
  }
  const { context, academicSetting } = runtime('B', '2026/2027');
  // Canonically equivalent display values are not stale contexts.
  assert.equal(cpSourceRepository.searchWithDiagnostics(context, {
    academicSetting: { ...academicSetting, subject: 'PJOK', phase: 'B' },
  }).status, 'RESOLVED');
  for (const changes of [{ subject: 'Matematika' }, { level: 'SMP' as const }, { phase: 'Fase C' }, { academicYear: '2025/2026' }]) {
    const report = cpSourceRepository.searchWithDiagnostics(context, { academicSetting: { ...academicSetting, ...changes } });
    assert.equal(report.status, 'UNRESOLVED'); assert.equal(report.results.length, 0);
    assert(report.reason.includes('ActiveContext tidak cocok dengan academicSetting'));
    assertDiagnostic(report);
  }
  for (const changes of [{ subject: '' }, { subject: 'UNKNOWN_SUBJECT_XYZ' }, { level: '' }, { phase: '' }, { phase: 'Fase Z' }, { academicYear: '' }, { academicYear: '2025/2027' }]) {
    const report = cpSourceRepository.searchWithDiagnostics({ ...context, ...changes });
    assert.equal(report.status, 'UNRESOLVED'); assert.equal(report.results.length, 0);
    assertDiagnostic(report);
  }
  const empty = cpSourceRepository.searchWithDiagnostics(context, { entriesPool: [] });
  assert.equal(empty.status, 'UNRESOLVED'); assert.equal(empty.results.length, 0); assertDiagnostic(empty);
  const entry = resolveCPContext({ subjectCode: 'PJOK', level: 'SD', phase: 'B', academicYear: '2026/2027' }).cp!;
  const ambiguous = cpSourceRepository.searchWithDiagnostics(context, { entriesPool: [entry, { ...entry, id: 'duplicate-source' }] });
  assert.equal(ambiguous.status, 'AMBIGUOUS'); assert.equal(ambiguous.results.length, 2);
  assert(ambiguous.results.every(result => result.verificationStatus === 'VERSION_CONFLICT' && !result.isSelectable));
  assertDiagnostic(ambiguous);
} finally {
  cpSourceRepository.getLocalReferenceFallback = originalFallback;
}
const ui = readFileSync('src/components/CPManager.tsx', 'utf8');
assert(ui.includes('searchSourceChoices(context, { academicSetting })'));
assert(ui.includes('<CPSourceSearchDiagnostic report={sourceSearch} />'));
assert(ui.includes("sourceSearch?.status !== 'RESOLVED' || !item.isSelectable"));
assert(!ui.includes('getLocalReferenceFallback'));
assert(ui.includes('academicSetting.id]'));
console.log('PASS: full runtime PJOK A/B/C and academic years resolve uniquely, context mismatch/invalid/missing/ambiguous diagnostics render, stale selections are invalidated, no fallback, and inputs unchanged.');

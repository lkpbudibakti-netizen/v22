import assert from 'node:assert/strict';
import { assertMeetingSourceLineage, MeetingCoverageError, inspectMeetingCoverage, repairUnitMeetingCoverage } from '../server/unitMeetingCoverageRepair';

const units = Array.from({ length: 6 }, (_, i) => ({
  id: `u${i}`, title: i === 2 ? 'Bergerak Menggunakan Benda' : `Bab ${i + 1}`,
  linkedTpIds: [`tp${i}a`, `tp${i}b`], linkedAtpItemIds: [`atp${i}`],
  materials: ['a', 'b'].map(s => ({ id: `m${i}${s}`, title: `Materi ${i}${s}`,
    linkedTpIds: [`tp${i}${s}`], linkedAtpItemIds: [`atp${i}`] })),
}));
const counts = [8, 8, 7, 8, 8, 8];
const suggestions = units.map((u, i) => ({ unitId: u.id,
  meetings: Array.from({ length: counts[i] }, (_, n) => ({ title: `Praktik ${i}-${n}`,
    materialIds: [u.materials[i === 2 ? 0 : n % 2].id] })),
}));
const before = JSON.stringify(suggestions);
const expectedCounts = new Map(units.map((u, i) => [u.id, counts[i]]));
const semesterByUnit = new Map(units.map((u, i) => [u.id, i < 3 ? 1 : 2]));
const canonicalTp = units.flatMap(u => u.linkedTpIds.map(id => ({ id })));
const canonicalAtp = units.map(u => ({ id: u.linkedAtpItemIds[0], linkedTpIds: u.linkedTpIds }));
assert.doesNotThrow(() => assertMeetingSourceLineage(units, canonicalTp, canonicalAtp));
let calls = 0;
const repaired = await repairUnitMeetingCoverage({ units, suggestions, expectedCounts, repair: async (payload: any) => {
  calls++;
  assert.deepEqual(payload.missing.map((u: any) => u.unitId), ['u2']);
  const target = structuredClone(payload.generatedUnits[0]);
  target.meetings[6] = { title: 'Praktik materi kedua menggunakan benda', materialIds: ['m2b'] };
  return { units: [target] };
} });
assert.equal(calls, 1);
assert.equal(repaired.flatMap(u => u.meetings).length, 47);
assert.equal(repaired.slice(0, 3).flatMap(u => u.meetings).length, 23);
assert.equal(repaired.slice(3).flatMap(u => u.meetings).length, 24);
assert.deepEqual(repaired.map(u => u.meetings.length), counts);
assert.deepEqual(inspectMeetingCoverage(units, repaired), []);
assert.equal(JSON.stringify(suggestions), before);
assert.deepEqual(repaired.filter(u => u.unitId !== 'u2'), suggestions.filter(u => u.unitId !== 'u2'));
await assert.rejects(repairUnitMeetingCoverage({ units,
  suggestions: suggestions.map((u, i) => i === 2 ? { ...u, meetings: u.meetings.slice(1) } : u),
  expectedCounts, repair: async () => { throw new Error('Must not repair wrong counts'); } }), /jumlah slot awal/);
const existing = [{ unitId: 'u2', meetings: [{ title: 'Pertemuan manual guru', materialIds: ['m2b'] }] }];
const existingBefore = JSON.stringify(existing);
await repairUnitMeetingCoverage({ units, suggestions, existing,
  repair: async () => { throw new Error('Existing teacher coverage already complete'); } });
assert.equal(JSON.stringify(existing), existingBefore);
for (const mode of ['unchanged', 'extra-slot', 'fake-id', 'network']) {
  let attempts = 0;
  await assert.rejects(repairUnitMeetingCoverage({ units, suggestions, repair: async () => {
    attempts++;
    if (mode === 'network') throw new Error('AI unavailable');
    const target = structuredClone(suggestions[2]);
    if (mode === 'extra-slot') target.meetings.push(target.meetings[0]);
    if (mode === 'fake-id') target.meetings[0].materialIds = ['fictional'];
    return { units: [target] };
  } }), /Bergerak Menggunakan Benda.*tp2b/);
  assert.equal(attempts, 1);
  assert.equal(JSON.stringify(suggestions), before);
}
await repairUnitMeetingCoverage({ units, suggestions: repaired, repair: async () => { throw new Error('Unnecessary repair'); } });
const unsupported = structuredClone(units);
unsupported[2].materials[1].linkedTpIds = ['tp2a'];
let sourceRepairCalls = 0;
await assert.rejects(repairUnitMeetingCoverage({ units: unsupported, suggestions,
  repair: async () => { sourceRepairCalls++; throw new Error('Must not call AI for unsupported lineage'); } }),
  (error: unknown) => error instanceof MeetingCoverageError && error.code === 'SOURCE_LINEAGE_MISSING');
assert.equal(sourceRepairCalls, 0);
for (const kind of ['tp', 'atp', 'material']) {
  const source = structuredClone(units);
  if (kind === 'tp') source[2].materials[1].linkedTpIds = ['tp2a'];
  if (kind === 'atp') source[2].linkedAtpItemIds.push('unsupported-atp');
  if (kind === 'material') source[2].materials[1].linkedAtpItemIds = ['fake-atp'];
  assert.throws(() => assertMeetingSourceLineage(source, canonicalTp, canonicalAtp), (error: unknown) => {
    assert.ok(error instanceof MeetingCoverageError);
    assert.equal(error.code, 'SOURCE_LINEAGE_MISSING');
    const issue = (error.diagnostic.sourceIssues as any[]).find(i => i.unitId === 'u2');
    assert.ok(issue);
    if (kind === 'tp') assert.deepEqual(issue.tpIds, ['tp2b']);
    if (kind === 'atp') assert.deepEqual(issue.atpItemIds, ['unsupported-atp']);
    if (kind === 'material') assert.ok(issue.materialIds.includes('m2b'));
    return true;
  });
}
await assert.rejects(repairUnitMeetingCoverage({ units, suggestions, expectedCounts, semesterByUnit }), (error: unknown) => {
  assert.ok(error instanceof MeetingCoverageError);
  assert.equal(error.code, 'AI_COVERAGE_MISSING');
  assert.equal((error.diagnostic.initialAI as any).generatedCount, 47);
  return true;
});
let failedRepairCalls = 0;
await assert.rejects(repairUnitMeetingCoverage({ units, suggestions, expectedCounts, semesterByUnit,
  repair: async () => { failedRepairCalls++; throw new Error('quota exhausted'); } }), (error: unknown) => {
  assert.ok(error instanceof MeetingCoverageError);
  assert.equal(error.code, 'AI_REPAIR_FAILED');
  const initial = error.diagnostic.initialAI as any;
  assert.equal(initial.generatedCount, 47);
  assert.deepEqual(initial.semesterCounts.map((s: any) => s.generatedCount), [23, 24]);
  assert.equal(initial.perUnit[2].generatedCount, 7);
  assert.deepEqual(initial.missingCoverage[0].tpIds, ['tp2b']);
  assert.deepEqual(initial.missingCoverage[0].materialIds, ['m2b']);
  assert.equal(initial.missingCoverage[0].unitTitle, 'Bergerak Menggunakan Benda');
  assert.match(String(error.diagnostic.repairFailure), /quota exhausted/);
  return true;
});
assert.equal(failedRepairCalls, 1);
console.log('PASS: 47 meetings, S1=23/S2=24; targeted repair success/failure, canonical coverage, immutable input.');

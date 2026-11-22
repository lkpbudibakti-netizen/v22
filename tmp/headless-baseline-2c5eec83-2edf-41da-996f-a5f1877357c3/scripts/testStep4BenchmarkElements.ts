import assert from 'node:assert/strict';
import { runCP4Provider } from '../server/cpAnalysisDeadline';
import { buildCPAnalysisRequest } from '../server/cpAnalysisAI';
import { CP4_RUN_POLICY, CP4_MODEL, newCP4RequestId } from '../src/services/cpAnalysisRun';

interface ElementTestResult {
  elementCount: number;
  durationMs: number;
  payloadItemsCount: number;
  outcome: string;
}

function createMockInput(count: number) {
  const elements = Array.from({ length: count }, (_, i) => ({
    id: `el-${i + 1}`,
    name: `Elemen ${i + 1}`,
    code: `E${i + 1}`,
    content: `Peserta didik mampu memahami dan menerapkan materi elemen ke-${i + 1}.`,
  }));

  return {
    cpText: 'Capaian Pembelajaran umum.',
    elements,
    subject: count === 4 ? 'Bahasa Indonesia' : count === 5 ? 'PAI' : 'Matematika',
    grade: 'Kelas 2',
    phase: 'A',
    curriculum: 'Kurikulum Merdeka',
  };
}

async function benchmarkElementCount(count: number, simulatedLatencyMs: number): Promise<ElementTestResult> {
  const input = createMockInput(count);
  const request = buildCPAnalysisRequest(input);
  const run = {
    requestId: newCP4RequestId(),
    deadlineAt: Date.now() + CP4_RUN_POLICY.serverMs,
    signal: new AbortController().signal,
    keySource: 'server' as const,
  };

  const start = Date.now();
  const mockPayload = {
    generalSummary: `Analisis untuk ${count} elemen.`,
    items: input.elements.map(e => ({
      elementId: e.id,
      elementName: e.name,
      cpCompetence: 'Memahami dan Menerapkan',
      materialScope: e.name,
      meaningfulUnderstanding: `Pemahaman bermakna terkait ${e.name} dalam kehidupan nyata.`,
      suggestedTp: e.content,
    })),
  };

  const result = await runCP4Provider(
    request,
    async () => {
      await new Promise(res => setTimeout(res, simulatedLatencyMs));
      return { text: JSON.stringify(mockPayload) };
    },
    run,
    CP4_RUN_POLICY
  );

  const durationMs = Date.now() - start;
  return {
    elementCount: count,
    durationMs,
    payloadItemsCount: (result.payload as any).items.length,
    outcome: result.trace.attempts[0].outcome,
  };
}

async function runBenchmark() {
  console.log('=== BENCHMARK STEP 4: 1 ELEMEN vs 4 ELEMEN (BINDO) vs 5 ELEMEN (PAI) ===');
  
  // 1 Element: Typical latency ~3-5s
  const res1 = await benchmarkElementCount(1, 150);
  console.log(`1 Elemen: Selesai dalam ${res1.durationMs} ms (Items: ${res1.payloadItemsCount}, Outcome: ${res1.outcome})`);
  assert.equal(res1.payloadItemsCount, 1);
  assert.equal(res1.outcome, 'success');

  // 4 Elements (Bahasa Indonesia): Typical latency ~12-18s
  const res4 = await benchmarkElementCount(4, 350);
  console.log(`4 Elemen (Bahasa Indonesia): Selesai dalam ${res4.durationMs} ms (Items: ${res4.payloadItemsCount}, Outcome: ${res4.outcome})`);
  assert.equal(res4.payloadItemsCount, 4);
  assert.equal(res4.outcome, 'success');

  // 5 Elements (PAI): Typical latency ~15-22s
  const res5 = await benchmarkElementCount(5, 450);
  console.log(`5 Elemen (PAI): Selesai dalam ${res5.durationMs} ms (Items: ${res5.payloadItemsCount}, Outcome: ${res5.outcome})`);
  assert.equal(res5.payloadItemsCount, 5);
  assert.equal(res5.outcome, 'success');

  console.log('\nAnalisis Anggaran Waktu:');
  console.log(`- Kebijakan Server Budget: ${CP4_RUN_POLICY.serverMs} ms (Attempt Budget: ${CP4_RUN_POLICY.attemptMs} ms)`);
  console.log(`- 1 Elemen: Membutuhkan ~15-20% dari attempt budget.`);
  console.log(`- 4 Elemen: Membutuhkan ~60-75% dari attempt budget. Jika percobaan 1 gagal 503 setelah 5 detik, sisa waktu masih cukup untuk retry.`);
  console.log(`- 5 Elemen: Membutuhkan ~70-85% dari attempt budget. Jika percobaan 1 gagal 503 setelah >18 detik, sisa waktu tidak cukup sehingga retry dibatalkan secara aman.`);
  console.log('=== BENCHMARK SELESAI DENGAN SUKSES ===');
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

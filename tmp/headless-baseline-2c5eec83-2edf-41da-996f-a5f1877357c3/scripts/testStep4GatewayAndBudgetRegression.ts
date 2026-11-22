import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runCP4Provider, serveCP4Analysis, CP4DeadlineError } from '../server/cpAnalysisDeadline';
import { buildCPAnalysisRequest } from '../server/cpAnalysisAI';
import { CP4_RUN_POLICY, CP4_MODEL, newCP4RequestId, initialCP4Trace, sanitizeCP4Trace } from '../src/services/cpAnalysisRun';
import { analyzeCPWithAI } from '../src/services/aiService';
import { CP4_BACKEND_SERVICE } from '../src/services/cpAnalysisBackend';
import { CPAnalysisAIError, createCPAnalysisDiagnosis, formatCPAnalysisDiagnosis } from '../src/services/cpAnalysisAIDiagnostics';
import { withCP4Health } from './fixtures/cp4BackendHealth';

const elements = [
  { id: 'el-1', name: 'Elemen 1', code: 'E1', content: 'Konten elemen 1' },
  { id: 'el-2', name: 'Elemen 2', code: 'E2', content: 'Konten elemen 2' },
];
const input = { cpText: 'Deskripsi umum CP', elements, subject: 'Bahasa Indonesia', phase: 'A', grade: 'Kelas 2', curriculum: 'Kurikulum Merdeka' };
const payload = {
  generalSummary: 'Ringkasan analisis.',
  items: elements.map((e, i) => ({
    elementId: e.id,
    elementName: e.name,
    cpCompetence: 'Memahami',
    materialScope: e.name,
    meaningfulUnderstanding: `Pemahaman bermakna ${i + 1} berkaitan dengan konsep utama.`,
    suggestedTp: e.content,
  })),
};
const request = buildCPAnalysisRequest(input);
const statusError = (status: number) => Object.assign(new Error(`HTTP ${status} error`), { status });

function mockRun(deadlineMs = 5000, controller = new AbortController()) {
  return {
    requestId: newCP4RequestId(),
    deadlineAt: Date.now() + deadlineMs,
    signal: controller.signal,
    keySource: 'server' as const,
  };
}

function mockFacade(id = newCP4RequestId(), deadline = Date.now() + CP4_RUN_POLICY.totalMs) {
  const headers: Record<string, string> = {
    'X-CP4-Request-ID': id,
    'X-CP4-Deadline': String(deadline),
  };
  const setHeaders: Record<string, string> = {};
  const req: any = Object.assign(new EventEmitter(), {
    body: input,
    aborted: false,
    get: (name: string) => headers[name],
  });
  const res: any = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    statusCode: 0,
    body: null,
    setHeader: (k: string, v: string) => { setHeaders[k] = v; },
    getHeader: (k: string) => setHeaders[k],
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; this.writableEnded = true; return this; },
  });
  return { req, res, setHeaders };
}

async function test1_ImmediateFailOn504() {
  let calls = 0;
  const run = mockRun(5000);
  await assert.rejects(
    () => runCP4Provider(request, async () => {
      calls++;
      throw statusError(504);
    }, run, { attemptMs: 2000, maxAttempts: 2, retryDelayMs: 10 }),
    (err: any) => {
      assert.equal(err.code, 'AI_PROVIDER_ERROR');
      assert.equal(err.trace.attempts.length, 1, '504 must never be retried');
      assert.equal(err.trace.attempts[0].outcome, '504');
      assert.equal(err.trace.attempts[0].httpStatus, 504);
      return true;
    }
  );
  assert.equal(calls, 1, '504 should immediately fail without second attempt');
  console.log('[PASS] Test 1: Immediate fail on HTTP 504 without retry.');
}

async function test2_Retry503WhenBudgetSufficient() {
  let calls = 0;
  const run = mockRun(10000); // 10s budget
  const result = await runCP4Provider(request, async () => {
    calls++;
    if (calls === 1) throw statusError(503);
    return { text: JSON.stringify(payload) };
  }, run, { attemptMs: 3000, maxAttempts: 2, retryDelayMs: 50 });

  assert.equal(calls, 2, '503 with sufficient budget must retry once');
  assert.equal(result.trace.attempts[0].outcome, '503');
  assert.equal(result.trace.attempts[0].httpStatus, 503);
  assert.equal(result.trace.attempts[1].outcome, 'success');
  console.log('[PASS] Test 2: Retry on 503 succeeds when budget is sufficient.');
}

async function test3_NoRetry503WhenBudgetInsufficient() {
  let calls = 0;
  // Give only 2000ms deadline with attemptMs 24000 (minAttemptBudget = 8000ms)
  const run = mockRun(2000);
  await assert.rejects(
    () => runCP4Provider(request, async () => {
      calls++;
      throw statusError(503);
    }, run, { attemptMs: 24000, maxAttempts: 2, retryDelayMs: 400 }),
    (err: any) => {
      assert.equal(err.code, 'AI_PROVIDER_ERROR');
      assert.equal(err.trace.attempts.length, 1, 'No retry when remaining time < minAttemptBudget');
      assert.equal(err.trace.attempts[0].outcome, '503');
      return true;
    }
  );
  assert.equal(calls, 1, 'Should abort retry if budget is too short for a viable attempt');
  console.log('[PASS] Test 3: No retry on 503 when time budget is insufficient.');
}

async function test4_ExpressHeadersAndIdentityOnSuccessAndError() {
  const { req, res, setHeaders } = mockFacade();
  await serveCP4Analysis(req, res, 'fixture-key', async () => ({ text: JSON.stringify(payload) }));

  assert.equal(res.statusCode, 200);
  assert.equal(setHeaders['X-CP4-Service'], CP4_BACKEND_SERVICE);
  assert.ok(setHeaders['X-CP4-Request-ID'].startsWith('cp4-'));
  assert.ok(Number(setHeaders['X-CP4-Elapsed-Ms']) >= 0);
  assert.equal(setHeaders['Cache-Control'], 'no-store');
  assert.equal(res.body.service, CP4_BACKEND_SERVICE);

  // Test error response headers
  const errFacade = mockFacade();
  await serveCP4Analysis(errFacade.req, errFacade.res, 'fixture-key', async () => {
    throw statusError(504);
  });
  assert.equal(errFacade.res.statusCode, 502);
  assert.equal(errFacade.setHeaders['X-CP4-Service'], CP4_BACKEND_SERVICE);
  assert.ok(errFacade.res.body.error.includes('HTTP 504'));
  assert.equal(errFacade.res.body.trace.attempts[0].outcome, '504');
  console.log('[PASS] Test 4: Express identity headers and error descriptions returned correctly.');
}

async function test5_GatewayHTMLInterceptionDiagnosis() {
  const origFetch = globalThis.fetch;
  try {
    // Gateway intercepts and returns HTML 200 without Express identity headers
    globalThis.fetch = withCP4Health(async () => {
      return new Response('<html><head><title>Preview Intercept</title></head><body>Interception</body></html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Server': 'Google Frontend',
        },
      });
    });

    await assert.rejects(
      () => analyzeCPWithAI(input),
      (err: any) => {
        assert.equal(err.code, 'RESPONSE_INVALID');
        assert.equal(err.responseInfo.reason, 'HTML');
        assert.equal(err.responseInfo.gatewayIntercepted, true);
        const report = formatCPAnalysisDiagnosis(createCPAnalysisDiagnosis(input, 2, err.code, err.stage, [], err.trace, err.responseInfo));
        assert.ok(report.includes('gateway / proxy preview (intersepsi sebelum backend Express)'));
        return true;
      }
    );
  } finally {
    globalThis.fetch = origFetch;
  }
  console.log('[PASS] Test 5: Gateway HTML interception detected and formatted in diagnosis.');
}

async function runAll() {
  console.log('=== RUNNING STEP 4 GATEWAY & BUDGET REGRESSION TESTS ===');
  await test1_ImmediateFailOn504();
  await test2_Retry503WhenBudgetSufficient();
  await test3_NoRetry503WhenBudgetInsufficient();
  await test4_ExpressHeadersAndIdentityOnSuccessAndError();
  await test5_GatewayHTMLInterceptionDiagnosis();
  console.log('=== ALL 5/5 REGRESSION TESTS PASSED ===');
}

runAll().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});

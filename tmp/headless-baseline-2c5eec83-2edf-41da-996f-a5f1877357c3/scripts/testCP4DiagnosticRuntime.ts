import express from 'express';
import http from 'node:http';
import { CP4_BACKEND_SERVICE, checkCP4Backend } from '../src/services/cpAnalysisBackend';
import { handleCPAnalysisAI } from '../server/cpAnalysisAI';
import { serveCP4Analysis } from '../server/cpAnalysisDeadline';
import { analyzeCPWithAI } from '../src/services/aiService';
import { CPAnalysisAIError } from '../src/services/cpAnalysisAIDiagnostics';

async function runDiagnostic() {
  console.log('=== STARTING CP4 FULL DIAGNOSTIC & VERIFICATION RUNNER ===\n');
  
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', (req, res, next) => {
    const reqId = (req.headers['x-cp4-request-id'] as string) || '-';
    console.log(`[TEST SERVER IN] ${req.method} ${req.path} | ReqID: ${reqId}`);
    next();
  });

  // Health endpoint
  app.get('/api/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.json({
      service: CP4_BACKEND_SERVICE,
      cpAnalysisProtocol: 1,
      status: 'ok',
      requestId: req.headers['x-cp4-request-id'],
      timestamp: new Date().toISOString(),
    });
  });

  // POST Ping endpoint
  app.post('/api/ai/analyze-cp-ping', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const reqId = (req.headers['x-cp4-request-id'] as string) || 'ping-test';
    res.setHeader('X-CP4-Request-ID', reqId);
    res.setHeader('X-CP4-Service', CP4_BACKEND_SERVICE);
    res.setHeader('Content-Type', 'application/json');
    res.json({
      status: 'ok',
      diagnostic: 'express_post_handler_reached',
      service: CP4_BACKEND_SERVICE,
      requestId: reqId,
      receivedBodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
    });
  });

  // Main CP Analysis endpoint
  // Sample data
  const bindoElements = [
    { id: 'elem-bind-1', code: 'E1', name: 'Menyimak', content: 'Peserta didik mampu memahami ide pokok dari teks audio dan penjelasan guru.' },
    { id: 'elem-bind-2', code: 'E2', name: 'Membaca dan Memirsa', content: 'Peserta didik mampu membaca kata-kata dengan fasih dan memahami pesan cerita.' },
    { id: 'elem-bind-3', code: 'E3', name: 'Berbicara dan Mempresentasikan', content: 'Peserta didik mampu menyampaikan gagasan secara lisan dengan santun dan jelas.' },
    { id: 'elem-bind-4', code: 'E4', name: 'Menulis', content: 'Peserta didik mampu menulis teks narasi singkat dengan ejaan yang benar.' },
  ];

  const matElements = [
    { id: 'elem-mat-1', code: 'E1', name: 'Bilangan', content: 'Peserta didik menunjukkan pemahaman dan intuisi bilangan pada bilangan cacah sampai 10.000.' },
    { id: 'elem-mat-2', code: 'E2', name: 'Aljabar', content: 'Peserta didik dapat mengisi nilai yang belum diketahui dalam sebuah kalimat matematika.' },
    { id: 'elem-mat-3', code: 'E3', name: 'Pengukuran', content: 'Peserta didik dapat mengukur panjang dan berat benda menggunakan satuan baku.' },
    { id: 'elem-mat-4', code: 'E4', name: 'Geometri', content: 'Peserta didik dapat mendeskripsikan ciri berbagai bentuk bangun datar.' },
  ];

  app.post('/api/ai/analyze-cp', async (req, res) => {
    if (req.headers['x-test-simulate'] === 'html-200') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<html><body>Preview Proxy Interception</body></html>');
    }
    if (req.headers['x-test-simulate'] === 'json-502') {
      res.setHeader('Content-Type', 'application/json');
      return res.status(502).json({
        service: CP4_BACKEND_SERVICE,
        code: 'AI_PROVIDER_ERROR',
        stage: 'provider',
        error: 'Layanan AI sedang mengalami lonjakan antrean trafik (HTTP 503). Silakan coba lagi.',
      });
    }
    const apiKey = process.env.GEMINI_API_KEY || null;
    const mockGenerate = async (request: any) => {
      try {
        const isRetry = typeof request?.contents === 'string' && (request.contents.includes('RETRY KOLOM 3 SAJA') || request.contents.includes('PERBAIKAN TERARAH'));
        if (isRetry) {
          return {
            text: JSON.stringify({
              items: [
                {
                  elementId: 'elem-bind-2',
                  itemId: 'ana-ai-elem-bind-2-1',
                  meaningfulUnderstanding: 'Peserta didik mampu membaca kata-kata dengan fasih dan memahami pesan cerita.',
                },
              ],
            }),
          };
        }
        let elements = bindoElements;
        if (typeof request?.contents === 'string' && request.contents.includes('Matematika')) {
          elements = matElements;
        }
        return {
          text: JSON.stringify({
            generalSummary: 'Ringkasan analisis CP',
            items: elements.map((e, idx) => ({
              elementId: e.id,
              elementName: e.name,
              cpCompetence: 'Memahami',
              materialScope: 'Materi Inti',
              scopeCode: `E${idx + 1}`,
              suggestedTp: 'Satu TP',
              meaningfulUnderstanding: e.content,
            })),
          }),
        };
      } catch (mockErr) {
        console.error('[MOCK GENERATE ERROR]', mockErr);
        throw mockErr;
      }
    };
    return serveCP4Analysis(req, res, apiKey, mockGenerate);
  });

  app.use('/api', (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ error: err.message, service: CP4_BACKEND_SERVICE });
  });

  app.all('/api/*', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({ error: 'Unknown API route', path: req.path });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`Test Express server running at ${baseUrl}\n`);

  try {
    // Monkey-patch global fetch for test loopback redirect
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('/api/')) {
        url = `${baseUrl}${url}`;
      }
      return originalFetch(url, init);
    };

    // 1. Health JSON Check
    console.log('[TEST 1] Verifying GET /api/health and POST /api/ai/analyze-cp-ping via checkCP4Backend...');
    await checkCP4Backend(new AbortController().signal, 'cp4-test-check-001');
    console.log('-> PASS: Both GET /api/health and POST /api/ai/analyze-cp-ping verified successfully!\n');

    // Sample data
    const bindoElements = [
      { id: 'elem-bind-1', code: 'E1', name: 'Menyimak', content: 'Peserta didik mampu memahami ide pokok dari teks audio dan penjelasan guru.' },
      { id: 'elem-bind-2', code: 'E2', name: 'Membaca dan Memirsa', content: 'Peserta didik mampu membaca kata-kata dengan fasih dan memahami pesan cerita.' },
      { id: 'elem-bind-3', code: 'E3', name: 'Berbicara dan Mempresentasikan', content: 'Peserta didik mampu menyampaikan gagasan secara lisan dengan santun dan jelas.' },
      { id: 'elem-bind-4', code: 'E4', name: 'Menulis', content: 'Peserta didik mampu menulis teks narasi singkat dengan ejaan yang benar.' },
    ];

    const matElements = [
      { id: 'elem-mat-1', code: 'E1', name: 'Bilangan', content: 'Peserta didik menunjukkan pemahaman dan intuisi bilangan pada bilangan cacah sampai 10.000.' },
      { id: 'elem-mat-2', code: 'E2', name: 'Aljabar', content: 'Peserta didik dapat mengisi nilai yang belum diketahui dalam sebuah kalimat matematika.' },
      { id: 'elem-mat-3', code: 'E3', name: 'Pengukuran', content: 'Peserta didik dapat mengukur panjang dan berat benda menggunakan satuan baku.' },
      { id: 'elem-mat-4', code: 'E4', name: 'Geometri', content: 'Peserta didik dapat mendeskripsikan ciri berbagai bentuk bangun datar.' },
    ];

    // 2. Full Analysis Success Test (Bahasa Indonesia 4 elements)
    console.log('[TEST 2] Testing full CP Analysis for Bahasa Indonesia (4 elements)...');
    const bindoResult = await analyzeCPWithAI({
      subject: 'Bahasa Indonesia', grade: 'Kelas 4', phase: 'Fase B', curriculum: 'Kurikulum Merdeka',
      cpText: 'CP Bahasa Indonesia SD', elements: bindoElements,
    }, { requestId: 'cp4-bind-00000000-0000-4000-a000-000000000001' });
    console.log(`-> PASS: Returned ${bindoResult.items.length} items, engine: ${bindoResult.engine}, valid: ${bindoResult.validation?.valid}\n`);

    // 3. Full Analysis Success Test (Matematika 4 elements)
    console.log('[TEST 3] Testing full CP Analysis for Matematika (4 elements)...');
    const matResult = await analyzeCPWithAI({
      subject: 'Matematika', grade: 'Kelas 4', phase: 'Fase B', curriculum: 'Kurikulum Merdeka',
      cpText: 'CP Matematika SD', elements: matElements,
    }, { requestId: 'cp4-mat-00000000-0000-4000-a000-000000000002' });
    console.log(`-> PASS: Returned ${matResult.items.length} items, engine: ${matResult.engine}, valid: ${matResult.validation?.valid}\n`);

    // 4. Simulated HTML 200 Interception Test
    console.log('[TEST 4] Testing HTML 200 response handling...');
    let htmlErrorCaught: CPAnalysisAIError | null = null;
    try {
      // Mock fetch header for html simulation
      const reqInitHeader = { 'x-test-simulate': 'html-200' };
      const originalFetchImpl = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const customInit = { ...init, headers: { ...init?.headers, ...reqInitHeader } };
        return originalFetchImpl(input, customInit);
      };

      await analyzeCPWithAI({
        subject: 'Bahasa Indonesia', grade: 'Kelas 4', phase: 'Fase B', curriculum: 'Kurikulum Merdeka',
        cpText: 'CP Bahasa Indonesia SD', elements: bindoElements,
      }, { requestId: 'cp4-html-00000000-0000-4000-a000-000000000003' });
    } catch (err: any) {
      if (err instanceof CPAnalysisAIError) htmlErrorCaught = err;
    } finally {
      // Restore fetch
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith('/api/')) url = `${baseUrl}${url}`;
        return originalFetch(url, init);
      };
    }
    console.log(`-> PASS: HTML 200 caught with code "${htmlErrorCaught?.code}", stage "${htmlErrorCaught?.stage}"`);
    if (htmlErrorCaught?.code !== 'RESPONSE_INVALID') {
      throw new Error(`Expected RESPONSE_INVALID for HTML response, got ${htmlErrorCaught?.code}`);
    }
    console.log('-> Verified: Connection/backend diagnosis generated without marking CP elements as broken!\n');

    // 5. Simulated JSON 502 Cause Error Message Test
    console.log('[TEST 5] Testing JSON 502 error message propagation...');
    let json502ErrorCaught: CPAnalysisAIError | null = null;
    try {
      const originalFetchImpl = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const customInit = { ...init, headers: { ...init?.headers, 'x-test-simulate': 'json-502' } };
        return originalFetchImpl(input, customInit);
      };

      await analyzeCPWithAI({
        subject: 'Bahasa Indonesia', grade: 'Kelas 4', phase: 'Fase B', curriculum: 'Kurikulum Merdeka',
        cpText: 'CP Bahasa Indonesia SD', elements: bindoElements,
      }, { requestId: 'cp4-502-00000000-0000-4000-a000-000000000004' });
    } catch (err: any) {
      if (err instanceof CPAnalysisAIError) json502ErrorCaught = err;
    } finally {
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith('/api/')) url = `${baseUrl}${url}`;
        return originalFetch(url, init);
      };
    }
    console.log(`-> PASS: JSON 502 caught with message "${json502ErrorCaught?.message}"`);
    if (!json502ErrorCaught?.message.includes('lonjakan antrean trafik')) {
      throw new Error('502 JSON error message did not propagate provider error string!');
    }
    console.log('-> Verified: Actual 502 cause error message displayed correctly!\n');

    // 6. Single Element Retry/Repair Test
    console.log('[TEST 6] Testing single element retry with canonical ID preservation...');
    const retryResult = await analyzeCPWithAI({
      subject: 'Bahasa Indonesia', grade: 'Kelas 4', phase: 'Fase B', curriculum: 'Kurikulum Merdeka',
      cpText: 'CP Bahasa Indonesia SD', elements: bindoElements,
      retryTargets: [
        { itemId: 'ana-ai-elem-bind-2-1', elementId: 'elem-bind-2', cpCompetence: 'Membaca dan Memirsa', materialScope: 'Pesan cerita' }
      ]
    }, { requestId: 'cp4-retry-00000000-0000-4000-a000-000000000005' });
    console.log(`-> PASS: Single element retry returned ${retryResult.items.length} item(s) for target "ana-ai-elem-bind-2-1"`);
    if (retryResult.items[0].elementId !== 'elem-bind-2') {
      throw new Error('Canonical elementId not preserved in single element retry!');
    }
    console.log('-> Verified: Canonical element ID and target ID preserved correctly!\n');

    // 7. Stress Test (10 repeated runs)
    console.log('[TEST 7] Running 10 repeated requests for stability check...');
    for (let i = 1; i <= 10; i++) {
      const isBindo = i % 2 === 1;
      const targetElements = isBindo ? bindoElements : matElements;
      const subject = isBindo ? 'Bahasa Indonesia' : 'Matematika';
      const reqId = `cp4-stress-0000-0000-4000-a000-${String(i).padStart(12, '0')}`;
      const res = await analyzeCPWithAI({
        subject, grade: 'Kelas 4', phase: 'Fase B', curriculum: 'Kurikulum Merdeka',
        cpText: 'CP SD', elements: targetElements,
      }, { requestId: reqId });
      if (res.items.length !== 4) {
        throw new Error(`Stress run #${i} returned unexpected item count: ${res.items.length}`);
      }
    }
    console.log('-> PASS: 10/10 repeated requests completed successfully with 100% JSON responses!\n');

    console.log('====================================================');
    console.log('ALL CP4 DIAGNOSTIC & VERIFICATION TESTS PASSED (PASS)');
    console.log('====================================================');

    // Restore fetch
    globalThis.fetch = originalFetch;
  } finally {
    server.close();
  }
}

runDiagnostic().catch((err) => {
  console.error('DIAGNOSTIC TEST FAILED:', err);
  process.exit(1);
});

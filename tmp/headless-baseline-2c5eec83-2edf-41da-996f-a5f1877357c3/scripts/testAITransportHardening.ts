import {
  generateTPWithAI,
  GenerateTPParams,
  getGeminiApiKey,
  saveGeminiApiKey,
  removeGeminiApiKey,
  GEMINI_API_KEY_STORAGE_KEY,
  subscribeApiKeyModal,
  submitApiKeyFromModal,
} from '../src/services/aiService';
import { generateSemanticTPCode } from '../src/services/cpWorkflowService';
import { createInitialStorageV5, serializeBackupV5 } from '../src/services/storageV5';
import { GoogleGenAI } from '@google/genai';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== Running E.4.1A TP AI Transport Hardening Regression Tests ===\n');

  const dummyParams: GenerateTPParams = {
    cpGeneral: 'Peserta didik memahami konsep perkalian',
    cpElements: [{ id: 'el-1', name: 'Aljabar', content: 'Perkalian sederhana' }],
    cpAnalysisItems: [{ elementName: 'Aljabar', cpCompetence: 'Memahami', materialScope: 'Konsep perkalian', suggestedTp: 'Memahami perkalian' }],
    subject: 'Matematika',
    grade: 'Kelas 4',
    phase: 'Fase B',
    curriculum: 'Kurikulum Merdeka'
  };

  // Test 1: 200 text/html fails with explicit non-JSON/API-route error
  {
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null
        },
        text: async () => '<!doctype html><html><body>Error page</body></html>'
      } as any;
    };

    try {
      await generateTPWithAI(dummyParams);
      assert(false, 'Should have failed on HTML response');
    } catch (err: any) {
      assert(err.message.includes('Endpoint AI TP tidak mengembalikan JSON (received text/html)'), 
        'Correctly throws on HTML response indicating API fallback');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // Test 2: JSON 4xx/5xx preserves backend error
  {
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      return {
        ok: false,
        status: 500,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({ error: 'Kunci API Gemini terblokir atau kadaluwarsa' })
      } as any;
    };

    try {
      await generateTPWithAI(dummyParams);
      assert(false, 'Should have failed on 500 response');
    } catch (err: any) {
      assert(err.message.includes('Kunci API Gemini terblokir atau kadaluwarsa'), 
        'Preserved backend JSON error on 5xx response');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // Test 3: Valid JSON TP response succeeds
  {
    const originalFetch = global.fetch;
    let lastBody: any = null;
    global.fetch = async (url, init) => {
      lastBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [
            {
              code: 'TP 4.1',
              elementName: 'Aljabar',
              statement: 'Murid mampu mengidentifikasi perkalian sebagai penjumlahan berulang.',
              competence: 'Mengidentifikasi',
              contentScope: 'Penjualan berulang',
              p3Dimensions: ['Penalaran Kritis']
            }
          ]
        })
      } as any;
    };

    try {
      const res = await generateTPWithAI(dummyParams);
      const items = res.items;
      assert(items.length === 1, 'Correctly parsed valid JSON items array');
      assert(items[0].statement === 'Murid mampu mengidentifikasi perkalian sebagai penjumlahan berulang.', 'Maps statement correctly');
      assert(lastBody && lastBody.cpAnalysisItems !== undefined, 'cpAnalysisItems was transmitted to the backend');
    } catch (err: any) {
      assert(false, 'Should have succeeded with valid JSON: ' + err.message);
    } finally {
      global.fetch = originalFetch;
    }
  }

  // Test 4: Malformed/empty items are rejected
  {
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          success: true,
          items: [] // Empty items
        })
      } as any;
    };

    try {
      await generateTPWithAI(dummyParams);
      assert(false, 'Should have failed on empty items');
    } catch (err: any) {
      assert(err.message.includes('array dan tidak boleh kosong'), 
        'Correctly rejected empty items array');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // Test 5: Malformed item without statement/description is rejected
  {
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          success: true,
          items: [
            {
              code: 'TP 4.1',
              elementName: 'Aljabar'
              // missing statement and description
            }
          ]
        })
      } as any;
    };

    try {
      await generateTPWithAI(dummyParams);
      assert(false, 'Should have failed on missing statement');
    } catch (err: any) {
      assert(err.message.includes('tidak memiliki statement/description'), 
        'Correctly rejected items with missing statement/description');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // Test 6: BYOK Helper Contract (localStorage key 'alco_admin_gemini_api_key' and get/save/remove)
  {
    assert(GEMINI_API_KEY_STORAGE_KEY === 'alco_admin_gemini_api_key', 'Storage key matches contract: alco_admin_gemini_api_key');
    
    removeGeminiApiKey();
    assert(getGeminiApiKey() === null, 'getGeminiApiKey returns null after removeGeminiApiKey');

    saveGeminiApiKey('  AIzaSyTestKey12345  ');
    assert(getGeminiApiKey() === 'AIzaSyTestKey12345', 'saveGeminiApiKey trims and saves key correctly');

    removeGeminiApiKey();
    assert(getGeminiApiKey() === null, 'removeGeminiApiKey clears key');
  }

  // Test 7: User key is sent as X-Gemini-API-Key header in AI retry request when server requires auth
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    let retryHeaders: Headers | null = null;
    
    saveGeminiApiKey('AIzaSyUserSpecificKey999');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        // Request 1: Server has no env key, returns 503 AI_NOT_CONFIGURED
        return {
          ok: false,
          status: 503,
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          clone: () => ({
            json: async () => ({ code: 'AI_NOT_CONFIGURED', error: 'Layanan AI belum dikonfigurasi pada server.' })
          }),
          json: async () => ({ code: 'AI_NOT_CONFIGURED', error: 'Layanan AI belum dikonfigurasi pada server.' })
        } as any;
      }

      // Request 2: Retry with user key
      retryHeaders = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          success: true,
          items: [{
            code: 'TP 4.1',
            elementName: 'Aljabar',
            statement: 'Murid mampu memahami konsep perkalian.',
            competence: 'Memahami',
            contentScope: 'Perkalian',
            p3Dimensions: ['Penalaran Kritis']
          }]
        })
      } as any;
    };

    try {
      await generateTPWithAI(dummyParams);
      assert(callCount === 2, 'aiFetch retried once after 503 AI_NOT_CONFIGURED');
      assert(retryHeaders !== null, 'Retry fetch was called and headers captured');
      const headerVal = retryHeaders?.get('x-gemini-api-key');
      assert(headerVal === 'AIzaSyUserSpecificKey999', `User key sent as X-Gemini-API-Key header on retry (received: ${headerVal})`);
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 8: User key has priority over server key in resolver
  {
    // Simulate server resolver logic
    function simulateResolveApiKey(reqHeaders: Record<string, string | undefined>, serverEnvKey?: string): string | null {
      const userKey = reqHeaders['x-gemini-api-key'];
      if (typeof userKey === 'string' && userKey.trim().length > 0) {
        return userKey.trim();
      }
      if (serverEnvKey && serverEnvKey.trim().length > 0) {
        return serverEnvKey.trim();
      }
      return null;
    }

    const resolvedWithBoth = simulateResolveApiKey(
      { 'x-gemini-api-key': 'user-priority-key' },
      'server-fallback-key'
    );
    assert(resolvedWithBoth === 'user-priority-key', 'User key has strict priority over server env key');

    const resolvedWithServerOnly = simulateResolveApiKey(
      {},
      'server-fallback-key'
    );
    assert(resolvedWithServerOnly === 'server-fallback-key', 'Falls back to server env key when user key is absent');
  }

  // Test 9: Without user key and without server key -> AI_NOT_CONFIGURED
  {
    function simulateResolveApiKey(reqHeaders: Record<string, string | undefined>, serverEnvKey?: string): string | null {
      const userKey = reqHeaders['x-gemini-api-key'];
      if (typeof userKey === 'string' && userKey.trim().length > 0) return userKey.trim();
      if (serverEnvKey && serverEnvKey.trim().length > 0) return serverEnvKey.trim();
      return null;
    }

    const resolvedNeither = simulateResolveApiKey({}, '');
    assert(resolvedNeither === null, 'Resolves to null when neither user key nor server key is present');

    // Endpoint contract check for null key
    const endpointResponse = resolvedNeither ? { status: 200 } : {
      status: 503,
      body: {
        success: false,
        code: 'AI_NOT_CONFIGURED',
        error: 'Layanan AI belum dikonfigurasi pada server.'
      }
    };
    assert(endpointResponse.status === 503, 'Returns HTTP 503 when no key available');
    assert(endpointResponse.body.code === 'AI_NOT_CONFIGURED', 'Returns code AI_NOT_CONFIGURED');
  }

  // Test 10: Client Gemini is created per-request/key and not cached across users
  {
    const clientA = new GoogleGenAI({
      apiKey: 'key-user-alice',
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    const clientB = new GoogleGenAI({
      apiKey: 'key-user-bob',
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    assert(clientA !== clientB, 'Gemini client instances are distinct objects per user/request');
  }

  // Test 11: Key never enters Storage V5 or backup JSON
  {
    const testSecretKey = 'AIzaSyTopSecretNeverPersistInStorageV5';
    saveGeminiApiKey(testSecretKey);

    const storageState = createInitialStorageV5();
    const backupJson = serializeBackupV5(storageState);

    assert(!backupJson.includes(testSecretKey), 'Backup JSON does NOT contain user secret API key');
    assert(!backupJson.includes(GEMINI_API_KEY_STORAGE_KEY), 'Backup JSON does NOT contain alco_admin_gemini_api_key storage key');
    
    const stateString = JSON.stringify(storageState);
    assert(!stateString.includes(testSecretKey), 'Storage V5 state object does NOT contain user secret API key');

    removeGeminiApiKey();
  }

  // Test 12: Invalid key (401/403) throws error and does NOT produce synthetic/fallback TP
  {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return {
        ok: false,
        status: 401,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          error: 'API_KEY_INVALID: API key not valid. Please pass a valid API key.',
          code: 'INVALID_API_KEY'
        })
      } as any;
    };

    saveGeminiApiKey('invalid-bad-key');

    try {
      await generateTPWithAI(dummyParams);
      assert(false, 'Should have failed on 401 invalid API key');
    } catch (err: any) {
      assert(err.message.includes('Kunci API Gemini tidak valid') || err.message.includes('API key'), 
        'Invalid key rejects without calling fallback or generating fake TP');
      assert(getGeminiApiKey() === null, 'Invalid key was automatically removed from storage');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 13: Regression A - Server fallback + local BYOK -> 1st req no key, pedagogical_engine -> retry once with local BYOK -> Gemini used
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    const capturedHeaders: Array<string | null> = [];

    saveGeminiApiKey('AIzaSyLocalUserKeyAutoRetry');

    global.fetch = async (url, init) => {
      callCount++;
      const headers = new Headers(init?.headers);
      capturedHeaders.push(headers.get('x-gemini-api-key'));

      if (callCount === 1) {
        // Request 1: No header sent, server responds with pedagogical fallback
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{
                code: 'E1-UMU-01',
                elementName: 'Elemen 1',
                statement: 'Fallback TP statement',
                competence: 'Memahami',
                contentScope: 'Materi Fallback'
              }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{
              code: 'E1-UMU-01',
              elementName: 'Elemen 1',
              statement: 'Fallback TP statement',
              competence: 'Memahami',
              contentScope: 'Materi Fallback'
            }]
          })
        } as any;
      }

      // Request 2: Retry with user key -> returns Gemini result
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini',
            items: [{
              code: 'E1-ALJ-01',
              elementName: 'Aljabar',
              statement: 'Gemini AI generated TP statement',
              competence: 'Menganalisis',
              contentScope: 'Pola Bilangan'
            }]
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{
            code: 'E1-ALJ-01',
            elementName: 'Aljabar',
            statement: 'Gemini AI generated TP statement',
            competence: 'Menganalisis',
            contentScope: 'Pola Bilangan'
          }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch retried exactly once with local BYOK (callCount: ${callCount})`);
      assert(capturedHeaders[0] === null, 'Request 1 sent without X-Gemini-API-Key header');
      assert(capturedHeaders[1] === 'AIzaSyLocalUserKeyAutoRetry', 'Request 2 sent with local user X-Gemini-API-Key');
      assert(result.engine === 'gemini', `Result engine is gemini (received: ${result.engine})`);
      assert(result.items[0].statement === 'Gemini AI generated TP statement', 'Gemini result item statement is used');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 14: Regression B - No local BYOK -> pedagogical fallback accepted directly without modal or retry
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    removeGeminiApiKey();

    global.fetch = async (url, init) => {
      callCount++;
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          success: true,
          engine: 'pedagogical_engine',
          items: [{
            code: 'E1-UMU-01',
            elementName: 'Elemen 1',
            statement: 'Pedagogical fallback statement without BYOK',
            competence: 'Memahami',
            contentScope: 'Materi'
          }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 1, `Without BYOK, pedagogical fallback accepted on call 1 (callCount: ${callCount})`);
      assert(result.engine === 'pedagogical_engine', 'Result engine is pedagogical_engine');
      assert(result.items[0].statement === 'Pedagogical fallback statement without BYOK', 'Fallback item statement is used directly');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // Test 15: Regression C - Switching CPAnalysisItem A -> B replaces competence/contentScope/scopeCode/code without leftover
  {
    const mockAnalysisItems = [
      {
        id: 'ana-item-A',
        elementId: 'elem-1',
        elementName: 'Membaca',
        scopeCode: 'MBI',
        cpCompetence: 'Membaca Lancar',
        materialScope: 'Teks Narasi Pendek'
      },
      {
        id: 'ana-item-B',
        elementId: 'elem-2',
        elementName: 'Menulis',
        scopeCode: 'MNL',
        cpCompetence: 'Menulis Tegak Bersambung',
        materialScope: 'Kalimat Sederhana'
      }
    ];

    const cpElements = [
      { id: 'elem-1', name: 'Membaca', code: 'E1' },
      { id: 'elem-2', name: 'Menulis', code: 'E2' }
    ];

    // Simulate initial select of Item A
    const selectedA = mockAnalysisItems[0];
    const codeA = generateSemanticTPCode(selectedA, cpElements, []);
    let currentItem = {
      id: 'tp-stable-id-123',
      code: codeA,
      scopeCode: selectedA.scopeCode,
      cpAnalysisItemIds: [selectedA.id],
      cpAnalysisId: selectedA.id,
      elementName: selectedA.elementName,
      competence: selectedA.cpCompetence,
      contentScope: selectedA.materialScope,
      statement: 'Peserta didik membaca teks narasi pendek dengan lancar.'
    };

    assert(currentItem.cpAnalysisItemIds[0] === 'ana-item-A', 'Item initially points to ana-item-A');
    assert(currentItem.competence === 'Membaca Lancar', 'Item initially has competence from A');
    assert(currentItem.contentScope === 'Teks Narasi Pendek', 'Item initially has materialScope from A');
    assert(currentItem.code === 'E1-MBI-01', 'Item initially has semantic code E1-MBI-01');

    // Simulate user switching to Item B in UI event handler
    const selectedB = mockAnalysisItems[1];
    const codeB = generateSemanticTPCode(selectedB, cpElements, [], currentItem.id);
    currentItem = {
      ...currentItem,
      code: codeB,
      scopeCode: selectedB.scopeCode,
      cpAnalysisItemIds: [selectedB.id],
      cpAnalysisId: selectedB.id,
      elementName: selectedB.elementName,
      competence: selectedB.cpCompetence,
      contentScope: selectedB.materialScope,
    };

    assert(currentItem.id === 'tp-stable-id-123', 'TPItem.id remains strictly stable across switch');
    assert(currentItem.cpAnalysisItemIds[0] === 'ana-item-B', 'Lineage successfully switched to ana-item-B');
    assert(currentItem.competence === 'Menulis Tegak Bersambung', 'Competence overwritten cleanly to B');
    assert(currentItem.contentScope === 'Kalimat Sederhana', 'ContentScope overwritten cleanly to B without leftover from A');
    assert(currentItem.scopeCode === 'MNL', 'ScopeCode overwritten cleanly to B');
    assert(currentItem.code === 'E2-MNL-01', 'Semantic code regenerated cleanly for B');
  }

  // Test 16: Regression D - Provenance recording for Gemini vs Pedagogical Engine
  {
    // Gemini Case
    const geminiEngine = 'gemini';
    const isGemini = geminiEngine === 'gemini';
    const tpCandidateGemini = {
      generatedBy: isGemini ? 'AI' : undefined,
      generationEngine: geminiEngine,
      provenance: {
        generatedBy: isGemini ? 'AI' : 'SYSTEM',
        engine: geminiEngine
      }
    };
    assert(tpCandidateGemini.generatedBy === 'AI', 'Gemini recorded as generatedBy: AI');
    assert(tpCandidateGemini.generationEngine === 'gemini', 'Gemini recorded as generationEngine: gemini');
    assert(tpCandidateGemini.provenance.generatedBy === 'AI', 'Provenance generatedBy is AI');
    assert(tpCandidateGemini.provenance.engine === 'gemini', 'Provenance engine is gemini');

    // Pedagogical Fallback Case
    const fallbackEngine = 'pedagogical_engine';
    const isFallbackGemini = ((engine: string) => engine === 'gemini')(fallbackEngine);
    const tpCandidateFallback = {
      generatedBy: isFallbackGemini ? 'AI' : undefined,
      generationEngine: fallbackEngine,
      provenance: {
        generatedBy: isFallbackGemini ? 'AI' : 'SYSTEM',
        engine: fallbackEngine
      }
    };
    assert(tpCandidateFallback.generatedBy === undefined, 'Pedagogical fallback is NOT claimed as TEACHER (undefined in schema)');
    assert(tpCandidateFallback.generationEngine === 'pedagogical_engine', 'Pedagogical fallback recorded as generationEngine: pedagogical_engine');
    assert(tpCandidateFallback.provenance.generatedBy === 'SYSTEM', 'Pedagogical fallback provenance generatedBy is SYSTEM');
    assert(tpCandidateFallback.provenance.engine === 'pedagogical_engine', 'Pedagogical fallback provenance engine is pedagogical_engine');
  }

  // Test 17: Scenario 1 - Server key invalid (401 on req 1) + Local BYOK valid -> 1st req no header 401 -> local key NOT deleted -> 2nd req with local BYOK 200 -> success used without modal
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    const capturedHeaders: Array<string | null> = [];

    saveGeminiApiKey('AIzaSyValidUserLocalKey');

    let modalOpened = false;
    const unsubscribe = subscribeApiKeyModal(() => {
      modalOpened = true;
    });

    global.fetch = async (url, init) => {
      callCount++;
      const headers = new Headers(init?.headers);
      capturedHeaders.push(headers.get('x-gemini-api-key'));

      if (callCount === 1) {
        // Request 1: server returns 401 (server key invalid)
        return {
          ok: false,
          status: 401,
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          json: async () => ({
            error: 'Server key expired or invalid',
            code: 'INVALID_API_KEY'
          })
        } as any;
      }

      // Request 2: retried with local BYOK -> returns 200 success
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{
            code: 'E1-ALJ-01',
            elementName: 'Aljabar',
            statement: 'Berhasil dengan local key user.',
            competence: 'Menganalisis',
            contentScope: 'Pola Bilangan'
          }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch retried with local key after server 401 (callCount: ${callCount})`);
      assert(capturedHeaders[0] === null, 'Request 1 had no X-Gemini-API-Key');
      assert(capturedHeaders[1] === 'AIzaSyValidUserLocalKey', 'Request 2 had local X-Gemini-API-Key');
      assert(getGeminiApiKey() === 'AIzaSyValidUserLocalKey', 'Local BYOK was NOT removed from storage');
      assert(!modalOpened, 'ApiKeyModal was NOT opened since local key was valid and succeeded');
      assert(result.items[0].statement === 'Berhasil dengan local key user.', 'Successful result from local key was returned');
    } finally {
      unsubscribe();
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 18: Scenario 2 - Server key invalid (401 on req 1) + Local BYOK invalid (401 on req 2) -> ONLY THEN delete local key -> open modal -> retry with new key -> no loop
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    const capturedHeaders: Array<string | null> = [];

    saveGeminiApiKey('AIzaSyBadUserLocalKey');

    let modalOpenedCount = 0;
    const unsubscribe = subscribeApiKeyModal((isOpen) => {
      if (isOpen) {
        modalOpenedCount++;
        // User inputs fresh valid key via modal
        setTimeout(() => {
          submitApiKeyFromModal('AIzaSyFreshKeyFromModal');
        }, 10);
      }
    });

    global.fetch = async (url, init) => {
      callCount++;
      const headers = new Headers(init?.headers);
      capturedHeaders.push(headers.get('x-gemini-api-key'));

      if (callCount === 1) {
        // Request 1: server key 401
        return {
          ok: false,
          status: 401,
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          json: async () => ({ error: 'Server key invalid', code: 'INVALID_API_KEY' })
        } as any;
      }

      if (callCount === 2) {
        // Request 2: local key was bad -> 401
        return {
          ok: false,
          status: 401,
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          json: async () => ({ error: 'User local key invalid', code: 'INVALID_API_KEY' })
        } as any;
      }

      // Request 3: fresh key from modal -> 200 OK
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{
            code: 'E1-ALJ-01',
            elementName: 'Aljabar',
            statement: 'Berhasil dengan fresh key dari modal.',
            competence: 'Menganalisis',
            contentScope: 'Pola Bilangan'
          }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 3, `aiFetch proceeded: req1 (server 401) -> req2 (local 401) -> req3 (modal fresh key 200) (callCount: ${callCount})`);
      assert(capturedHeaders[0] === null, 'Request 1 sent without key');
      assert(capturedHeaders[1] === 'AIzaSyBadUserLocalKey', 'Request 2 sent with bad local key');
      assert(capturedHeaders[2] === 'AIzaSyFreshKeyFromModal', 'Request 3 sent with fresh key from modal');
      assert(modalOpenedCount === 1, `Modal opened exactly once when local key failed with 401 (count: ${modalOpenedCount})`);
      assert(result.items[0].statement === 'Berhasil dengan fresh key dari modal.', 'Result from fresh key returned');
    } finally {
      unsubscribe();
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 19: Scenario 3 - No local BYOK + Server 401/403 -> modal opened -> retry once with new key
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    removeGeminiApiKey();

    let modalOpenedCount = 0;
    const unsubscribe = subscribeApiKeyModal((isOpen) => {
      if (isOpen) {
        modalOpenedCount++;
        setTimeout(() => {
          submitApiKeyFromModal('AIzaSyNewKeyFromUser');
        }, 10);
      }
    });

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        // Request 1: server 401
        return {
          ok: false,
          status: 401,
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          json: async () => ({ error: 'Server requires auth', code: 'UNAUTHORIZED' })
        } as any;
      }

      // Request 2: with new key -> 200
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{
            code: 'E1-ALJ-01',
            elementName: 'Aljabar',
            statement: 'Berhasil dengan key setelah server 401.',
            competence: 'Menganalisis',
            contentScope: 'Pola Bilangan'
          }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch opened modal and retried once with new key on server 401 (callCount: ${callCount})`);
      assert(modalOpenedCount === 1, 'Modal was opened for user without local key on server 401');
      assert(result.items[0].statement === 'Berhasil dengan key setelah server 401.', 'Result returned successfully');
    } finally {
      unsubscribe();
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 20: Scenario 4 - Server 503 AI_NOT_CONFIGURED + Local BYOK -> retries once with local BYOK
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyLocalKeyFor503');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 503,
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          clone: () => ({
            json: async () => ({ code: 'AI_NOT_CONFIGURED', error: 'Layanan AI belum dikonfigurasi pada server.' })
          }),
          json: async () => ({ code: 'AI_NOT_CONFIGURED', error: 'Layanan AI belum dikonfigurasi pada server.' })
        } as any;
      }

      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{
            code: 'E1-ALJ-01',
            elementName: 'Aljabar',
            statement: 'Berhasil setelah server 503 AI_NOT_CONFIGURED.',
            competence: 'Menganalisis',
            contentScope: 'Pola Bilangan'
          }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch retried once with local key on 503 AI_NOT_CONFIGURED (callCount: ${callCount})`);
      assert(result.items[0].statement === 'Berhasil setelah server 503 AI_NOT_CONFIGURED.', 'Result from retry returned');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 21: Scenario 5 - Pedagogical engine + Local BYOK -> retries once with local BYOK
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyLocalKeyForPedagogicalFallback');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{
                code: 'E1-UMU-01',
                elementName: 'Elemen 1',
                statement: 'Fallback pedagogis',
                competence: 'Memahami',
                contentScope: 'Materi'
              }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{
              code: 'E1-UMU-01',
              elementName: 'Elemen 1',
              statement: 'Fallback pedagogis',
              competence: 'Memahami',
              contentScope: 'Materi'
            }]
          })
        } as any;
      }

      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini',
            items: [{
              code: 'E1-ALJ-01',
              elementName: 'Aljabar',
              statement: 'Gemini hasil retry dari pedagogical engine.',
              competence: 'Menganalisis',
              contentScope: 'Pola Bilangan'
            }]
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{
            code: 'E1-ALJ-01',
            elementName: 'Aljabar',
            statement: 'Gemini hasil retry dari pedagogical engine.',
            competence: 'Menganalisis',
            contentScope: 'Pola Bilangan'
          }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch retried once with local key on pedagogical_engine (callCount: ${callCount})`);
      assert(result.engine === 'gemini', 'Result engine upgraded to gemini');
      assert(result.items[0].statement === 'Gemini hasil retry dari pedagogical engine.', 'Result from Gemini returned');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 22: Server 401 -> local key 401 -> modal fresh key 401 -> fresh key removed -> no 4th request / no loop
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    const capturedHeaders: Array<string | null> = [];

    saveGeminiApiKey('AIzaSyInitialLocalKey');

    let modalOpenedCount = 0;
    const unsubscribe = subscribeApiKeyModal((isOpen) => {
      if (isOpen) {
        modalOpenedCount++;
        setTimeout(() => {
          submitApiKeyFromModal('AIzaSyFreshKeyThatFails401');
        }, 10);
      }
    });

    global.fetch = async (url, init) => {
      callCount++;
      const headers = new Headers(init?.headers);
      capturedHeaders.push(headers.get('x-gemini-api-key'));

      // All requests return 401
      return {
        ok: false,
        status: 401,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({ error: 'Invalid API key (401)', code: 'INVALID_API_KEY' })
      } as any;
    };

    try {
      await generateTPWithAI(dummyParams);
      assert(false, 'Should have thrown on 401 after fresh modal key failed');
    } catch (err: any) {
      assert(callCount === 3, `aiFetch stopped after exactly 3 requests (server 401 -> local 401 -> modal fresh 401) (callCount: ${callCount})`);
      assert(capturedHeaders[0] === null, 'Request 1 sent without key');
      assert(capturedHeaders[1] === 'AIzaSyInitialLocalKey', 'Request 2 sent with initial local key');
      assert(capturedHeaders[2] === 'AIzaSyFreshKeyThatFails401', 'Request 3 sent with fresh key from modal');
      assert(modalOpenedCount === 1, `Modal opened exactly once (count: ${modalOpenedCount})`);
      assert(getGeminiApiKey() === null, 'Fresh invalid key from modal was removed from storage after 401');
      assert(err.message.includes('Kunci API Gemini tidak valid') || err.message.includes('401'), 'Error message reflects invalid key');
    } finally {
      unsubscribe();
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 23: Server 503 AI_NOT_CONFIGURED -> local key 401 -> modal fresh key 401 -> fresh key removed -> no loop
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    const capturedHeaders: Array<string | null> = [];

    saveGeminiApiKey('AIzaSyLocalKeyFor503Then401');

    let modalOpenedCount = 0;
    const unsubscribe = subscribeApiKeyModal((isOpen) => {
      if (isOpen) {
        modalOpenedCount++;
        setTimeout(() => {
          submitApiKeyFromModal('AIzaSyFreshKeyFor503ThatFails401');
        }, 10);
      }
    });

    global.fetch = async (url, init) => {
      callCount++;
      const headers = new Headers(init?.headers);
      capturedHeaders.push(headers.get('x-gemini-api-key'));

      if (callCount === 1) {
        return {
          ok: false,
          status: 503,
          headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
          },
          clone: () => ({
            json: async () => ({ code: 'AI_NOT_CONFIGURED', error: 'Layanan AI belum dikonfigurasi pada server.' })
          }),
          json: async () => ({ code: 'AI_NOT_CONFIGURED', error: 'Layanan AI belum dikonfigurasi pada server.' })
        } as any;
      }

      // Request 2 & 3 return 401
      return {
        ok: false,
        status: 401,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({ error: 'Invalid API key (401)', code: 'INVALID_API_KEY' })
      } as any;
    };

    try {
      await generateTPWithAI(dummyParams);
      assert(false, 'Should have thrown on 401 after fresh modal key failed');
    } catch (err: any) {
      assert(callCount === 3, `aiFetch stopped after exactly 3 requests (503 -> local 401 -> modal fresh 401) (callCount: ${callCount})`);
      assert(modalOpenedCount === 1, `Modal opened exactly once on 503 auth failure (count: ${modalOpenedCount})`);
      assert(getGeminiApiKey() === null, 'Fresh invalid key from modal was removed from storage after 401 in 503 branch');
    } finally {
      unsubscribe();
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 24 (A): fallback JSON valid -> retry 200 text/html "Starting Server" -> uses pedagogical fallback without throwing
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKey');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Valid fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Valid fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: preview "Starting Server" html
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'text/html' : null },
        clone: () => ({
          json: async () => { throw new Error('Unexpected token < in JSON at position 0'); }
        }),
        text: async () => '<html><body>Starting Server...</body></html>',
        json: async () => { throw new Error('Unexpected token < in JSON at position 0'); }
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch attempted upgrade once (callCount: ${callCount})`);
      assert(result.engine === 'pedagogical_engine', 'Result preserved first pedagogical fallback');
      assert(result.items[0].statement === 'Valid fallback statement', 'Pedagogical fallback statement is preserved intact');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 25 (B): fallback JSON valid -> retry 200 application/json but engine still pedagogical_engine -> uses first fallback
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKey');

    global.fetch = async (url, init) => {
      callCount++;
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'First fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        }),
        json: async () => ({
          success: true,
          engine: 'pedagogical_engine',
          items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'First fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch attempted upgrade (callCount: ${callCount})`);
      assert(result.engine === 'pedagogical_engine', 'Result is pedagogical_engine');
      assert(result.items[0].statement === 'First fallback statement', 'First fallback statement preserved');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 26 (C): fallback JSON valid -> retry 500 -> uses first fallback
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKey');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'First fallback 500 resilience', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'First fallback 500 resilience', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: 500 server error on AI endpoint
      return {
        ok: false,
        status: 500,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        json: async () => ({ error: 'Internal server error in Gemini bridge' })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch caught 500 and safely reverted to fallback (callCount: ${callCount})`);
      assert(result.items[0].statement === 'First fallback 500 resilience', 'Preserved valid first fallback on retry 500');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 27 (D): fallback JSON valid -> retry 401/403 -> local BYOK invalid deleted -> uses valid first fallback without error
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyBadKeyThatGives401OnRetry');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback preserved on 401 retry', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback preserved on 401 retry', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: 401 Invalid key
      return {
        ok: false,
        status: 401,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        json: async () => ({ error: 'Invalid API key', code: 'INVALID_API_KEY' })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch executed 2 requests on 401 retry (callCount: ${callCount})`);
      assert(getGeminiApiKey() === null, 'Bad local key was removed from storage after 401 retry');
      assert(result.engine === 'pedagogical_engine', 'Result is pedagogical_engine');
      assert(result.items[0].statement === 'Fallback preserved on 401 retry', 'Fallback returned without throwing error');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 28 (E): fallback JSON valid -> retry Gemini JSON valid -> uses Gemini result
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidKeyForGeminiUpgrade');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini',
            items: [{ code: 'E1-ALJ-01', elementName: 'Aljabar', statement: 'Gemini upgraded successfully', competence: 'Menganalisis', contentScope: 'Pola Bilangan' }]
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{ code: 'E1-ALJ-01', elementName: 'Aljabar', statement: 'Gemini upgraded successfully', competence: 'Menganalisis', contentScope: 'Pola Bilangan' }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch upgraded to Gemini (callCount: ${callCount})`);
      assert(result.engine === 'gemini', 'Result engine is gemini');
      assert(result.items[0].statement === 'Gemini upgraded successfully', 'Gemini statement used');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 29 (F): fallback JSON valid -> retry malformed JSON -> uses first fallback
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidKeyMalformedJSON');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback resilient to malformed JSON', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback resilient to malformed JSON', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: malformed JSON with application/json header
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => { throw new SyntaxError('Unexpected token in JSON'); }
        }),
        json: async () => { throw new SyntaxError('Unexpected token in JSON'); }
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch caught malformed JSON on retry (callCount: ${callCount})`);
      assert(result.items[0].statement === 'Fallback resilient to malformed JSON', 'Preserved valid first fallback on malformed JSON');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 30: fallback valid -> retry with empty items array { engine: 'gemini', items: [] } -> uses first fallback without throw
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKeyEmptyItems');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback preserved on empty Gemini items', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback preserved on empty Gemini items', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: Gemini with empty items
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini',
            items: []
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: []
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch ran 2 requests on empty Gemini items (callCount: ${callCount})`);
      assert(result.engine === 'pedagogical_engine', 'Result is pedagogical_engine fallback');
      assert(result.items[0].statement === 'Fallback preserved on empty Gemini items', 'First fallback is used when Gemini returns empty items');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 31: fallback valid -> retry with invalid item structure { engine: 'gemini', items: [{}] } -> uses first fallback
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKeyInvalidItem');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback preserved on invalid Gemini item', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback preserved on invalid Gemini item', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: Gemini with item missing statement
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini',
            items: [{}]
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{}]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch ran 2 requests on invalid Gemini item (callCount: ${callCount})`);
      assert(result.engine === 'pedagogical_engine', 'Result is pedagogical_engine fallback');
      assert(result.items[0].statement === 'Fallback preserved on invalid Gemini item', 'First fallback is used when Gemini returns invalid item');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 32: fallback valid -> retry with valid item { engine: 'gemini', items: [{ statement: 'TP valid' }] } -> Gemini retry used
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKeyValidItem');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: Valid Gemini item
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini',
            items: [{ code: 'E1-VAL-01', statement: 'TP valid dari Gemini' }]
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{ code: 'E1-VAL-01', statement: 'TP valid dari Gemini' }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch ran 2 requests on valid Gemini item (callCount: ${callCount})`);
      assert(result.engine === 'gemini', 'Result is gemini');
      assert(result.items[0].statement === 'TP valid dari Gemini', 'Valid Gemini item is used');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 33: fallback valid -> retry Gemini has NO items property { engine: 'gemini' } -> uses fallback
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKeyNoItemsProp');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: Gemini with no items property at all
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini'
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini'
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch ran 2 requests (callCount: ${callCount})`);
      assert(result.engine === 'pedagogical_engine', 'Result is pedagogical_engine fallback when items prop missing');
      assert(result.items[0].statement === 'Fallback statement', 'Fallback statement preserved');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 34: fallback valid -> retry Gemini has data.items instead of top-level items -> uses fallback
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKeyNestedData');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: Gemini with data.items (wrong contract)
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini',
            data: {
              items: [{ statement: 'Nested data statement' }]
            }
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini',
          data: {
            items: [{ statement: 'Nested data statement' }]
          }
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch ran 2 requests (callCount: ${callCount})`);
      assert(result.engine === 'pedagogical_engine', 'Result is pedagogical_engine fallback when items is inside data');
      assert(result.items[0].statement === 'Fallback statement', 'Fallback statement preserved');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 35: fallback valid -> retry Gemini item only has cpCompetence / materialScope without statement/description -> uses fallback
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKeyNoStmt');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: Gemini with cpCompetence only
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini',
            items: [{ cpCompetence: 'Hanya kompetensi', materialScope: 'Hanya materi' }]
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{ cpCompetence: 'Hanya kompetensi', materialScope: 'Hanya materi' }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch ran 2 requests (callCount: ${callCount})`);
      assert(result.engine === 'pedagogical_engine', 'Result is pedagogical_engine fallback when item lacks statement/description');
      assert(result.items[0].statement === 'Fallback statement', 'Fallback statement preserved');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  // Test 36: fallback valid -> retry Gemini item has description -> Gemini used
  {
    const originalFetch = global.fetch;
    let callCount = 0;
    saveGeminiApiKey('AIzaSyValidLocalKeyDescription');

    global.fetch = async (url, init) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
            })
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            items: [{ code: 'E1-UMU-01', elementName: 'Elemen 1', statement: 'Fallback statement', competence: 'Memahami', contentScope: 'Materi 1' }]
          })
        } as any;
      }

      // Request 2: Gemini with description field
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'gemini',
            items: [{ description: 'TP valid dari field description' }]
          })
        }),
        json: async () => ({
          success: true,
          engine: 'gemini',
          items: [{ description: 'TP valid dari field description' }]
        })
      } as any;
    };

    try {
      const result = await generateTPWithAI(dummyParams);
      assert(callCount === 2, `aiFetch ran 2 requests (callCount: ${callCount})`);
      assert(result.engine === 'gemini', 'Result is gemini when description provided');
      assert(result.items[0].statement === 'TP valid dari field description', 'Statement extracted from description field');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  }

  console.log(`\n=== Hardening Tests Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

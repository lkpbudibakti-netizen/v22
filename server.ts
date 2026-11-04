import { serveCP4Analysis } from './server/cpAnalysisDeadline';
import { CP4_BACKEND_SERVICE, CP4_BACKEND_PROTOCOL } from './src/services/cpAnalysisBackend';
import { isCP4RequestId } from './src/services/cpAnalysisRun';
import { assignGeneratedTPCodes, TP_CODE_FORMAT_DESCRIPTION } from './src/services/tpCodeContract';
import { validateLearningPlanActivityMeetings, resolveLearningPlanMeetingBudgets } from './src/services/learningPlanActivityMeetingService';
import express from 'express';
import { validateATPUnitMappingCanonical } from './src/services/atpUnitMappingValidationService';
import { assertMeetingSourceLineage, MeetingCoverageError, repairUnitMeetingCoverage } from './server/unitMeetingCoverageRepair';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { OfficialEducationDataProvider } from './server/schoolProvider';
import {
  GroundedCalendarSearchProvider,
  TrustedCalendarSearchProvider,
} from './server/calendarProvider';
import {
  selectBestCalendarSource,
  evaluateCalendarCandidate,
  CalendarSearchRequest,
} from './src/services/calendarProvider';
import {
  fallbackGenerateTP,
  fallbackRefineText,
  fallbackGenerateATPMapping,
  fallbackGenerateCanonicalATPUnitMapping,
  enforceCanonicalMappingInvariants,
  resolveCanonicalAtpTpIds,
} from './server/curriculumFallback';
import {
  buildMappingAnalysisPrompt,
  sanitizeMappingAnalysisResult,
  fallbackAnalyzeMapping,
} from './server/mappingAnalysis';
import { validateGraduateProfileDimensions } from './src/constants/graduateProfileDimensions';
import { checkTPSemanticFidelity } from './src/services/tpSemanticFidelity';
import { checkATPSemanticFidelity, validateATPGeneratedItemsSemanticFidelity } from './src/services/atpSemanticFidelity';
import {
  getCognitiveAdaptationProfile,
  CognitiveAdaptationProfile,
} from './src/services/cognitiveAdaptationService';

dotenv.config();

const app = express();
const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : NaN;
const PORT = (!isNaN(envPort) && envPort > 0) ? envPort : 3000;

app.use(express.json({ limit: '10mb' }));

// Logging middleware for Express /api routes to track Request ID, duration, and response Content-Type
app.use('/api', (req, res, next) => {
  const reqId = (req.headers['x-cp4-request-id'] as string) || (req.headers['x-request-id'] as string) || '-';
  const startMs = Date.now();
  console.info(`[Express API IN] ${req.method} ${req.originalUrl} | ReqID: ${reqId} | Content-Type: ${req.headers['content-type'] || '-'}`);
  res.on('finish', () => {
    const duration = Date.now() - startMs;
    const resMime = res.getHeader('content-type') || '-';
    console.info(`[Express API OUT] ${req.method} ${req.originalUrl} | ReqID: ${reqId} | Status: ${res.statusCode} | Content-Type: ${resMime} | Duration: ${duration}ms`);
  });
  next();
});

// Resolver for Gemini API Key: Request X-Gemini-API-Key -> fallback process.env.GEMINI_API_KEY -> null
function resolveApiKey(req: express.Request): string | null {
  const headerVal = req.headers['x-gemini-api-key'];
  const userKey = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (typeof userKey === 'string' && userKey.trim().length > 0) {
    return userKey.trim();
  }
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0) {
    return process.env.GEMINI_API_KEY.trim();
  }
  return null;
}

// Dedicated per-request/key Gemini client (no global singleton cache across users)
function createAIClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Resilient generator helper with model fallbacks and exponential backoff retry for 503/429/temporary spikes
async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: {
    contents: string;
    config?: any;
  }
): Promise<{ text?: string }> {
  // Standard non-paid models ordered by capability and availability
  const modelsToTry = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-flash-latest',
  ];
  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        });
        if (response && response.text) {
          return response;
        }
      } catch (err: any) {
        lastError = err;
        const errMsg = (err?.message || String(err)).toLowerCase();

        // If 404, model not found so don't retry same model, move to next model immediately
        if (errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('no longer available')) {
          break;
        }

        // For temporary 503 high demand or 429 rate limits, wait with brief backoff and try next attempt or fallback model
        if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('429') || errMsg.includes('unavailable')) {
          console.info(`[AI Service] Model ${model} returned temporary status (${attempt + 1}/2). Backing off...`);
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 400));
        } else {
          // For other errors, move to next fallback model
          break;
        }
      }
    }
  }

  const finalErrMsg = (lastError?.message || String(lastError)).toLowerCase();
  if (finalErrMsg.includes('503') || finalErrMsg.includes('high demand') || finalErrMsg.includes('unavailable')) {
    throw new Error('Layanan AI sedang mengalami lonjakan antrean trafik tinggi. Silakan klik tombol generate kembali dalam beberapa saat.');
  }
  throw lastError || new Error('Gagal memproses permintaan AI');
}

function deriveScopeCode(scopeText?: string): string {
  if (!scopeText || !scopeText.trim()) return 'MAT';
  const words = scopeText.trim().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const code = words.map((w) => w[0].toUpperCase()).slice(0, 4).join('');
    if (code.length >= 2) return code;
  }
  const word = words[0].toUpperCase();
  if (word.length <= 4) return word;
  return word.slice(0, 3);
}

function cleanAndParseJSON(rawText?: string, fallback: any = {}): any {
  if (!rawText) return fallback;
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse JSON output from AI:', cleaned);
    return fallback;
  }
}

const assessmentAICommonProperties = {
  coverageUnitId: {
    type: Type.STRING,
    description: 'ID coverage unit. Wajib sama persis dengan GenerationContract.',
  },
  assessmentIndicator: {
    type: Type.STRING,
  },
  materialOrContext: {
    type: Type.STRING,
  },
  rubricDraft: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      criteria: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            indicator: { type: Type.STRING },
            weight: { type: Type.NUMBER },
          },
          required: ['label'],
        },
      },
      scale: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            score: { type: Type.NUMBER },
            descriptor: { type: Type.STRING },
            order: { type: Type.NUMBER },
          },
          required: ['label'],
        },
      },
    },
  },
  scoringGuideDraft: {
    type: Type.OBJECT,
    properties: {
      instructions: { type: Type.STRING },
      maxScore: { type: Type.NUMBER },
    },
  },
};

const assessmentAIResponseSchema = {
  type: Type.ARRAY,
  items: {
    anyOf: [
      {
        type: Type.OBJECT,
        properties: {
          ...assessmentAICommonProperties,
          itemType: {
            type: Type.STRING,
            enum: [
              'MULTIPLE_CHOICE',
              'MULTIPLE_SELECT',
              'TRUE_FALSE',
              'SHORT_ANSWER',
              'ESSAY',
              'MATCHING',
              'CATEGORY_RESPONSE',
            ],
          },
          prompt: {
            type: Type.STRING,
          },
          stimulus: {
            type: Type.STRING,
          },
          stimulusSource: {
            type: Type.STRING,
          },
          options: {
            type: Type.ARRAY,
            minItems: 2,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                text: { type: Type.STRING },
                isCorrect: { type: Type.BOOLEAN },
              },
              required: ['text'],
            },
          },
          proposedAnswer: {
            type: Type.OBJECT,
            properties: {
              answerType: {
                type: Type.STRING,
                enum: [
                  'EXACT',
                  'OPTION',
                  'MULTIPLE_OPTION',
                  'EXPECTED_RESPONSE',
                  'MATCHING',
                  'CATEGORY_RESPONSE',
                ],
              },
              value: { type: Type.STRING },
              optionIndices: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
              },
              explanation: { type: Type.STRING },
            },
          },
        },
        required: ['coverageUnitId', 'itemType', 'prompt'],
      },

      {
        type: Type.OBJECT,
        properties: {
          ...assessmentAICommonProperties,
          taskTitle: {
            type: Type.STRING,
          },
          taskPrompt: {
            type: Type.STRING,
          },
          instructions: {
            type: Type.STRING,
          },
          expectedDeliverable: {
            type: Type.STRING,
          },
          aspects: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                description: { type: Type.STRING },
                weight: { type: Type.NUMBER },
              },
              required: ['label'],
            },
          },
        },
        required: ['coverageUnitId', 'taskPrompt'],
      },

      {
        type: Type.OBJECT,
        properties: {
          ...assessmentAICommonProperties,
          instructions: {
            type: Type.STRING,
          },
          evidenceRequirements: {
            type: Type.ARRAY,
            minItems: 1,
            items: {
              type: Type.STRING,
            },
          },
        },
        required: [
          'coverageUnitId',
          'evidenceRequirements',
        ],
      },

      {
        type: Type.OBJECT,
        properties: {
          ...assessmentAICommonProperties,
          instructions: {
            type: Type.STRING,
          },
          recordingScheme: {
            type: Type.STRING,
          },
          aspects: {
            type: Type.ARRAY,
            minItems: 1,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                indicator: { type: Type.STRING },
              },
              required: ['label'],
            },
          },
        },
        required: [
          'coverageUnitId',
          'aspects',
        ],
      },
    ],
  },
};

// Health check endpoint: same origin/process as the Step 4 API, never cached by preview intermediaries.
app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control','no-store');
  res.json({
    service: CP4_BACKEND_SERVICE,
    cpAnalysisProtocol: CP4_BACKEND_PROTOCOL,
    requestId: isCP4RequestId(req.get('X-CP4-Request-ID')) ? req.get('X-CP4-Request-ID') : undefined,
    status: 'ok',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
  });
});

// Official Education Reference School Search Endpoint
app.get('/api/schools/search', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const result = await OfficialEducationDataProvider.search(query);
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error('Error searching schools:', error);
    const message = error instanceof Error ? error.message : 'Gagal menghubungi data referensi sekolah';
    res.status(500).json({
      success: false,
      found: false,
      candidates: [],
      message: 'Tidak dapat menghubungi sumber data sekolah saat ini.',
      error: message,
    });
  }
});

// Automatic Principal Resolution & Verification Endpoint
app.post('/api/schools/resolve-principal', async (req, res) => {
  try {
    const { name, npsn, district, regency, province } = req.body || {};
    const result = await OfficialEducationDataProvider.resolvePrincipal({
      name: name || '',
      npsn: npsn || '',
      district: district || '',
      regency: regency || '',
      province: province || '',
    });
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error('Error resolving principal:', error);
    const message = error instanceof Error ? error.message : 'Gagal memverifikasi kepala sekolah';
    res.status(500).json({
      success: false,
      found: false,
      verificationStatus: 'unverified',
      message: 'Gagal menghubungi layanan verifikasi kepala sekolah saat ini.',
      error: message,
    });
  }
});

// Grounded Calendar Online Resolution Endpoint
app.post('/api/calendar/resolve', async (req, res) => {
  const { academicYear, province, regency } = req.body || {};

  // 1. Validation error -> HTTP 400
  if (!academicYear || typeof academicYear !== 'string' || academicYear.trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'Parameter permintaan kalender tidak valid (academicYear wajib diisi).',
    });
  }

  const searchRequest: CalendarSearchRequest = {
    academicYear: academicYear.trim(),
    province: typeof province === 'string' && province.trim() ? province.trim() : undefined,
    regency: typeof regency === 'string' && regency.trim() ? regency.trim() : undefined,
  };

  try {
    const provider = new TrustedCalendarSearchProvider();
    const searchResult = await provider.searchWithDiagnostics(searchRequest);
    const candidates = searchResult.candidates;
    const diagnostic = searchResult.diagnostic;

    const selectedSource = selectBestCalendarSource(candidates, searchRequest);

    let diagnosticMessage = '';
    switch (diagnostic.reason) {
      case 'SUCCESS':
        diagnosticMessage = 'Kalender Pendidikan resmi berhasil ditemukan dan diverifikasi secara online.';
        break;
      case 'NO_API_KEY':
        diagnosticMessage = 'Pencarian online memerlukan GEMINI_API_KEY yang terkonfigurasi di server.';
        break;
      case 'MODEL_FAILURE':
        diagnosticMessage = 'Layanan AI untuk pencarian kalender sedang tidak tersedia atau mencapai batas penggunaan. Silakan coba kembali.';
        break;
      case 'EMPTY_RESPONSE':
        diagnosticMessage = 'Pencarian berjalan tetapi tidak menghasilkan respons teks dari model pencarian.';
        break;
      case 'NO_GROUNDING':
        diagnosticMessage = 'Pencarian berjalan tetapi tidak menghasilkan sumber web ter-grounding.';
        break;
      case 'GROUNDING_RESOLUTION_FAILED':
        diagnosticMessage = 'Sumber ditemukan tetapi URL sumber tidak dapat diverifikasi ke domain resmi pemerintah (.go.id).';
        break;
      case 'CANDIDATE_REJECTED':
        diagnosticMessage = 'Kandidat kalender ditemukan tetapi tidak memenuhi syarat verifikasi domain resmi.';
        break;
      case 'NO_OFFICIAL_SOURCE':
        diagnosticMessage = 'Pencarian berhasil, tetapi sumber Kalender Pendidikan resmi belum ditemukan.';
        break;
      default:
        diagnosticMessage = 'Pencarian kalender online belum menghasilkan sumber resmi terverifikasi.';
    }

    if (!selectedSource) {
      return res.json({
        success: true,
        resolution: {
          status: 'UNRESOLVED',
          selectedSource: undefined,
          candidates,
          resolvedLevel: undefined,
          diagnostic,
          message: diagnosticMessage,
        },
      });
    }

    const status = evaluateCalendarCandidate(selectedSource);

    return res.json({
      success: true,
      resolution: {
        status,
        selectedSource,
        candidates,
        resolvedLevel: selectedSource.sourceLevel,
        diagnostic,
        message: diagnosticMessage,
      },
    });
  } catch (error: unknown) {
    console.error('Error in /api/calendar/resolve:', error);
    const message = error instanceof Error ? error.message : 'Gagal memproses resolusi kalender pendidikan';
    return res.status(500).json({
      success: false,
      error: message,
      resolution: {
        status: 'UNRESOLVED',
        candidates: [],
        message,
        diagnostic: {
          aiConfigured: Boolean(process.env.GEMINI_API_KEY),
          reason: 'MODEL_FAILURE',
          stages: [],
        },
      },
    });
  }
});

const cpStopWords = new Set([
  'peserta', 'didik', 'mampu', 'fase', 'elemen', 'cp', 'tp',
  'dan', 'atau', 'serta', 'yang', 'di', 'ke', 'dari', 'pada', 'dalam',
  'untuk', 'dengan', 'sebagai', 'oleh', 'tentang', 'bagi', 'secara',
  'baik', 'seperti', 'melalui', 'agar', 'supaya', 'harus', 'dapat',
  'akan', 'telah', 'adalah', 'merupakan', 'yaitu', 'yakni', 'dsb', 'dll',
  'pesertadidik', 'memahami', 'mempraktikkan', 'menerapkan', 'mengidentifikasi'
]);

function getSubstantiveTokens(text: string): string[] {
  if (!text) return [];
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.filter(w => w.length > 2 && !cpStopWords.has(w));
}

// 1. Endpoint: AI Analyze CP -> Return canonical CPAnalysisData items
app.post('/api/ai/analyze-cp', async (req, res) => {
  const apiKey = resolveApiKey(req);
  return serveCP4Analysis(req,res,apiKey,apiKey ? async (request,attempt) => {
    // Step 4 owns retries. Disable SDK retries and use the same pre-existing primary model.
    return createAIClient(apiKey).models.generateContent({model:attempt.model,contents:request.contents,
      config:{...request.config,abortSignal:attempt.signal,httpOptions:{timeout:attempt.timeoutMs,retryOptions:{attempts:1}}}});
  } : undefined);
});

// Diagnostic lightweight POST endpoint to verify POST routing and Express handling without calling Gemini
app.post('/api/ai/analyze-cp-ping', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const reqId = (req.headers['x-cp4-request-id'] as string) || 'ping-test';
  res.setHeader('X-CP4-Request-ID', reqId);
  res.setHeader('X-CP4-Service', CP4_BACKEND_SERVICE);
  res.json({
    status: 'ok',
    diagnostic: 'express_post_handler_reached',
    service: CP4_BACKEND_SERVICE,
    requestId: reqId,
    receivedBodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
    timestamp: new Date().toISOString(),
  });
});

// Runtime validator for AI TP response
function validateAITPPayload(data: any): { isValid: boolean; reason?: string } {
  if (!Array.isArray(data)) {
    return { isValid: false, reason: 'Payload AI bukan berupa array' };
  }
  if (data.length === 0) {
    return { isValid: false, reason: 'Hasil perumusan AI TP kosong' };
  }
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object') {
      return { isValid: false, reason: `Butir TP ke-${i + 1} bukan berupa objek valid` };
    }
    const statement = item.statement || item.description;
    if (!statement || typeof statement !== 'string' || statement.trim() === '') {
      return { isValid: false, reason: `Rumusan TP ke-${i + 1} kosong atau tidak valid` };
    }
  }
  return { isValid: true };
}

// 2. Endpoint: AI Generate TP from CP & CP Analysis
app.post('/api/ai/generate-tp', async (req, res) => {
  const {
    cpGeneral,
    cpElements,
    cpAnalysisItems = [],
    subject,
    grade,
    phase,
    curriculum,
  } = req.body || {};

  if (!cpGeneral && (!cpElements || cpElements.length === 0) && (!cpAnalysisItems || cpAnalysisItems.length === 0)) {
    return res.status(400).json({ error: 'Capaian Pembelajaran (CP) atau Analisis CP harus diisi terlebih dahulu' });
  }

  const validAnalysisItems = Array.isArray(cpAnalysisItems) ? cpAnalysisItems : [];
  const validAnalysisIdSet = new Set(validAnalysisItems.map((a: any) => String(a.id)).filter(Boolean));
  const analysisElemMap = new Map<string, string>();
  validAnalysisItems.forEach((a: any) => {
    if (a.id) {
      analysisElemMap.set(String(a.id), (a.elementId || a.elementName || '').toLowerCase().trim());
    }
  });

  const apiKey = resolveApiKey(req);
  if (apiKey) {
    try {
      const ai = createAIClient(apiKey);
      const prompt = `Anda adalah pakar perancangan kurikulum pendidikan nasional Indonesia (Kurikulum Merdeka).
Tugas Anda adalah merumuskan Tujuan Pembelajaran (TP) yang diturunkan melalui analisis pedagogis bertahap:
CP → Elemen CP → Analisis CP → Rumusan TP.

PRINSIP PEDAGOGIS & KONTRAK ATOMIK TP (WAJIB DIPATUHI - ATOMIC TP CONTRACT):
1. ATOMIC TP CONTRACT (1 TP = 1 TUJUAN PEMBELAJARAN SPESIFIK):
   - 1 butir Analisis CP menghasilkan TP spesifik.
   - JANGAN menggabungkan (merge) butir Analisis CP secara asal.
2. FOKUS TP (COMPETENCE-MATERIAL ALIGNMENT):
   - TP WAJIB memiliki kompetensi yang spesifik (bukan sekadar "Memahami & Menerapkan" global).
   - Gunakan kompetensi yang benar-benar dituntut oleh substansi materi TP.
   - JANGAN mengulang kompetensi yang sama dalam satu TP (misalnya: "menerapkan menerapkan").
   - Jika satu Analisis CP memiliki beberapa kompetensi/materi yang berbeda secara pedagogis, DEKOMPOSISI menjadi beberapa TP atomik terfokus.
   - Gabungan TP untuk SETIAP ID Analisis CP wajib mencakup seluruh kompetensi dan lingkupnya. Untuk Berbicara dan Mempresentasikan jangan berhenti pada berbicara: turunkan juga tuntutan presentasi, alasan, pilihan kata, gestur/intonasi atau tuntutan lain yang secara eksplisit terdapat dalam analisis sumber. Jangan menambah kompetensi di luar sumber.
3. FORMAT KODE TP:
   - Kontrak kanonikal: ${TP_CODE_FORMAT_DESCRIPTION}. Server membentuk kode secara deterministik; jangan menyalin scopeCode bersegmen seperti INF-LIS secara literal.
   - JANGAN sertakan kelas/fase dalam kode TP.

DATA PEMBELAJARAN:
- Mata Pelajaran: ${subject || '-'}
- Tingkat: ${grade || '-'} (${phase || '-'})
- Kurikulum: ${curriculum || 'Kurikulum Merdeka'}
- Deskripsi CP Umum: ${cpGeneral || '-'}
- Elemen-Elemen CP:
${
  cpElements && cpElements.length > 0
    ? cpElements.map((e: { code?: string; name: string; content: string }, idx: number) => `${idx + 1}. [Kode: ${e.code || `E${idx + 1}`}] [Elemen: ${e.name}]: ${e.content}`).join('\n')
    : 'Tidak ada rincian elemen.'
}
${
  validAnalysisItems.length > 0
    ? `\nHASIL ANALISIS CP (Rujukan Utama Kompetensi & Lingkup Materi):
${validAnalysisItems.map((a: any, idx: number) => `${idx + 1}. [ID: ${a.id}] [Elemen: ${a.elementName || '-'}] [ScopeCode: ${a.scopeCode || 'MAT'}] Kompetensi: "${a.cpCompetence || '-'}" | Materi: "${a.materialScope || '-'}" | Rekomendasi TP: "${a.suggestedTp || '-'}"`).join('\n')}`
    : ''
}

Lakukan analisis keterkaitan kurikulum dan rumuskan butir-butir TP yang koheren dan bermakna.
Kembalikan respon dalam format JSON sesuai schema:`;

      const response = await generateContentWithRetry(ai, {
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                code: { type: Type.STRING, description: 'Kode TP semantik misal E1-PGD-01, E2-PGD-01' },
                scopeCode: { type: Type.STRING, description: 'Kode ringkas 2-5 huruf kapital lingkup materi (misal PGD, AS)' },
                elementName: { type: Type.STRING, description: 'Nama Elemen CP yang menjadi rujukan' },
                statement: { type: Type.STRING, description: 'Rumusan kalimat Tujuan Pembelajaran lengkap' },
                competence: { type: Type.STRING, description: 'Kata Kerja Operasional / Kompetensi utama' },
                contentScope: { type: Type.STRING, description: 'Lingkup Materi / Topik Pembelajaran' },
                p3Dimensions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Dimensi Profil Lulusan yang diasah (1-3 dimensi)',
                },
                cpAnalysisItemIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Tepat 1 ID butir Analisis CP rujukan yang sah (array berisi tepat 1 ID)',
                },
              },
              required: ['code', 'scopeCode', 'elementName', 'statement', 'competence', 'contentScope', 'p3Dimensions', 'cpAnalysisItemIds'],
            },
          },
        },
      });

      const parsed = cleanAndParseJSON(response.text, null);
      const validation = validateAITPPayload(parsed);

      if (validation.isValid && Array.isArray(parsed)) {
        // Enforce strict Atomic Contract on AI output:
        // When CP Analysis items exist, every TP must contain EXACTLY 1 valid CPAnalysisItem ID.
        // If 0 IDs, >1 IDs, or invalid IDs, do not silently pick first ID or do positional fallback.
        // Fall back to pedagogical rule engine instead.
        let isAtomicContractValid = true;
        if (validAnalysisItems.length > 0) {
          for (const item of parsed) {
            const rawIds = Array.isArray(item.cpAnalysisItemIds) ? item.cpAnalysisItemIds : [];
            if (rawIds.length !== 1 || !validAnalysisIdSet.has(String(rawIds[0]))) {
              isAtomicContractValid = false;
              break;
            }
          }
        }

        if (!isAtomicContractValid) {
          console.warn('AI TP output failed atomic contract (each TP must reference exactly 1 valid CPAnalysisItem). Falling back to pedagogical engine.');
        } else {
          // AI chooses semantic content and exact source IDs; one shared service owns codes.
          const sanitizedItems = assignGeneratedTPCodes(parsed.map((item: any) => ({
            ...item,
            statement: (item.statement || item.description || '').replace(/\b([a-zA-Z]+)\s+\1\b/gi, '$1').replace(/\s+/g, ' ').trim(),
            cpAnalysisItemIds: item.cpAnalysisItemIds.map(String),
          })), validAnalysisItems, cpElements || []);

          const semanticFidelityCheck = checkTPSemanticFidelity(sanitizedItems, validAnalysisItems);
          if (!semanticFidelityCheck.isValid) {
            console.warn('AI TP output failed semantic fidelity guard:', semanticFidelityCheck.issues);
          } else {
            return res.json({ success: true, items: sanitizedItems, engine: 'gemini' });
          }
        }
      }
    } catch (error: any) {
      console.warn('Gemini generate TP failed, falling back to pedagogical engine:', error);
    }
  }

  // Fallback: Pedagogical Rule Engine
  const fallbackItems = fallbackGenerateTP({
    cpGeneral,
    cpElements,
    cpAnalysisItems: validAnalysisItems,
    subject,
    grade,
    phase,
    curriculum,
  });
  const fallbackFidelity = checkTPSemanticFidelity(fallbackItems, validAnalysisItems);
  if (!fallbackFidelity.isValid) return res.status(422).json({ success: false, code: 'TP_SOURCE_COVERAGE_INCOMPLETE', error: fallbackFidelity.issues.join('; ') });
  return res.json({ success: true, items: fallbackItems, engine: 'pedagogical_engine' });
});

// 3. Endpoint: AI Generate ATP from TP
app.post('/api/ai/generate-atp', async (req, res) => {
  const { tps, cpGeneral, subject, grade, phase, semester, academicYear, curriculum, totalHoursPerWeek } = req.body || {};

  // 1. Validate TP array prerequisite
  if (!tps || !Array.isArray(tps) || tps.length === 0) {
    return res.status(400).json({ error: 'Daftar Tujuan Pembelajaran (TP) harus diisi dan tidak boleh kosong sebelum menyusun ATP.' });
  }

  // 2. Validate Academic Context Prerequisites
  if (!subject || typeof subject !== 'string' || subject.trim() === '') {
    return res.status(400).json({ error: 'Mata pelajaran harus diisi sebelum menyusun ATP.' });
  }

  if (!grade || typeof grade !== 'string' || grade.trim() === '') {
    return res.status(400).json({ error: 'Kelas/tingkat harus diisi sebelum menyusun ATP.' });
  }

  const isK13 = (curriculum && String(curriculum).toUpperCase().includes('K13')) || (curriculum && String(curriculum).toUpperCase().includes('2013'));
  if (!isK13) {
    if (!phase || typeof phase !== 'string' || phase.trim() === '') {
      return res.status(400).json({ error: 'Fase harus diisi untuk Kurikulum Merdeka sebelum menyusun ATP.' });
    }
  }

  if (!academicYear || typeof academicYear !== 'string' || academicYear.trim() === '') {
    return res.status(400).json({ error: 'Tahun ajaran/akademik harus diisi sebelum menyusun ATP.' });
  }

  if (isK13) {
    if (!semester || typeof semester !== 'string' || semester.trim() === '') {
      return res.status(400).json({ error: 'Semester harus diisi sebelum menyusun ATP.' });
    }
  }

  // 3. Validate totalHoursPerWeek if provided (No silent default, no fake JP assumption)
  let validatedWeeklyJP: number | undefined = undefined;
  if (totalHoursPerWeek !== undefined && totalHoursPerWeek !== null) {
    const isNumType = typeof totalHoursPerWeek === 'number';
    const isStringType = typeof totalHoursPerWeek === 'string';
    const parsed = isNumType
      ? totalHoursPerWeek
      : isStringType && totalHoursPerWeek.trim() !== ''
        ? Number(totalHoursPerWeek)
        : NaN;

    if (
      !Number.isFinite(parsed) ||
      isNaN(parsed) ||
      parsed <= 0 ||
      !Number.isInteger(parsed)
    ) {
      return res.status(400).json({
        error: 'Alokasi jam per minggu (totalHoursPerWeek) jika diisi harus berupa bilangan bulat positif yang valid (misal: 1, 2, 4, 5).',
      });
    }
    validatedWeeklyJP = parsed;
  }

  // 4. Check AI configuration (GEMINI_API_KEY or BYOK header)
  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      code: 'AI_NOT_CONFIGURED',
      error: 'Layanan AI belum dikonfigurasi pada server.',
    });
  }

  try {
    const ai = createAIClient(apiKey);
    const prompt = `Anda adalah spesialis penyusun Alur Tujuan Pembelajaran (ATP) Kurikulum Merdeka.
Tugas Anda adalah merumuskan Alur Tujuan Pembelajaran (ATP) dengan mengelompokkan dan mengurutkan Tujuan Pembelajaran (TP) atomik secara pedagogis logis:

DATA PEMBELAJARAN:
- Mata Pelajaran: ${subject || '-'}
- Kelas / Fase: ${grade || '-'} / ${phase || '-'}
${isK13 ? `- Tahun Ajaran / Semester: ${academicYear || '-'} / ${semester || '-'}` : `- Tahun Ajaran: ${academicYear || '-'}`}
- Rujukan CP: ${cpGeneral || '-'}

DAFTAR TP ATOMIK YANG SUDAH DIBUAT (Gunakan persis nilai [TP_ID: ...] ke dalam linkedTpIds):
${tps
  .map(
    (tp: { id: string; code: string; statement: string; competence?: string; contentScope?: string; p3Dimensions?: string[] }) =>
      `- [TP_ID: ${tp.id}] [TP_CODE: ${tp.code || '-'}] Rumusan: "${tp.statement}" (Materi: "${tp.contentScope || '-'}", Kompetensi: "${tp.competence || '-'}")`
  )
  .join('\n')}

PRINSIP & INSTRUKSI PENYUSUNAN ATP MULTI-TP (CANONICAL):
1. Pengelompokan (Grouping): Satu langkah ATP (ATP Step) dapat merujuk 1 atau beberapa (1..n) TP atomik yang secara pedagogis masuk akal dan koheren dipelajari bersama dalam satu alur (misal: memadukan pemahaman konsep dengan penerapan, atau menautkan kompetensi konten dengan dimensi penguatan karakter).
2. Pengurutan (Sequencing): Urutkan kelompok langkah pembelajaran secara pedagogis logis (misal dari konkret ke abstrak, mudah ke sukar, atau hierarki keterampilan).
    3. Fokus Langkah (Focus): Tentukan ringkasan fokus capaian/pembelajaran untuk setiap langkah alur.
       - SETIAP fokus WAJIB menunjukkan:
         a. Substansi/materi TP yang ditautkan.
         b. Kompetensi atau tindakan pembelajaran yang dapat dikenali untuk setiap TP tertaut.
         c. Kesetaraan makna kompetensi; tidak harus menyalin seluruh kalimat TP, namun tindakan spesifik harus terlihat jelas (misalnya: "Mempraktikkan" harus tampak sebagai praktik/demonstrasi).
         d. Kata kerja spesifik seperti "Menjaga", "Mengenali", "Menerapkan", "Mengeksplorasi", dan "Berpartisipasi" tidak boleh direduksi menjadi frasa umum (misal: "memahami kesehatan" dilarang). JANGAN mengulang kata kerja dalam satu rumusan TP (misalnya: "menerapkan menerapkan").
       - Jika satu langkah menggabungkan beberapa TP:
         a. Semua TP tertaut harus terwakili secara substantif dalam fokus.
         b. Kompetensi berbeda harus tetap terlihat, termasuk tindakan majemuk.
         c. Jika penggabungan membuat fokus terlalu umum/kabur, lebih baik pisahkan menjadi langkah ATP yang lebih koheren.
       - Sebelum mengembalikan JSON, periksa kembali apakah fokus telah benar-benar mewakili kompetensi dan materi dari setiap TP yang tertaut.
4. INTEGRITAS RUJUKAN KETAT:
   - Setiap elemen dalam array 'linkedTpIds' WAJIB sama persis dengan string [TP_ID: ...] dari daftar input di atas. JANGAN gunakan kode TP, nomor urut, atau rumusan teks sebagai ID.
   - JANGAN ada duplikasi TP ID di dalam langkah yang sama.
   - Seluruh TP atomik dari daftar input WAJIB dimasukkan ke dalam minimal satu langkah ATP. Tidak boleh ada TP yang tertinggal.
   - Satu TP boleh masuk ke lebih dari satu langkah jika relevan dipelajari berkesinambungan.
   - JANGAN menentukan Bab atau Unit Pembelajaran pada tahap ini.
   - JANGAN menentukan Alokasi Waktu (JP).
5. Buat rasionalisasi alur pembelajaran secara komprehensif pada root 'rationale'.

Kembalikan output JSON sesuai schema:`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rationale: {
              type: Type.STRING,
              description: 'Penjelasan rasional mengapa alur TP dikelompokkan dan diurutkan dalam urutan ini.',
            },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  stepNumber: { type: Type.INTEGER, description: 'Urutan alur pembelajaran (1, 2, 3...)' },
                  linkedTpIds: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Daftar persis TP_ID rujukan dari daftar input yang dipelajari pada langkah ini (1..n TP)',
                  },
                  focus: { type: Type.STRING, description: 'Ringkasan fokus pedagogis langkah pembelajaran' },
                },
                required: [
                  'stepNumber',
                  'linkedTpIds',
                  'focus',
                ],
              },
            },
          },
          required: ['rationale', 'items'],
        },
      },
    });

    const parsed = cleanAndParseJSON(response.text, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.status(500).json({ error: 'Respons AI tidak memenuhi kualifikasi struktur ATP: Respons bukan berupa objek valid' });
    }

    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      return res.status(500).json({ error: 'Respons AI tidak memenuhi kualifikasi struktur ATP: Hasil perumusan alur TP kosong atau bukan array' });
    }

    // Build canonical TP map by exact ID only
    const tpMapById = new Map<string, any>();
    tps.forEach((tp: any) => {
      if (tp.id) tpMapById.set(tp.id, tp);
    });

    const resolvedItems: Array<{ stepNumber: number; linkedTpIds: string[]; focus: string }> = [];
    const coveredTpIds = new Set<string>();

    for (let i = 0; i < parsed.items.length; i++) {
      const item = parsed.items[i];
      if (!item || typeof item !== 'object') {
        return res.status(500).json({ error: `Respons AI tidak memenuhi kualifikasi struktur ATP: Butir langkah ATP ke-${i + 1} bukan berupa objek valid` });
      }

      if (!Array.isArray(item.linkedTpIds) || item.linkedTpIds.length === 0) {
        return res.status(500).json({
          error: `Respons AI tidak sah: Langkah ke-${i + 1} tidak memiliki array linkedTpIds yang valid.`
        });
      }

      const validStepTpIds: string[] = [];
      const seenInStep = new Set<string>();

      for (const rawId of item.linkedTpIds) {
        if (typeof rawId !== 'string' || rawId.trim() === '') {
          return res.status(500).json({
            error: `Respons AI tidak sah: Langkah ke-${i + 1} memiliki rujukan TP ID yang kosong atau bukan string.`
          });
        }
        const trimmedId = rawId.trim();

        // Duplicate check within same step: duplicate is strictly invalid
        if (seenInStep.has(trimmedId)) {
          return res.status(500).json({
            error: `Respons AI tidak sah: Langkah ke-${i + 1} mengandung duplikasi TP ID "${trimmedId}" dalam langkah yang sama.`
          });
        }
        seenInStep.add(trimmedId);

        // Strict exact ID lookup: NO fallback to tpCode, statement, positional, or first match
        if (!tpMapById.has(trimmedId)) {
          return res.status(500).json({
            error: `Respons AI tidak sah: Langkah ke-${i + 1} merujuk ke TP ID "${trimmedId}" yang tidak ditemukan pada daftar input guru.`
          });
        }

        validStepTpIds.push(trimmedId);
        coveredTpIds.add(trimmedId);
      }

      const focus = typeof item.focus === 'string' ? item.focus.trim() : '';
      if (!focus) {
        return res.status(500).json({
          error: `Respons AI tidak sah: Langkah ke-${i + 1} belum memiliki rumusan 'focus' langkah pembelajaran.`
        });
      }

      resolvedItems.push({
        stepNumber: i + 1,
        linkedTpIds: validStepTpIds,
        focus,
      });
    }

    // Strict TP Coverage Guarantee: ALL input TPs must be covered; missing coverage is strictly invalid
    const missingTps = tps.filter((tp: any) => tp.id && !coveredTpIds.has(tp.id));
    if (missingTps.length > 0) {
      const missingDetails = missingTps.map((t: any) => `[${t.code || t.id}]`).join(', ');
      return res.status(500).json({
        error: `Respons AI tidak sah: Terdapat ${missingTps.length} TP yang belum tercakup dalam alur ATP: ${missingDetails}. Seluruh TP input wajib tercakup.`
      });
    }

    const semanticCheck = validateATPGeneratedItemsSemanticFidelity(resolvedItems, tps);
    if (!semanticCheck.isValid) {
      // FIX C: Single targeted recovery for steps with semantic mismatch
      const recoveredItems = resolvedItems.map((item) => {
        const stepTps = item.linkedTpIds.map((id) => tpMapById.get(id)).filter(Boolean);
        const check = checkATPSemanticFidelity(item.focus, stepTps);
        if (check.isValid) return item;

        // Reconstruct coherent focus from the linked canonical TPs
        const tpScopes = stepTps.map((t) => t.contentScope || t.statement).filter(Boolean);
        const tpCompetences = stepTps.map((t) => t.competence).filter(Boolean);
        const primaryComp = tpCompetences[0] || 'Penguasaan';
        const primaryScope = tpScopes.join(' dan ');
        const repairedFocus = `${primaryComp} ${primaryScope}`.replace(/\s+/g, ' ').trim();

        return {
          ...item,
          focus: repairedFocus,
        };
      });

      // Strict re-validation of ALL items with production validator
      const recheck = validateATPGeneratedItemsSemanticFidelity(recoveredItems, tps);
      if (recheck.isValid) {
        resolvedItems.splice(0, resolvedItems.length, ...recoveredItems);
      } else {
        return res.status(500).json({
          error: `Respons AI tidak sah secara semantic fidelity ATP: ${semanticCheck.reason || recheck.reason || 'Fokus ATP tidak sesuai dengan TP canonical tertaut.'}`
        });
      }
    }

    parsed.items = resolvedItems;

    return res.json({ success: true, data: parsed, engine: 'gemini' });
  } catch (error: any) {
    console.error('Gemini ATP generation failed:', error);
    const isAuth = error?.status === 401 || error?.status === 403 ||
      (error?.message && (error.message.includes('API_KEY_INVALID') || error.message.includes('API key not valid')));
    return res.status(isAuth ? (error.status || 401) : 500).json({
      error: `Gagal menyusun ATP dengan AI: ${error.message || 'Respons provider AI tidak dapat diproses'}`,
      code: isAuth ? 'INVALID_API_KEY' : undefined,
    });
  }
});

// 3b. Endpoint: AI Generate ATP Unit/Bab Mapping
app.post('/api/ai/generate-atp-mapping', async (req, res) => {
  const {
    atpItems,
    subject,
    grade,
    phase,
    targetUnitCount = 6,
    teacherUnits = [],
  } = req.body || {};

  if (!Array.isArray(atpItems) || atpItems.length === 0) {
    return res.status(400).json({ error: 'Daftar langkah ATP tidak boleh kosong.' });
  }

  const unitCount = Math.max(1, Math.min(20, Number(targetUnitCount) || 6));

  // Build teacher unit constraints map
  const teacherUnitMap: Record<number, string> = {};
  if (Array.isArray(teacherUnits)) {
    teacherUnits.forEach((u: any) => {
      if (u && typeof u.unitIndex === 'number' && typeof u.unitTitle === 'string' && u.unitTitle.trim().length > 0) {
        teacherUnitMap[u.unitIndex] = u.unitTitle.trim();
      }
    });
  }

  // Check AI configuration (GEMINI_API_KEY or BYOK header)
  const apiKey = resolveApiKey(req);
  if (apiKey) {
    try {
      const ai = createAIClient(apiKey);
      const prompt = `Anda adalah pakar kurikulum dan pengembang perangkat pembelajaran Kurikulum Merdeka.
Tugas Anda adalah melakukan pemetaan Unit/Bab (Unit Mapping) dan Lingkup Materi untuk setiap butir langkah Alur Tujuan Pembelajaran (ATP) berikut.

DATA PEMBELAJARAN:
- Mata Pelajaran: ${subject || '-'}
- Kelas / Fase: ${grade || '-'} (${phase || '-'})
- Target Jumlah Bab / Unit Pembelajaran: ${unitCount} Bab

ATURAN DAN BATASAN DARI GURU (WAJIB DIPATUHI SECARA MUTLAK):
1. Target jumlah Bab adalah ${unitCount} Bab (Bab 1 s.d. Bab ${unitCount}).
${
  Object.keys(teacherUnitMap).length > 0
    ? `2. Nama Bab yang SUDAH DITETAPKAN OLEH GURU (JANGAN DIUBAH SAMA SEKALI, GUNAKAN PERSIS SAMA):\n${Object.entries(
        teacherUnitMap
      )
        .map(([idx, title]) => `   - Bab ${idx}: "${title}"`)
        .join('\n')}\n3. Untuk Bab yang belum dinamai oleh guru, usulkan judul Bab yang kontekstual, menarik, dan sesuai materi Kurikulum Merdeka.`
    : `2. Usulkan nama Bab yang menarik, ringkas, dan relevan dengan materi pelajaran untuk Bab 1 s.d. Bab ${unitCount} (misal: "Bab 1: Menjelajah Teks Deskripsi", "Bab 2: Mengungkap Fakta dalam Berita", dsb).`
}
4. Setiap langkah ATP harus dipetakan ke salah satu Bab secara kronologis dan berkesinambungan. Urutan langkah ATP (Step 1 s.d. Step ${atpItems.length}) harus berurutan secara logis dalam Bab yang bertahap (Bab 1, Bab 2, dst).
5. Tentukan Lingkup Materi / Topik Pembelajaran yang spesifik dan bernas untuk tiap langkah ATP.
${
  atpItems.some((it: any) => it.unitTitle || it.materialScope)
    ? `6. Nilai yang sudah diisi oleh guru pada butir ATP tertentu (ditandai dengan [Kustom Guru]) harus dipertahankan dan diutamakan.`
    : ''
}

DAFTAR LANGKAH ATP YANG HARUS DIPETAKAN:
${atpItems
  .map(
    (item: any, idx: number) =>
      `${idx + 1}. [ID: ${item.id}] Langkah #${item.stepNumber || idx + 1} (Kode TP: ${item.tpCode || '-'}): "${
        item.tpStatement || '-'
      }" ${item.tpContentScope ? `[Lingkup Materi TP Asli: "${item.tpContentScope}"]` : ''} ${
        item.unitTitle ? `[Kustom Guru Unit: "${item.unitTitle}"]` : ''
      } ${item.materialScope ? `[Kustom Guru Materi: "${item.materialScope}"]` : ''}`
  )
  .join('\n')}

Kembalikan output JSON sesuai skema:
- units: daftar ${unitCount} Bab beserta nomor unitIndex (1..${unitCount}) dan judul unitTitle.
- mappings: daftar pemetaan untuk setiap langkah ATP dengan atpItemId (merujuk ID langkah ATP di atas), unitTitle, dan materialScope.`;

      const response = await generateContentWithRetry(ai, {
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              units: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    unitIndex: { type: Type.INTEGER },
                    unitTitle: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['unitIndex', 'unitTitle'],
                },
              },
              mappings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    atpItemId: { type: Type.STRING },
                    unitTitle: { type: Type.STRING },
                    materialScope: { type: Type.STRING },
                  },
                  required: ['atpItemId', 'unitTitle', 'materialScope'],
                },
              },
            },
            required: ['units', 'mappings'],
          },
        },
      });

      const parsed = cleanAndParseJSON(response.text, null);
      if (parsed && Array.isArray(parsed.mappings) && parsed.mappings.length > 0) {
        // Enforce teacher unit titles on the units list
        const finalUnits = (parsed.units || []).map((u: any, idx: number) => {
          const uIdx = u.unitIndex || idx + 1;
          const teacherTitle = teacherUnitMap[uIdx];
          return {
            unitIndex: uIdx,
            unitTitle: teacherTitle || u.unitTitle || `Bab ${uIdx}`,
            description: u.description || '',
          };
        });

        // If units count was less than unitCount, fill missing
        for (let i = 1; i <= unitCount; i++) {
          if (!finalUnits.some((u: any) => u.unitIndex === i)) {
            finalUnits.push({
              unitIndex: i,
              unitTitle: teacherUnitMap[i] || `Bab ${i}`,
              description: '',
            });
          }
        }
        finalUnits.sort((a: any, b: any) => a.unitIndex - b.unitIndex);

        return res.json({
          success: true,
          data: {
            units: finalUnits,
            mappings: parsed.mappings,
          },
          engine: 'gemini',
        });
      }
    } catch (error: any) {
      console.warn('Gemini ATP mapping generation failed, using pedagogical rule fallback:', error);
    }
  }

  // Fallback: Pedagogical Rule-Based Mapping Engine
  const fallback = fallbackGenerateATPMapping({
    atpItems,
    targetUnitCount: unitCount,
    teacherUnits: teacherUnitMap,
    subject,
  });

  return res.json({ success: true, data: fallback, engine: 'pedagogical_engine' });
});

function extractKeywords(text: string): string[] {
  if (!text) return [];
  const STOPWORDS = new Set([
    'dan', 'atau', 'pada', 'dalam', 'dengan', 'untuk', 'secara', 'yang', 'serta',
    'dapat', 'mampu', 'peserta', 'didik', 'siswa', 'murid', 'pembelajaran', 'materi',
    'konsep', 'memahami', 'mengidentifikasi', 'menjelaskan', 'mempraktikkan', 'menganalisis',
    'merancang', 'melakukan', 'tentang', 'terhadap', 'sebagai', 'melalui', 'proses',
    'tahap', 'bagian', 'berbagai', 'macam', 'jenis', 'dasar', 'awal', 'akhir', 'menggunakan'
  ]);
  const clean = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  const tokens = clean.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens));
}

function isCrossCuttingTp(tp?: any): boolean {
  if (!tp) return false;
  const full = `${tp.statement || ''} ${tp.contentScope || ''} ${tp.elementName || ''}`.toLowerCase();

  // Independent substantive topics must NOT be treated as cross-cutting:
  // e.g. kesehatan, keselamatan diri, pertolongan pertama, privasi tubuh, nutrisi, kebersihan
  const isExplicitSubstantiveTopic =
    full.includes('keselamatan diri') ||
    full.includes('pertolongan pertama') ||
    full.includes('privasi tubuh') ||
    full.includes('kesehatan reproduksi') ||
    full.includes('kebersihan diri') ||
    full.includes('pola makan sehat') ||
    full.includes('penyakit menular');

  if (isExplicitSubstantiveTopic) {
    return false;
  }

  return (
    full.includes('profil pelajar pancasila') ||
    full.includes('profil lulusan') ||
    full.includes('karakter') ||
    full.includes('tanggung jawab') ||
    full.includes('refleksi') ||
    full.includes('evaluasi diri') ||
    full.includes('sikap') ||
    full.includes('kolaborasi') ||
    full.includes('gotong royong') ||
    full.includes('akhlak')
  );
}

function findBestExistingUnitMatch(u: any, existingUnits: any[]): any {
  if (!Array.isArray(existingUnits) || existingUnits.length === 0) return null;

  // 1. Exact existing id
  if (u.id) {
    const match = existingUnits.find(eu => eu.id === u.id);
    if (match) return match;
  }

  // 2. Highest overlap of linkedAtpItemIds / linkedTpIds
  let bestMatch: any = null;
  let maxOverlap = 0;

  const uAtpIds = new Set(u.linkedAtpItemIds || []);
  const uTpIds = new Set(u.linkedTpIds || []);

  for (const eu of existingUnits) {
    let overlapCount = 0;
    
    if (Array.isArray(eu.linkedAtpItemIds)) {
      eu.linkedAtpItemIds.forEach((id: string) => {
        if (uAtpIds.has(id)) overlapCount += 3; // higher weight for exact ATP step match
      });
    }
    if (Array.isArray(eu.linkedTpIds)) {
      eu.linkedTpIds.forEach((id: string) => {
        if (uTpIds.has(id)) overlapCount += 1;
      });
    }

    if (overlapCount > maxOverlap) {
      maxOverlap = overlapCount;
      bestMatch = eu;
    }
  }

  if (maxOverlap > 0) return bestMatch;

  // 3. Semantic title match (using keyword similarity)
  let bestTitleMatch: any = null;
  let maxTitleSimilarity = 0.4; // minimum similarity threshold

  const normTitleU = (u.title || '').toLowerCase().replace(/^(bab|unit)\s*\d*[:\-]?\s*/i, '').trim();
  const kwU = extractKeywords(normTitleU);

  for (const eu of existingUnits) {
    const normTitleEU = (eu.title || '').toLowerCase().replace(/^(bab|unit)\s*\d*[:\-]?\s*/i, '').trim();
    if (normTitleU === normTitleEU) return eu; // exact clean title match

    const kwEU = extractKeywords(normTitleEU);
    const overlap = kwU.filter(k => kwEU.includes(k));
    const similarity = overlap.length / Math.max(1, Math.max(kwU.length, kwEU.length));
    
    if (similarity > maxTitleSimilarity) {
      maxTitleSimilarity = similarity;
      bestTitleMatch = eu;
    }
  }

  return bestTitleMatch;
}

function findBestExistingMaterialMatch(m: any, existingMaterials: any[]): any {
  if (!Array.isArray(existingMaterials) || existingMaterials.length === 0) return null;

  // 1. Exact existing id
  if (m.id) {
    const match = existingMaterials.find(em => em.id === m.id);
    if (match) return match;
  }

  // 2. Highest overlap of linkedAtpItemIds / linkedTpIds
  let bestMatch: any = null;
  let maxOverlap = 0;

  const mAtpIds = new Set(m.linkedAtpItemIds || []);
  const mTpIds = new Set(m.linkedTpIds || []);

  for (const em of existingMaterials) {
    let overlapCount = 0;
    if (Array.isArray(em.linkedAtpItemIds)) {
      em.linkedAtpItemIds.forEach((id: string) => {
        if (mAtpIds.has(id)) overlapCount += 3;
      });
    }
    if (Array.isArray(em.linkedTpIds)) {
      em.linkedTpIds.forEach((id: string) => {
        if (mTpIds.has(id)) overlapCount += 1;
      });
    }

    if (overlapCount > maxOverlap) {
      maxOverlap = overlapCount;
      bestMatch = em;
    }
  }

  if (maxOverlap > 0) return bestMatch;

  // 3. Semantic title match
  let bestTitleMatch: any = null;
  let maxTitleSimilarity = 0.4;

  const normTitleM = (m.title || '').toLowerCase().trim();
  const kwM = extractKeywords(normTitleM);

  for (const em of existingMaterials) {
    const normTitleEM = (em.title || '').toLowerCase().trim();
    if (normTitleM === normTitleEM) return em;

    const kwEM = extractKeywords(normTitleEM);
    const overlap = kwM.filter(k => kwEM.includes(k));
    const similarity = overlap.length / Math.max(1, Math.max(kwM.length, kwEM.length));

    if (similarity > maxTitleSimilarity) {
      maxTitleSimilarity = similarity;
      bestTitleMatch = em;
    }
  }

  return bestTitleMatch;
}

// 3c. Endpoint: Canonical AI Generate ATPUnitMappingData (Multi-Material & Semantic Bab Clustering)
app.post('/api/ai/generate-canonical-atp-unit-mapping', async (req, res) => {
  const {
    academicSettingId = '',
    subject = 'Mata Pelajaran',
    grade = '',
    phase = '',
    tpData,
    atpData,
    cpAnalysisData,
    existingMapping,
    targetUnitCount,
    targetMaterialCountPerUnit,
  } = req.body || {};

  const validTpItems = Array.isArray(tpData?.items) ? tpData.items : [];
  const validTpIdSet = new Set<string>(
    validTpItems
      .map((tp: any) => tp.id)
      .filter((id: any): id is string => typeof id === 'string' && id.trim().length > 0)
  );
  const validAtpItems = Array.isArray(atpData?.items)
    ? [...atpData.items].sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0))
    : [];

  if (validTpItems.length === 0 || validAtpItems.length === 0) {
    return res.status(400).json({ error: 'Data TP dan ATP tidak boleh kosong untuk menyusun pemetaan unit.' });
  }

  const tpMap = new Map<string, (typeof validTpItems)[0]>();
  validTpItems.forEach((tp) => tpMap.set(tp.id, tp));

  const atpMap = new Map<string, (typeof validAtpItems)[0]>();
  validAtpItems.forEach((atp) => atpMap.set(atp.id, atp));

  if (targetUnitCount !== undefined && (!Number.isInteger(targetUnitCount) || targetUnitCount < 1 || targetUnitCount > 20)) {
    return res.status(400).json({ error: 'Target jumlah Bab harus bilangan bulat 1–20.' });
  }
  const count = targetUnitCount;

  const apiKey = resolveApiKey(req);
  if (apiKey) {
    try {
      const ai = createAIClient(apiKey);

      const prompt = `Anda adalah pakar pengembang kurikulum dan perangkat pembelajaran Kurikulum Merdeka.
TUGAS ANDA: Melakukan pengelompokan tematis (Semantic Clustering) butir-butir Tujuan Pembelajaran (TP) dan Alur Tujuan Pembelajaran (ATP) ke dalam Unit / Bab Pembelajaran yang bermakna dari nol, serta mendekomposisi setiap Bab menjadi beberapa Lingkup Materi Inti.

PRINSIP & ATURAN GENERATOR CANONICAL (WAJIB DIPATUHI):
1. KONTRAK MULTI-TP ATP: Satu langkah ATP (ATP Step) dapat menaungi SATU ATAU LEBIH (1..n) TP atomik pada 'linkedTpIds'. Anda HARUS mempertimbangkan SELURUH TP tertaut pada setiap langkah ATP secara bersamaan (bukan hanya TP pertama).
2. KRONOLOGI & CONTINUITY: ATP adalah unit urutan dan otoritas kronologi (stepNumber). Urutan Bab harus menjaga kesinambungan kronologi langkah ATP secara logis (misal: Bab 1 memuat ATP 1,2,3; Bab 2 memuat ATP 4,5; dst).
3. DUKUNGAN MULTI-BAB & SUBSET TP: Satu langkah ATP DAPAT MENDUKUNG BEBERAPA BAB (1..n Bab). Hal ini terutama diperbolehkan dan dianjurkan jika langkah ATP tersebut membawa beberapa TP dengan lingkup materi/topik yang berbeda (misalnya TP 1 dan 2 masuk Bab 2, sedangkan TP 3 masuk Bab 3). Setiap Bab memilih subset TP yang autentik dan relevan dari ATP tersebut. JANGAN menyalin seluruh TP milik suatu ATP ke semua Bab yang memuat ATP itu. ATP boleh diulang lintas Bab.
4. INTEGRASI TP CROSS-CUTTING / TRANSVERSAL:
   a. Bedakan TP substantif (materi/keterampilan inti spesifik) dan TP cross-cutting/transversal (misalnya karakter, sikap, tanggung jawab, kolaborasi, refleksi, evaluasi diri, gotong royong, dimensi profil pelajar/lulusan).
   b. TP karakter/sikap/kolaborasi/tanggung jawab/refleksi TIDAK OTOMATIS MEMBENTUK BAB SENDIRI jika kompetensi tersebut dapat diintegrasikan secara autentik ke dalam Bab substantif (contoh pada PJOK: TP karakter dan tanggung jawab diintegrasikan ke Bab praktik gerak/permainan/olahraga, BUKAN menjadi Bab 'Membangun Karakter' terpisah).
   c. Integrasikan TP cross-cutting ke Bab substantif tempat kompetensi tersebut dapat diwujudkan dan diamati secara autentik dalam aktivitas pembelajaran.
   d. Satu ATP/TP cross-cutting diperbolehkan dan dianjurkan mendukung lebih dari satu Bab jika memang relevan dengan konteks kegiatan di bab-bab tersebut.
   e. Jangan menyalin cross-cutting TP ke semua Bab secara membabi buta tanpa relevansi nyata.
   f. Bab mandiri HANYA BOLEH dibentuk jika TP mempunyai content domain substantif independen (misalnya keselamatan diri, pertolongan pertama, kesehatan diri, privasi tubuh), bukan semata perilaku transversal.
   g. Saat menentukan judul Bab, utamakan topik/domain dari TP substantif (bukan rumusan karakter/refleksi transversal).
5. CAKUPAN GLOBAL (GLOBAL LINEAGE COVERAGE): Seluruh ATP dan TP canonical harus ter-cover secara global. Setiap ATP canonical minimal harus muncul pada satu Bab, dan gabungan (union) TP dari seluruh Bab yang memuat ATP tersebut harus mencakup seluruh TP canonical milik ATP tersebut tanpa ada TP yang tertinggal.
6. SETIAP BAB & MATERI WAJIB MEMILIKI LINEAGE: Setiap Unit/Bab WAJIB memiliki 'linkedAtpItemIds' (non-empty) dan 'linkedTpIds' (non-empty). Setiap Lingkup Materi dalam Bab WAJIB memiliki 'linkedAtpItemIds' (subset dari ATP Bab) dan 'linkedTpIds' (subset dari TP Bab yang didukung oleh ATP materi tersebut). JANGAN membuat materi generik kosong tanpa relasi TP/ATP.
7. INTEGRITAS RUJUKAN: Setiap relasi linkedTpIds dan linkedAtpItemIds WAJIB menggunakan persis string ID input ([TP_ID: ...] dan [ATP_ID: ...]). JANGAN membuat TP atau ATP fiktif.
8. JANGAN menentukan alokasi JP, semester, pertemuan, rencana asesmen, atau Modul Ajar/LearningPlan pada tahap ini.
9. ${
  count
    ? `Jumlah Bab wajib TEPAT ${count} Bab. Jika tidak dapat disusun dengan lineage autentik dan cakupan penuh, jangan klaim hasil lengkap.`
    : `Jumlah Bab ditentukan secara alami berdasarkan kesamaan semantik (Semantic Clustering) dari materi TP/ATP tanpa memaksakan jumlah tertentu.`
}

DATA KURIKULUM:
WAJIB PER BAB: gabungan linkedTpIds dan linkedAtpItemIds seluruh Lingkup Materi harus mencakup SEMUA TP/ATP Bab tersebut. Setiap relasi harus relevan terhadap substansi materi; jangan menempelkan ID hanya untuk memenuhi cakupan. Jika tidak dapat direpresentasikan secara pedagogis, jangan klaim lengkap.
- Mata Pelajaran: ${subject}
- Kelas / Fase: ${grade} (${phase})
${count ? `- Target Jumlah Bab: ${count} Bab` : '- Target Jumlah Bab: Sesuai keselarasan semantis alami'}

DAFTAR TUJUAN PEMBELAJARAN (TP CANONICAL):
${validTpItems
  .map(
    (tp, i) => {
      const isCC = isCrossCuttingTp(tp);
      return `${i + 1}. [TP_ID: ${tp.id}] Kode: ${tp.code || `TP-${i + 1}`} | Kategori: ${isCC ? 'CROSS-CUTTING / TRANSVERSAL' : 'SUBSTANTIF'} | ScopeCode: ${tp.scopeCode || 'MAT'} | Elemen: ${tp.elementName || '-'} | Rumusan: "${
        tp.statement
      }" | Lingkup Materi: "${tp.contentScope || '-'}" | Kompetensi: "${tp.competence || '-'}"`;
    }
  )
  .join('\n')}

DAFTAR ALUR TUJUAN PEMBELAJARAN (ATP CANONICAL) SECARA KRONOLOGIS:
${validAtpItems
  .map((atp, i) => {
    const resolvedTpIds = resolveCanonicalAtpTpIds(atp, validTpIdSet);
    const tpDetails = resolvedTpIds
      .map((id) => {
        const t = tpMap.get(id);
        return `   - [TP_ID: ${id}] (${t?.code || 'TP'}): "${t?.statement || '-'}" (Materi: "${t?.contentScope || '-'}", ScopeCode: "${t?.scopeCode || '-'}")`;
      })
      .join('\n');
    return `Langkah #${atp.stepNumber || i + 1}
[ATP_ID: ${atp.id}]
Fokus: ${atp.focus || '-'}
TP Tertaut:
${tpDetails || '   - (Tidak ada TP)'}`;
  })
  .join('\n\n')}
${
  Array.isArray(cpAnalysisData?.items) && cpAnalysisData.items.length > 0
    ? `\nKONTEKS ANALISIS CP (REFERENSI PENDUKUNG):\n${cpAnalysisData.items
        .map(
          (cpa, i) =>
            `${i + 1}. Elemen: ${cpa.elementName} | Kompetensi: ${cpa.cpCompetence} | Lingkup Materi: ${cpa.materialScope} | ScopeCode: ${cpa.scopeCode || 'MAT'}`
        )
        .join('\n')}`
    : ''
}

Kembalikan respon JSON dengan skema:
- units: array Unit / Bab Pembelajaran.
  - id: ID unik unit (misal "unit-1")
  - title: Judul Bab (misal "Bab 1: Menjelajah Teks Deskripsi")
  - order: Nomor urut Bab (1, 2, 3...)
  - linkedTpIds: Array ID TP yang dipayungi oleh Bab ini
  - linkedAtpItemIds: Array ID ATP yang dipayungi oleh Bab ini
  - materials: Array Lingkup Materi dalam Bab ini
    - id: ID unik materi (misal "mat-1-1")
    - title: Judul Lingkup Materi yang bernas dan operasional
    - order: Nomor urut materi dalam Bab (1, 2, 3...)
    - linkedTpIds: Array ID TP yang mendukung materi ini
    - linkedAtpItemIds: Array ID ATP yang mendukung materi ini`;

      const response = await generateContentWithRetry(ai, {
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              units: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    order: { type: Type.INTEGER },
                    linkedTpIds: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    linkedAtpItemIds: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    materials: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          title: { type: Type.STRING },
                          order: { type: Type.INTEGER },
                          linkedTpIds: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                          },
                          linkedAtpItemIds: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                          },
                        },
                        required: ['title', 'order', 'linkedTpIds', 'linkedAtpItemIds'],
                      },
                    },
                  },
                  required: ['title', 'order', 'linkedTpIds', 'linkedAtpItemIds', 'materials'],
                },
              },
            },
            required: ['units'],
          },
        },
      });

      const parsed = cleanAndParseJSON(response.text, null);
      if (parsed && Array.isArray(parsed.units) && parsed.units.length > 0) {
        // SERVER-SIDE DETERMINISTIC MERGE SAFETY & SANITIZATION
        const rawUnits = parsed.units;

        let sanitizedUnits = rawUnits.map((u: any, uIdx: number) => {
          const unitOrder = u.order || uIdx + 1;
          const finalTitle = (u.title || `Bab ${unitOrder}`).trim();
          const finalUnitId = u.id || `unit-${Date.now()}-${unitOrder}`;

          // Sanitize linked IDs
          const validLinkedAtpItemIds: string[] = Array.isArray(u.linkedAtpItemIds)
            ? Array.from(new Set(u.linkedAtpItemIds.filter((id: string) => atpMap.has(id))))
            : [];

          const unitSupportedTpSet = new Set<string>();
          validLinkedAtpItemIds.forEach((atpId) => {
            const atpItem = atpMap.get(atpId);
            if (atpItem) {
              const resolvedTpIds = resolveCanonicalAtpTpIds(atpItem, validTpIdSet);
              resolvedTpIds.forEach((tpId) => unitSupportedTpSet.add(tpId));
            }
          });

          // Sanitize linkedTpIds: preserve authentic subset chosen by AI that is supported by unit's ATPs
          // Do NOT expand to all resolved TPs of unit's ATPs!
          const validLinkedTpIds: string[] = Array.isArray(u.linkedTpIds)
            ? Array.from(new Set(u.linkedTpIds.filter((id: string) => tpMap.has(id) && unitSupportedTpSet.has(id))))
            : [];

          // Sanitize materials
          const rawMaterials = Array.isArray(u.materials) ? u.materials : [];
          const sanitizedMaterials = rawMaterials.map((m: any, mIdx: number) => {
            const matOrder = m.order || mIdx + 1;
            const finalMatTitle = (m.title || `Lingkup Materi ${matOrder}`).trim();
            const finalMatId = m.id || `mat-${Date.now()}-${unitOrder}-${matOrder}`;

            const matAtpIds: string[] = Array.isArray(m.linkedAtpItemIds)
              ? Array.from(new Set(m.linkedAtpItemIds.filter((id: string) => atpMap.has(id) && validLinkedAtpItemIds.includes(id))))
              : [];

            const matSupportedTpSet = new Set<string>();
            matAtpIds.forEach((atpId) => {
              const atpItem = atpMap.get(atpId);
              if (atpItem) {
                const resolvedTpIds = resolveCanonicalAtpTpIds(atpItem, validTpIdSet);
                resolvedTpIds.forEach((tpId) => matSupportedTpSet.add(tpId));
              }
            });

            const matTpIds: string[] = Array.isArray(m.linkedTpIds)
              ? Array.from(new Set(m.linkedTpIds.filter((id: string) => tpMap.has(id) && validLinkedTpIds.includes(id) && matSupportedTpSet.has(id))))
              : [];

            return {
              id: finalMatId,
              title: finalMatTitle,
              order: matOrder,
              linkedTpIds: matTpIds,
              linkedAtpItemIds: matAtpIds,
            };
          });

          sanitizedMaterials.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

          return {
            id: finalUnitId,
            title: finalTitle,
            order: unitOrder,
            linkedTpIds: validLinkedTpIds,
            linkedAtpItemIds: validLinkedAtpItemIds,
            materials: sanitizedMaterials,
          };
        });

        // POST-AI SANITIZATION: Integrate cross-cutting-only units into relevant substantive units
        const isUnitCrossCuttingOnly = (u: any): boolean => {
          if (!Array.isArray(u.linkedTpIds) || u.linkedTpIds.length === 0) return false;
          return u.linkedTpIds.every((tpId: string) => {
            const tp = tpMap.get(tpId);
            return isCrossCuttingTp(tp);
          });
        };

        const substantiveUnits = sanitizedUnits.filter((u) => !isUnitCrossCuttingOnly(u));
        const crossCuttingOnlyUnits = sanitizedUnits.filter((u) => isUnitCrossCuttingOnly(u));

        if (substantiveUnits.length > 0 && crossCuttingOnlyUnits.length > 0) {
          crossCuttingOnlyUnits.forEach((ccUnit) => {
            const ccTps = ccUnit.linkedTpIds.map((id: string) => tpMap.get(id)).filter(Boolean);

            // Rank substantive units by similarity
            const scoredSubstantive = substantiveUnits.map((subUnit, sIdx) => {
              const subTps = subUnit.linkedTpIds.map((id: string) => tpMap.get(id)).filter(Boolean);
              let sim = 0;

              ccTps.forEach((ccTp: any) => {
                subTps.forEach((sTp: any) => {
                  if (ccTp.scopeCode && sTp.scopeCode && ccTp.scopeCode.trim().toUpperCase() === sTp.scopeCode.trim().toUpperCase()) {
                    sim += 5;
                  }
                  const ccScope = (ccTp.contentScope || '').toLowerCase().trim();
                  const sScope = (sTp.contentScope || '').toLowerCase().trim();
                  if (ccScope && sScope && (ccScope.includes(sScope) || sScope.includes(ccScope))) {
                    sim += 4;
                  }
                  const kwCC = extractKeywords(`${ccTp.contentScope || ''} ${ccTp.statement || ''}`);
                  const kwS = extractKeywords(`${sTp.contentScope || ''} ${sTp.statement || ''}`);
                  sim += kwCC.filter((k) => kwS.includes(k)).length;
                });
              });

              // Chronology step proximity
              const subAtpSteps = subUnit.linkedAtpItemIds.map((id: string) => atpMap.get(id)?.stepNumber || 1);
              const avgSubStep = subAtpSteps.reduce((a: number, b: number) => a + b, 0) / Math.max(1, subAtpSteps.length);
              const ccAtpSteps = ccUnit.linkedAtpItemIds.map((id: string) => atpMap.get(id)?.stepNumber || 1);
              const avgCcStep = ccAtpSteps.reduce((a: number, b: number) => a + b, 0) / Math.max(1, ccAtpSteps.length);
              const stepDiff = Math.abs(avgSubStep - avgCcStep);
              const adjustedSim = sim - stepDiff * 0.05;

              return { subUnit, sIdx, sim, adjustedSim };
            });

            scoredSubstantive.sort((a, b) => b.adjustedSim - a.adjustedSim);
            const bestTarget = scoredSubstantive[0];

            // Select targets: always best, plus any strongly relevant ones
            const targetUnits: any[] = [];
            if (bestTarget) {
              targetUnits.push(bestTarget.subUnit);
            }
            scoredSubstantive.slice(1).forEach((st) => {
              if (st.sim >= 3 && st.sim >= (bestTarget?.sim || 0) * 0.6) {
                targetUnits.push(st.subUnit);
              }
            });

            // Integrate ccUnit lineages into each target unit
            targetUnits.forEach((tUnit) => {
              // Merge linkedAtpItemIds
              ccUnit.linkedAtpItemIds.forEach((atpId: string) => {
                if (!tUnit.linkedAtpItemIds.includes(atpId)) {
                  tUnit.linkedAtpItemIds.push(atpId);
                }
              });

              // Merge linkedTpIds
              ccUnit.linkedTpIds.forEach((tpId: string) => {
                if (!tUnit.linkedTpIds.includes(tpId)) {
                  tUnit.linkedTpIds.push(tpId);
                }
              });

              // Integrate into materials: assign each cross-cutting TP/ATP to a matching or first material
              ccUnit.linkedTpIds.forEach((ccTpId: string) => {
                const ccTp = tpMap.get(ccTpId);
                if (!ccTp) return;

                // Find supporting ATP for this TP that is in tUnit.linkedAtpItemIds
                const supportingAtpIds = tUnit.linkedAtpItemIds.filter((atpId: string) => {
                  const atp = atpMap.get(atpId);
                  return atp && resolveCanonicalAtpTpIds(atp, validTpIdSet).includes(ccTpId);
                });

                if (supportingAtpIds.length === 0) return;

                // Find best material in tUnit
                let bestMat = tUnit.materials?.[0];
                let bestMatSim = -1;

                (tUnit.materials || []).forEach((m: any) => {
                  let matSim = 0;
                  const kwCC = extractKeywords(`${ccTp.contentScope || ''} ${ccTp.statement || ''}`);
                  const kwM = extractKeywords(m.title || '');
                  matSim += kwCC.filter((k) => kwM.includes(k)).length;
                  if (matSim > bestMatSim) {
                    bestMatSim = matSim;
                    bestMat = m;
                  }
                });

                if (bestMat) {
                  if (!bestMat.linkedTpIds.includes(ccTpId)) {
                    bestMat.linkedTpIds.push(ccTpId);
                  }
                  supportingAtpIds.forEach((atpId: string) => {
                    if (!bestMat.linkedAtpItemIds.includes(atpId)) {
                      bestMat.linkedAtpItemIds.push(atpId);
                    }
                  });
                }
              });
            });
          });

          // Replace sanitizedUnits with substantiveUnits
          sanitizedUnits = substantiveUnits;
        }

        // Re-sort order to 1..n and normalize prefix titles
        sanitizedUnits.forEach((u: any, idx: number) => {
          const newOrder = idx + 1;
          u.order = newOrder;

          const cleanTitle = (u.title || '').replace(/^(bab|unit)\s*\d*[:\-]?\s*/i, '').trim();
          u.title = `Bab ${newOrder}: ${cleanTitle || `Pembelajaran ${newOrder}`}`;

          (u.materials || []).forEach((m: any, mIdx: number) => {
            m.order = mIdx + 1;
          });
        });

        sanitizedUnits.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

        // Strict Canonical Lineage Validation: AI output must satisfy unit, material, and global coverage contracts
        const allUnitsHaveLineage = sanitizedUnits.length > 0 && sanitizedUnits.every(
          (u) => u.linkedAtpItemIds.length > 0 && u.linkedTpIds.length > 0
        );

        const allMaterialsHaveLineage = sanitizedUnits.every((u) => {
          if (!Array.isArray(u.materials) || u.materials.length === 0) return false;
          return u.materials.every((m: any) => {
            if (!Array.isArray(m.linkedAtpItemIds) || m.linkedAtpItemIds.length === 0) return false;
            if (!Array.isArray(m.linkedTpIds) || m.linkedTpIds.length === 0) return false;

            // material.linkedAtpItemIds ⊆ unit.linkedAtpItemIds
            const atpInUnit = m.linkedAtpItemIds.every((id: string) => u.linkedAtpItemIds.includes(id));
            if (!atpInUnit) return false;

            // material.linkedTpIds ⊆ unit.linkedTpIds
            const tpInUnit = m.linkedTpIds.every((id: string) => u.linkedTpIds.includes(id));
            if (!tpInUnit) return false;

            // material.linkedTpIds ⊆ TP supported by material.linkedAtpItemIds
            const matSupportedTpSet = new Set<string>();
            m.linkedAtpItemIds.forEach((atpId: string) => {
              const atp = atpMap.get(atpId);
              if (atp) {
                const resolved = resolveCanonicalAtpTpIds(atp, validTpIdSet);
                resolved.forEach((tpId) => matSupportedTpSet.add(tpId));
              }
            });
            const tpSupported = m.linkedTpIds.every((id: string) => matSupportedTpSet.has(id));
            if (!tpSupported) return false;

            return true;
          });
        });

        const mappedAtpIdSet = new Set<string>();
        sanitizedUnits.forEach((u) => u.linkedAtpItemIds.forEach((id) => mappedAtpIdSet.add(id)));
        const allAtpsCovered = validAtpItems.every((atp) => mappedAtpIdSet.has(atp.id));

        const allTpsCoveredGlobally = validAtpItems.every((atp) => {
          const canonicalTpIds = resolveCanonicalAtpTpIds(atp, validTpIdSet);
          const unitsWithAtp = sanitizedUnits.filter((u) => u.linkedAtpItemIds.includes(atp.id));
          const coveredTps = new Set<string>();
          unitsWithAtp.forEach((u) => u.linkedTpIds.forEach((tpId) => coveredTps.add(tpId)));
          return canonicalTpIds.every((tpId) => coveredTps.has(tpId));
        });

        if (!allUnitsHaveLineage || !allMaterialsHaveLineage || !allAtpsCovered || !allTpsCoveredGlobally) {
          throw new Error('AI generated mapping failed canonical lineage validation.');
        }

        const canonicalResult = {
          id: existingMapping?.id || `aum-${Date.now()}`,
          academicSettingId: existingMapping?.academicSettingId || academicSettingId,
          atpId: atpData?.id || '',
          tpDataId: tpData?.id || '',
          units: sanitizedUnits,
          basedOnTpUpdatedAt: tpData?.updatedAt,
          basedOnAtpUpdatedAt: atpData?.updatedAt,
          updatedAt: new Date().toISOString(),
        };

        const finalizedResult = enforceCanonicalMappingInvariants(canonicalResult, validTpItems, validAtpItems);
        if (count !== undefined && finalizedResult.units.length !== count) throw new Error(`Jumlah Bab hasil AI harus tepat ${count}.`);
        const finalValidation = validateATPUnitMappingCanonical(finalizedResult, atpData, tpData);
        if (!finalValidation.isValid || !finalValidation.isComplete) {
          return res.status(400).json({ success: false, code: 'SOURCE_LINEAGE_MISSING',
            error: finalValidation.issues.join(' '), diagnostic: finalValidation });
        }

        return res.json({
          success: true,
          data: finalizedResult,
          engine: 'gemini',
        });
      }
    } catch (error: any) {
      console.warn('Gemini Canonical ATP Unit Mapping failed, falling back to pedagogical engine:', error);
    }
  }

  // Fallback: Pedagogical Rule-Based Clustering Engine
  const fallbackResult = fallbackGenerateCanonicalATPUnitMapping({
    academicSettingId,
    subject,
    grade,
    phase,
    tpData,
    atpData,
    cpAnalysisData,
    existingMapping,
    targetUnitCount: count,
    targetMaterialCountPerUnit,
  });

  const fallbackValidation = validateATPUnitMappingCanonical(fallbackResult, atpData, tpData);
  if (count !== undefined && fallbackResult.units.length !== count) {
    return res.status(422).json({ success: false, error: `Tidak dapat menyusun tepat ${count} Bab dengan cakupan canonical yang valid. Draf tidak diubah.` });
  }
  if (!fallbackValidation.isValid || !fallbackValidation.isComplete) {
    return res.status(400).json({ success: false, code: 'SOURCE_LINEAGE_MISSING',
      error: fallbackValidation.issues.join(' '), diagnostic: fallbackValidation });
  }
  return res.json({
    success: true,
    data: fallbackResult,
    engine: 'pedagogical_engine',
  });
});

// Endpoint: AI Generate Unit Meetings Draft
app.post('/api/ai/generate-unit-meetings', async (req, res) => {
  const {
    subject = 'Mata Pelajaran',
    grade = '',
    phase = '',
    mapping,
    tpData,
    atpData,
    currentPlan,
    capacityContext,
    unitMeetingTargets,
  } = req.body || {};

  if (!mapping || !Array.isArray(mapping.units)) {
    return res.status(400).json({ success: false, code: 'INVALID_PAYLOAD', error: 'Data pemetaan Unit/Bab (mapping) diperlukan.' });
  }
  if (!tpData || !Array.isArray(tpData.items)) {
    return res.status(400).json({ success: false, code: 'INVALID_PAYLOAD', error: 'Data TP canonical diperlukan.' });
  }
  if (!atpData || !Array.isArray(atpData.items)) {
    return res.status(400).json({ success: false, code: 'INVALID_PAYLOAD', error: 'Data ATP canonical diperlukan.' });
  }

  try {
    assertMeetingSourceLineage(mapping.units, tpData.items, atpData.items);
  } catch (error) {
    if (error instanceof MeetingCoverageError) {
      return res.status(400).json({ success: false, code: error.code, error: error.message,
        diagnostic: { ...error.diagnostic, code: error.code, mappingId: mapping.id, planId: currentPlan?.id } });
    }
    throw error;
  }

  const validTpMap = new Map<string, any>(tpData.items.map((tp: any) => [tp.id, tp]));
  const validAtpMap = new Map<string, any>(atpData.items.map((atp: any) => [atp.id, atp]));

  const sortedMappingUnits = [...(mapping.units || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const validUnitIdsSet = new Set(sortedMappingUnits.map((u) => u.id));

  let semester1LastUnitId: string | null | undefined;
  if (capacityContext && capacityContext.semester1LastUnitId !== undefined) {
    semester1LastUnitId = capacityContext.semester1LastUnitId;
  } else if (
    currentPlan?.semesterPlacement &&
    currentPlan.semesterPlacement.mode === 'CONTIGUOUS_BOUNDARY' &&
    currentPlan.semesterPlacement.semester1LastUnitId !== undefined
  ) {
    semester1LastUnitId = currentPlan.semesterPlacement.semester1LastUnitId;
  } else {
    semester1LastUnitId = undefined;
  }
  const semester1UnitIds: string[] = [];
  const semester2UnitIds: string[] = [];

  if (semester1LastUnitId !== undefined) {
    if (semester1LastUnitId === null) {
      sortedMappingUnits.forEach((u) => semester2UnitIds.push(u.id));
    } else {
      if (!validUnitIdsSet.has(semester1LastUnitId)) {
        return res.status(400).json({
          success: false,
          code: 'BOUNDARY_MISMATCH',
          error: `semester1LastUnitId '${semester1LastUnitId}' tidak dikenal pada mapping.units`,
          diagnostic: {
            version: 1,
            stage: 'BOUNDARY_RESOLUTION',
            code: 'BOUNDARY_MISMATCH',
            mappingId: mapping.id,
            planId: currentPlan?.id,
            semester1LastUnitId,
            semester1UnitIds: [],
            semester2UnitIds: [],
            capacity: {
              semester1: { target: capacityContext?.semester1?.targetMeetingCount ?? 0, existing: 0, requestedNew: 0 },
              semester2: { target: capacityContext?.semester2?.targetMeetingCount ?? 0, existing: 0, requestedNew: 0 },
            },
          },
        });
      }
      let reachedLastS1 = false;
      for (const u of sortedMappingUnits) {
        if (!reachedLastS1) {
          semester1UnitIds.push(u.id);
          if (u.id === semester1LastUnitId) {
            reachedLastS1 = true;
          }
        } else {
          semester2UnitIds.push(u.id);
        }
      }
    }
  }

  if (currentPlan?.semesterPlacement && capacityContext && capacityContext.semester1LastUnitId !== undefined) {
    if (currentPlan.semesterPlacement.semester1LastUnitId !== capacityContext.semester1LastUnitId) {
      return res.status(400).json({
        success: false,
        code: 'BOUNDARY_MISMATCH',
        error: 'Boundary semester dari currentPlan tidak sama dengan capacityContext.',
        diagnostic: {
          version: 1,
          stage: 'BOUNDARY_RESOLUTION',
          code: 'BOUNDARY_MISMATCH',
          mappingId: mapping.id,
          planId: currentPlan?.id,
          semester1LastUnitId,
          semester1UnitIds,
          semester2UnitIds,
          capacity: {
            semester1: { target: capacityContext?.semester1?.targetMeetingCount ?? 0, existing: 0, requestedNew: 0 },
            semester2: { target: capacityContext?.semester2?.targetMeetingCount ?? 0, existing: 0, requestedNew: 0 },
          },
        },
      });
    }
  }

  let s1ExistingMeetingCount = 0;
  let s2ExistingMeetingCount = 0;

  const s1UnitsSet = new Set(semester1UnitIds);
  const s2UnitsSet = new Set(semester2UnitIds);

  (currentPlan?.units || []).forEach((u: any) => {
    const meetCount = u.meetings?.length || 0;
    if (s1UnitsSet.has(u.unitId)) {
      s1ExistingMeetingCount += meetCount;
    } else if (s2UnitsSet.has(u.unitId)) {
      s2ExistingMeetingCount += meetCount;
    }
  });

  const targetS1 = capacityContext?.semester1?.targetMeetingCount ?? 0;
  const targetS2 = capacityContext?.semester2?.targetMeetingCount ?? 0;

  const additionalS1 = targetS1 - s1ExistingMeetingCount;
  const additionalS2 = targetS2 - s2ExistingMeetingCount;

  const buildDiagnostic = (opts: {
    stage: string;
    code: string;
    suggS1Count?: number;
    suggS2Count?: number;
    perUnitMap?: Map<string, {
      unitId: string;
      semester: 1 | 2;
      existingCount: number;
      targetNewCount?: number;
      generatedCount: number;
      delta?: number;
      suggestions?: any[];
    }>;
    issue?: {
      unitId?: string;
      suggestionIndex?: number;
      title?: string;
      field?: 'unitId' | 'materialIds' | 'linkedAtpItemIds' | 'linkedTpIds';
      invalidId?: string;
    };
    missingCoverage?: Array<{
      unitId: string;
      materialIds: string[];
      atpItemIds: string[];
      tpIds: string[];
    }>;
  }) => {
    const perUnitList = opts.perUnitMap
      ? Array.from(opts.perUnitMap.values())
      : sortedMappingUnits.map((u) => {
          const uPlan = currentPlan?.units?.find((p: any) => p.unitId === u.id);
          const sem = s1UnitsSet.has(u.id) ? 1 : 2;
          return {
            unitId: u.id,
            semester: sem as (1 | 2),
            existingCount: (uPlan?.meetings || []).length,
            generatedCount: 0,
          };
        });

    return {
      version: 1,
      stage: opts.stage,
      code: opts.code,
      mappingId: mapping?.id || '',
      planId: currentPlan?.id,
      semester1LastUnitId,
      semester1UnitIds,
      semester2UnitIds,
      capacity: {
        semester1: {
          target: targetS1,
          existing: s1ExistingMeetingCount,
          requestedNew: additionalS1,
        },
        semester2: {
          target: targetS2,
          existing: s2ExistingMeetingCount,
          requestedNew: additionalS2,
        },
      },
      generated: typeof opts.suggS1Count === 'number' && typeof opts.suggS2Count === 'number' ? {
        semester1: opts.suggS1Count,
        semester2: opts.suggS2Count,
        deltaSemester1: opts.suggS1Count - additionalS1,
        deltaSemester2: opts.suggS2Count - additionalS2,
      } : undefined,
      perUnit: perUnitList,
      issue: opts.issue,
      missingCoverage: opts.missingCoverage && opts.missingCoverage.length > 0 ? opts.missingCoverage : undefined,
    };
  };

  if (additionalS1 < 0 || additionalS2 < 0) {
    return res.status(400).json({
      success: false,
      code: 'MANUAL_OVER_CAPACITY',
      error: 'Kapasitas Pertemuan manual melebihi kapasitas Pertemuan perencanaan.',
      diagnostic: buildDiagnostic({
        stage: 'CAPACITY_CHECK',
        code: 'MANUAL_OVER_CAPACITY',
      }),
    });
  }

  // Strict validation of unitMeetingTargets
  if (!Array.isArray(unitMeetingTargets) || unitMeetingTargets.length === 0) {
    return res.status(400).json({
      success: false,
      code: 'UNIT_TARGET_INVALID',
      error: 'Data target alokasi per Unit (unitMeetingTargets) wajib disertakan.',
      diagnostic: buildDiagnostic({
        stage: 'TARGET_VALIDATION',
        code: 'UNIT_TARGET_INVALID',
      }),
    });
  }

  const targetsByUnitId = new Map<string, { unitId: string; semester: 1 | 2; existingCount: number; newTargetCount: number }>();
  let sumS1Target = 0;
  let sumS2Target = 0;

  for (const t of unitMeetingTargets) {
    if (!t || typeof t !== 'object') {
      return res.status(400).json({
        success: false,
        code: 'UNIT_TARGET_INVALID',
        error: 'Target per unit tidak valid.',
        diagnostic: buildDiagnostic({ stage: 'TARGET_VALIDATION', code: 'UNIT_TARGET_INVALID' }),
      });
    }
    const { unitId, semester, existingCount, newTargetCount } = t;
    if (!unitId || !validUnitIdsSet.has(unitId)) {
      return res.status(400).json({
        success: false,
        code: 'UNIT_TARGET_INVALID',
        error: `unitId '${unitId}' pada unitMeetingTargets tidak ditemukan pada pemetaan mapping.`,
        diagnostic: buildDiagnostic({ stage: 'TARGET_VALIDATION', code: 'UNIT_TARGET_INVALID', issue: { unitId, field: 'unitId', invalidId: unitId } }),
      });
    }
    if (targetsByUnitId.has(unitId)) {
      return res.status(400).json({
        success: false,
        code: 'UNIT_TARGET_INVALID',
        error: `Duplikasi unitId '${unitId}' pada unitMeetingTargets.`,
        diagnostic: buildDiagnostic({ stage: 'TARGET_VALIDATION', code: 'UNIT_TARGET_INVALID', issue: { unitId, field: 'unitId', invalidId: unitId } }),
      });
    }
    const expectedSemester = s1UnitsSet.has(unitId) ? 1 : 2;
    if (semester !== expectedSemester) {
      return res.status(400).json({
        success: false,
        code: 'UNIT_TARGET_INVALID',
        error: `Semester untuk Unit '${unitId}' (${semester}) tidak sesuai dengan boundary (${expectedSemester}).`,
        diagnostic: buildDiagnostic({ stage: 'TARGET_VALIDATION', code: 'UNIT_TARGET_INVALID', issue: { unitId } }),
      });
    }
    if (typeof newTargetCount !== 'number' || !Number.isInteger(newTargetCount) || newTargetCount < 0) {
      return res.status(400).json({
        success: false,
        code: 'UNIT_TARGET_INVALID',
        error: `newTargetCount untuk Unit '${unitId}' harus bilangan bulat integer >= 0.`,
        diagnostic: buildDiagnostic({ stage: 'TARGET_VALIDATION', code: 'UNIT_TARGET_INVALID', issue: { unitId } }),
      });
    }
    const uPlan = currentPlan?.units?.find((u: any) => u.unitId === unitId);
    const actualExisting = (uPlan?.meetings || []).length;
    if (typeof existingCount !== 'number' || existingCount !== actualExisting) {
      return res.status(400).json({
        success: false,
        code: 'UNIT_TARGET_INVALID',
        error: `existingCount untuk Unit '${unitId}' (${existingCount}) tidak sesuai dengan currentPlan (${actualExisting}).`,
        diagnostic: buildDiagnostic({ stage: 'TARGET_VALIDATION', code: 'UNIT_TARGET_INVALID', issue: { unitId } }),
      });
    }

    targetsByUnitId.set(unitId, { unitId, semester, existingCount, newTargetCount });
    if (semester === 1) sumS1Target += newTargetCount;
    else sumS2Target += newTargetCount;
  }

  for (const unit of sortedMappingUnits) {
    if (!targetsByUnitId.has(unit.id)) {
      return res.status(400).json({
        success: false,
        code: 'UNIT_TARGET_INVALID',
        error: `Unit '${unit.id}' belum tercakup dalam unitMeetingTargets.`,
        diagnostic: buildDiagnostic({ stage: 'TARGET_VALIDATION', code: 'UNIT_TARGET_INVALID', issue: { unitId: unit.id } }),
      });
    }
  }

  if (sumS1Target !== additionalS1 || sumS2Target !== additionalS2) {
    return res.status(400).json({
      success: false,
      code: 'UNIT_TARGET_INVALID',
      error: `Total newTargetCount (${sumS1Target} S1, ${sumS2Target} S2) tidak sesuai dengan kapasitas slot semester (${additionalS1} S1, ${additionalS2} S2).`,
      diagnostic: buildDiagnostic({ stage: 'TARGET_VALIDATION', code: 'UNIT_TARGET_INVALID' }),
    });
  }

  const unitsContext = sortedMappingUnits.map((unit: any) => {
    const unitPlan = currentPlan?.units?.find((u: any) => u.unitId === unit.id);
    const existingMeetings = unitPlan?.meetings || [];
    const unitTarget = targetsByUnitId.get(unit.id);

    const coveredMaterials = new Set(existingMeetings.flatMap((m: any) => m.materialIds || []));
    const coveredAtp = new Set(existingMeetings.flatMap((m: any) => m.linkedAtpItemIds || []));
    const coveredTp = new Set(existingMeetings.flatMap((m: any) => m.linkedTpIds || []));

    const missingMaterials = (unit.materials || []).filter((m: any) => !coveredMaterials.has(m.id)).map((m: any) => m.id);
    const missingAtp = (unit.linkedAtpItemIds || []).filter((id: string) => !coveredAtp.has(id));
    const missingTp = (unit.linkedTpIds || []).filter((id: string) => !coveredTp.has(id));

    const semester = s1UnitsSet.has(unit.id) ? 1 : s2UnitsSet.has(unit.id) ? 2 : 1;

    return {
      unitId: unit.id,
      unitTitle: unit.title,
      semester,
      newMeetingsToGenerate: unitTarget?.newTargetCount ?? 0,
      existingMeetingsCount: existingMeetings.length,
      materials: (unit.materials || []).map((m: any) => ({
        id: m.id,
        title: m.title,
        linkedAtpItemIds: m.linkedAtpItemIds || [],
        linkedTpIds: m.linkedTpIds || [],
      })),
      atpItems: (unit.linkedAtpItemIds || []).map((id: string) => {
        const item = validAtpMap.get(id);
        return {
          id,
          stepNumber: item?.stepNumber || 1,
          focus: item?.focus || '',
          linkedTpIds: item?.linkedTpIds || [],
        };
      }),
      tpItems: (unit.linkedTpIds || []).map((id: string) => {
        const item = validTpMap.get(id);
        return {
          id,
          code: item?.code || 'TP',
          statement: item?.statement || '',
        };
      }),
      existingMeetings: existingMeetings.map((m: any) => ({
        title: m.title,
        materialIds: m.materialIds || [],
        linkedAtpItemIds: m.linkedAtpItemIds || [],
        linkedTpIds: m.linkedTpIds || [],
      })),
      missingCoverage: {
        materialIds: missingMaterials,
        atpItemIds: missingAtp,
        tpIds: missingTp,
      },
    };
  });

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      code: 'AI_NOT_CONFIGURED',
      error: 'Layanan AI belum dikonfigurasi pada server.',
      diagnostic: buildDiagnostic({
        stage: 'AI_CONFIGURATION',
        code: 'AI_NOT_CONFIGURED',
      }),
    });
  }

  try {
    const ai = createAIClient(apiKey);
    const targetPerUnitPrompt = sortedMappingUnits.map((u) => {
      const t = targetsByUnitId.get(u.id)!;
      return `- Unit [ID: "${u.id}"] "${u.title}" | Semester ${t.semester}: buat EXACT ${t.newTargetCount} Pertemuan baru (Sudah ada ${t.existingCount} pertemuan existing).`;
    }).join('\n');

    const prompt = `Anda adalah pakar pengembang kurikulum dan perangkat pembelajaran Kurikulum Merdeka.
TUGAS ANDA: Mengisi konten slot Pertemuan baru yang sudah ditentukan secara deterministik untuk setiap Unit / Bab Pembelajaran.

TARGET WAJIB PER UNIT (HARUS DIPENUHI SECARA EXACT):
${targetPerUnitPrompt}

TOTAL TARGET SEMESTER:
- Semester 1: total ${additionalS1} Pertemuan baru.
- Semester 2: total ${additionalS2} Pertemuan baru.

RULES WAJIB:
1. Jumlah Pertemuan baru pada array 'meetings' setiap Unit HARUS PERSIS SAMA DENGAN target newTargetCount di atas.
   - Contoh: jika Unit target adalah 7 pertemuan baru, array 'meetings' untuk unit tersebut WAJIB berisi TEPAT 7 butir objek pertemuan.
2. DILARANG menambah Pertemuan ekstra untuk refleksi, evaluasi, sumatif, atau penguatan jika target Unit sudah terpenuhi. Jika diperlukan refleksi/penguatan, integrasikan fokus tersebut ke dalam salah satu slot Pertemuan yang dialokasikan.
3. DILARANG mengurangi jumlah Pertemuan dari target yang telah ditentukan.
4. Gunakan HANYA Unit yang diberikan. Satu Pertemuan hanya milik satu Unit.
5. Jangan output field 'semester' dalam list meetings. Semester diwarisi dari parent Unit-nya.
6. Jangan output: JP, tanggal, minggu, duration, assessment, learning model.
7. Referensi materialIds, linkedAtpItemIds, dan linkedTpIds harus menggunakan ID canonical yang persis yang ada di data konteks unit.
8. ID atau Materi canonical yang sama boleh digunakan ulang di beberapa Pertemuan jika secara pedagogis diperlukan (misalnya untuk penguatan/praktik/refleksi lanjutan).
9. Dilarang menciptakan ID baru atau Materi canonical baru yang tidak terdaftar di konteks unit.
10. Semua missingCoverage yang tertera wajib tercakup sepenuhnya dalam tambahan Pertemuan yang Anda buat.
11. Judul Pertemuan harus substantif, kreatif, dan berbeda secara pedagogis. Hindari judul generik seperti "Pertemuan 1", "Pertemuan 2", atau "Pembelajaran materi X".
12. Setiap Pertemuan yang diusulkan wajib memilih minimal satu Material.
13. Server akan otomatis menentukan ATP dan TP berdasarkan Material yang dipilih. Jangan hasilkan ATP ID atau TP ID dalam respon.
14. Material boleh digunakan ulang pada beberapa Pertemuan jika secara pedagogis diperlukan.
15. Dilarang menciptakan ID baru atau Materi canonical baru yang tidak terdaftar di konteks unit.
16. Semua missingCoverage yang tertera wajib tercakup sepenuhnya dalam tambahan Pertemuan yang Anda buat.
17. Judul Pertemuan harus substantif, kreatif, dan berbeda secara pedagogis.
18. Audit SETIAP Bab sebelum menjawab: union lineage materi pada pertemuan existing dan baru harus mencakup SEMUA TP, ATP, dan materi canonical Bab tersebut. Jumlah slot yang tepat saja tidak cukup.
19. Untuk setiap TP yang belum tercakup, pilih materi yang benar-benar mendukung TP itu dan susun judul/kegiatan relevan dalam slot yang tersedia. Jangan menempelkan TP tanpa materi pendukung atau menambah slot.

DATA KONTEKS UNIT:
${JSON.stringify(unitsContext, null, 2)}

Kembalikan respon JSON dengan skema:
{
  "units": [
    {
      "unitId": "EXACT_UNIT_ID",
      "meetings": [
        {
          "title": "...",
          "materialIds": ["EXACT_ID"]
        }
      ]
    }
  ]
}`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            units: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  unitId: { type: Type.STRING },
                  meetings: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        title: { type: Type.STRING },
                        materialIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                      },
                      required: ['title', 'materialIds'],
                    },
                  },
                },
                required: ['unitId', 'meetings'],
              },
            },
          },
          required: ['units'],
        },
      },
    });

    const parsed = cleanAndParseJSON(response.text, null);
    if (!parsed || !Array.isArray(parsed.units)) {
      return res.status(400).json({
        success: false,
        code: 'AI_FORMAT_INVALID',
        error: 'AI mengembalikan format respon yang tidak valid.',
        diagnostic: buildDiagnostic({
          stage: 'RESPONSE_PARSING',
          code: 'AI_FORMAT_INVALID',
        }),
      });
    }

    try {
      // Keep count/reference validation below authoritative, including after repair.
      parsed.units = await repairUnitMeetingCoverage({
        units: sortedMappingUnits,
        suggestions: parsed.units,
        existing: currentPlan?.units || [],
        expectedCounts: new Map(sortedMappingUnits.map(u => [u.id, targetsByUnitId.get(u.id)!.newTargetCount])),
        semesterByUnit: new Map(sortedMappingUnits.map(u => [u.id, s1UnitsSet.has(u.id) ? 1 : 2])),
        repair: async (payload) => {
          const repaired = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `Perbaiki HANYA slot pertemuan AI pada Bab berikut untuk ${subject}, ${grade}, ${phase}.
Pertahankan unitId, urutan Bab, dan jumlah pertemuan EXACT setiap Bab. Semester dan JP tetap diwarisi; jangan output/mengubahnya.
Pastikan semua TP/ATP/materi canonical tercakup melalui materialIds yang relevan secara pedagogis.
Ubah judul dan pemilihan materi hanya sesuai kebutuhan cakupan. Jangan sekadar menempelkan ID atau mengubah pertemuan existing guru.
Gunakan hanya materi canonical Bab terkait. Jika tidak dapat dipenuhi, jangan menciptakan ID.
Kembalikan JSON {"units":[{"unitId":"...","meetings":[{"title":"...","materialIds":["..."]}]}]}.
Konteks TP: ${JSON.stringify(tpData.items)}
Konteks ATP: ${JSON.stringify(atpData.items)}
Target repair: ${JSON.stringify(payload)}`,
            config: { responseMimeType: 'application/json' },
          });
          return cleanAndParseJSON(repaired.text, null);
        },
      });
    } catch (error) {
      const code = error instanceof MeetingCoverageError ? error.code : 'AI_REPAIR_FAILED';
      return res.status(400).json({
        success: false, code,
        error: error instanceof Error ? error.message : String(error),
        diagnostic: {
          ...buildDiagnostic({ stage: 'COVERAGE_VERIFICATION', code }),
          ...(error instanceof MeetingCoverageError ? error.diagnostic : {}),
        },
      });
    }

    const validUnitsMap = new Map<string, any>(mapping.units.map((u: any) => [u.id, u]));
    const seenUnitIds = new Set<string>();

    let suggS1Count = 0;
    let suggS2Count = 0;

    const unitCoverageMap = new Map<string, {
      materials: Set<string>;
      atpItems: Set<string>;
      tps: Set<string>;
    }>();

    // Map to track per-unit diagnostic information (all units in mapping)
    const perUnitDiagnosticMap = new Map<string, {
      unitId: string;
      semester: 1 | 2;
      existingCount: number;
      targetNewCount: number;
      generatedCount: number;
      delta: number;
      suggestions: Array<{
        suggestionIndex: number;
        title: string;
        materialIds: string[];
        linkedAtpItemIds: string[];
        linkedTpIds: string[];
      }>;
    }>();

    // Initialize with existing meetings coverage and per-unit entries
    for (const unit of sortedMappingUnits) {
      const unitPlan = currentPlan?.units?.find((u: any) => u.unitId === unit.id);
      const existingMeetings = unitPlan?.meetings || [];
      const unitTarget = targetsByUnitId.get(unit.id);
      unitCoverageMap.set(unit.id, {
        materials: new Set(existingMeetings.flatMap((m: any) => m.materialIds || [])),
        atpItems: new Set(existingMeetings.flatMap((m: any) => m.linkedAtpItemIds || [])),
        tps: new Set(existingMeetings.flatMap((m: any) => m.linkedTpIds || [])),
      });

      const sem = s1UnitsSet.has(unit.id) ? 1 : 2;
      const targetNew = unitTarget?.newTargetCount ?? 0;
      perUnitDiagnosticMap.set(unit.id, {
        unitId: unit.id,
        semester: sem as (1 | 2),
        existingCount: existingMeetings.length,
        targetNewCount: targetNew,
        generatedCount: 0,
        delta: -targetNew,
        suggestions: [],
      });
    }

    const sanitizedUnits: any[] = [];

    for (const su of parsed.units) {
      if (!su || typeof su !== 'object') {
        return res.status(400).json({
          success: false,
          code: 'AI_FORMAT_INVALID',
          error: 'Struktur Unit dari AI tidak valid.',
          diagnostic: buildDiagnostic({
            stage: 'UNIT_VALIDATION',
            code: 'AI_FORMAT_INVALID',
            perUnitMap: perUnitDiagnosticMap,
          }),
        });
      }
      const uId = su.unitId;
      if (!uId) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_UNIT_ID',
          error: 'AI mengembalikan Unit tanpa unitId.',
          diagnostic: buildDiagnostic({
            stage: 'UNIT_VALIDATION',
            code: 'INVALID_UNIT_ID',
            perUnitMap: perUnitDiagnosticMap,
          }),
        });
      }
      if (seenUnitIds.has(uId)) {
        return res.status(400).json({
          success: false,
          code: 'DUPLICATE_UNIT_ID',
          error: `AI mengembalikan unitId '${uId}' ganda.`,
          diagnostic: buildDiagnostic({
            stage: 'UNIT_VALIDATION',
            code: 'DUPLICATE_UNIT_ID',
            perUnitMap: perUnitDiagnosticMap,
            issue: { unitId: uId, field: 'unitId', invalidId: uId },
          }),
        });
      }
      seenUnitIds.add(uId);

      const canonicalUnit = validUnitsMap.get(uId);
      if (!canonicalUnit) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_UNIT_ID',
          error: `AI menghasilkan unitId tidak valid: '${uId}'`,
          diagnostic: buildDiagnostic({
            stage: 'UNIT_VALIDATION',
            code: 'INVALID_UNIT_ID',
            perUnitMap: perUnitDiagnosticMap,
            issue: { unitId: uId, field: 'unitId', invalidId: uId },
          }),
        });
      }

      const validMatIds = new Set((canonicalUnit.materials || []).map((m: any) => m.id));
      const validAtpIds = new Set(canonicalUnit.linkedAtpItemIds || []);
      const validTpIds = new Set(canonicalUnit.linkedTpIds || []);

      const semester = s1UnitsSet.has(uId) ? 1 : s2UnitsSet.has(uId) ? 2 : 1;

      const rawMeetings = su.meetings;
      if (!Array.isArray(rawMeetings)) {
        return res.status(400).json({
          success: false,
          code: 'AI_FORMAT_INVALID',
          error: `AI mengembalikan meetings bukan array untuk unit '${uId}'`,
          diagnostic: buildDiagnostic({
            stage: 'UNIT_VALIDATION',
            code: 'AI_FORMAT_INVALID',
            perUnitMap: perUnitDiagnosticMap,
          }),
        });
      }

      const sanitizedMeetings: any[] = [];
      const cov = unitCoverageMap.get(uId)!;
      const diagUnit = perUnitDiagnosticMap.get(uId)!;

      for (let mIdx = 0; mIdx < rawMeetings.length; mIdx++) {
        const m = rawMeetings[mIdx];
        if (!m || typeof m !== 'object') {
          return res.status(400).json({
            success: false,
            code: 'AI_FORMAT_INVALID',
            error: 'Pertemuan dari AI tidak valid.',
            diagnostic: buildDiagnostic({
              stage: 'MEETING_VALIDATION',
              code: 'AI_FORMAT_INVALID',
              perUnitMap: perUnitDiagnosticMap,
            }),
          });
        }
        const title = typeof m.title === 'string' ? m.title.trim() : '';
        if (!title) {
          return res.status(400).json({
            success: false,
            code: 'AI_FORMAT_INVALID',
            error: `Judul Pertemuan kosong pada unit '${uId}'.`,
            diagnostic: buildDiagnostic({
              stage: 'MEETING_VALIDATION',
              code: 'AI_FORMAT_INVALID',
              perUnitMap: perUnitDiagnosticMap,
              issue: { unitId: uId, suggestionIndex: mIdx + 1 },
            }),
          });
        }

        if (!Array.isArray(m.materialIds)) {
          return res.status(400).json({
            success: false,
            code: 'AI_FORMAT_INVALID',
            error: `Format pertemuan tidak valid pada unit '${uId}'.`,
            diagnostic: buildDiagnostic({
              stage: 'MEETING_VALIDATION',
              code: 'AI_FORMAT_INVALID',
              perUnitMap: perUnitDiagnosticMap,
              issue: { unitId: uId, suggestionIndex: mIdx + 1, title },
            }),
          });
        }

        const uniqMatIds = new Set(m.materialIds);

        if (uniqMatIds.size !== m.materialIds.length) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_REFERENCE',
            error: `AI menghasilkan referensi ganda material dalam satu array pada unit '${uId}'.`,
            diagnostic: buildDiagnostic({
              stage: 'REFERENCE_VALIDATION',
              code: 'INVALID_REFERENCE',
              perUnitMap: perUnitDiagnosticMap,
              issue: { unitId: uId, suggestionIndex: mIdx + 1, title },
            }),
          });
        }

        if (m.materialIds.length === 0) {
          return res.status(400).json({
            success: false,
            code: 'MEETING_LINEAGE_INVALID',
            error: `Pertemuan '${title}' tidak memiliki materialIds.`,
            diagnostic: buildDiagnostic({
              stage: 'REFERENCE_VALIDATION',
              code: 'MEETING_LINEAGE_INVALID',
              perUnitMap: perUnitDiagnosticMap,
              issue: { unitId: uId, suggestionIndex: mIdx + 1, title, field: 'materialIds' },
            }),
          });
        }

        const derivedAtpIds = new Set<string>();
        const derivedTpIds = new Set<string>();
        for (const matId of m.materialIds) {
          if (!validMatIds.has(matId)) {
            return res.status(400).json({
              success: false,
              code: 'INVALID_REFERENCE',
              error: `AI merujuk materialId '${matId}' yang tidak valid/bukan milik unit '${uId}'.`,
              diagnostic: buildDiagnostic({
                stage: 'REFERENCE_VALIDATION',
                code: 'INVALID_REFERENCE',
                perUnitMap: perUnitDiagnosticMap,
                issue: { unitId: uId, suggestionIndex: mIdx + 1, title, field: 'materialIds', invalidId: matId },
              }),
            });
          }
          cov.materials.add(matId);

          const mat = canonicalUnit.materials.find((x: any) => x.id === matId);
          if (mat) {
             const matAtpIds = mat.linkedAtpItemIds || [];
             const matTpIds = mat.linkedTpIds || [];
             
             if (matAtpIds.length === 0) {
               return res.status(400).json({
                     success: false,
                     code: 'MEETING_LINEAGE_INVALID',
                     error: `Material '${mat.title || matId}' tidak memiliki ATP canonical.`,
                     diagnostic: buildDiagnostic({ stage: 'REFERENCE_VALIDATION', code: 'MEETING_LINEAGE_INVALID', perUnitMap: perUnitDiagnosticMap, issue: { unitId: uId, suggestionIndex: mIdx + 1, title, field: 'linkedAtpItemIds' } }),
                   });
             }
             if (matTpIds.length === 0) {
               return res.status(400).json({
                     success: false,
                     code: 'MEETING_LINEAGE_INVALID',
                     error: `Material '${mat.title || matId}' tidak memiliki TP canonical.`,
                     diagnostic: buildDiagnostic({ stage: 'REFERENCE_VALIDATION', code: 'MEETING_LINEAGE_INVALID', perUnitMap: perUnitDiagnosticMap, issue: { unitId: uId, suggestionIndex: mIdx + 1, title, field: 'linkedTpIds' } }),
                   });
             }
             matAtpIds.forEach((atpId: string) => derivedAtpIds.add(atpId));
             matTpIds.forEach((tpId: string) => derivedTpIds.add(tpId));
          }
        }
        
        // Canonical lineage validation of derived IDs
        for (const atpId of derivedAtpIds) {
          if (!validAtpIds.has(atpId) || !validAtpMap.has(atpId)) {
             return res.status(400).json({
                     success: false,
                     code: 'MEETING_LINEAGE_INVALID',
                     error: `Derivasi ATP '${atpId}' tidak valid untuk unit '${uId}'.`,
                     diagnostic: buildDiagnostic({ stage: 'REFERENCE_VALIDATION', code: 'MEETING_LINEAGE_INVALID', perUnitMap: perUnitDiagnosticMap, issue: { unitId: uId, suggestionIndex: mIdx + 1, title, field: 'linkedAtpItemIds', invalidId: atpId } }),
                   });
          }
        }
        for (const tpId of derivedTpIds) {
          if (!validTpIds.has(tpId) || !validTpMap.has(tpId)) {
             return res.status(400).json({
                     success: false,
                     code: 'MEETING_LINEAGE_INVALID',
                     error: `Derivasi TP '${tpId}' tidak valid untuk unit '${uId}'.`,
                     diagnostic: buildDiagnostic({ stage: 'REFERENCE_VALIDATION', code: 'MEETING_LINEAGE_INVALID', perUnitMap: perUnitDiagnosticMap, issue: { unitId: uId, suggestionIndex: mIdx + 1, title, field: 'linkedTpIds', invalidId: tpId } }),
                   });
          }
        }

        // Canonical order
        m.linkedAtpItemIds = (canonicalUnit.linkedAtpItemIds || []).filter(id => derivedAtpIds.has(id));
        m.linkedTpIds = (canonicalUnit.linkedTpIds || []).filter(id => derivedTpIds.has(id));
        
        // Check for TP support
        const meetingSupportedTpSet = new Set<string>();
        m.linkedAtpItemIds.forEach((atpId: string) => {
            const atpItem = validAtpMap.get(atpId);
            if (atpItem) {
                const tps = Array.isArray(atpItem.linkedTpIds) && atpItem.linkedTpIds.length > 0 ? atpItem.linkedTpIds : atpItem.tpId ? [atpItem.tpId] : [];
                tps.forEach((tId: string) => meetingSupportedTpSet.add(tId));
            }
        });
        
        for (const tpId of m.linkedTpIds) {
           if (!meetingSupportedTpSet.has(tpId)) {
              return res.status(400).json({
                     success: false,
                     code: 'MEETING_LINEAGE_INVALID',
                     error: `TP '${tpId}' pada pertemuan '${title}' tidak didukung oleh ATP pertemuan tersebut.`,
                     diagnostic: buildDiagnostic({ stage: 'REFERENCE_VALIDATION', code: 'MEETING_LINEAGE_INVALID', perUnitMap: perUnitDiagnosticMap, issue: { unitId: uId, suggestionIndex: mIdx + 1, title, field: 'linkedTpIds', invalidId: tpId } }),
                   });
           }
        }
        
        m.linkedAtpItemIds.forEach(id => cov.atpItems.add(id));
        m.linkedTpIds.forEach(id => cov.tps.add(id));

        if (m.materialIds.length + m.linkedAtpItemIds.length + m.linkedTpIds.length === 0) {
          return res.status(400).json({
            success: false,
            code: 'EMPTY_REFERENCE',
            error: `Pertemuan '${title}' tidak memiliki referensi canonical apa pun.`,
            diagnostic: buildDiagnostic({
              stage: 'REFERENCE_VALIDATION',
              code: 'EMPTY_REFERENCE',
              perUnitMap: perUnitDiagnosticMap,
              issue: { unitId: uId, suggestionIndex: mIdx + 1, title },
            }),
          });
        }

        if (semester === 1) suggS1Count++;
        else suggS2Count++;

        const suggestionObj = {
          suggestionIndex: mIdx + 1,
          title,
          materialIds: m.materialIds,
          linkedAtpItemIds: m.linkedAtpItemIds,
          linkedTpIds: m.linkedTpIds,
        };

        diagUnit.suggestions.push(suggestionObj);
        diagUnit.generatedCount++;
        diagUnit.delta = diagUnit.generatedCount - diagUnit.targetNewCount;

        sanitizedMeetings.push({
          title,
          materialIds: m.materialIds,
          linkedAtpItemIds: m.linkedAtpItemIds,
          linkedTpIds: m.linkedTpIds,
        });
      }

      sanitizedUnits.push({
        unitId: uId,
        meetings: sanitizedMeetings,
      });
    }

    // Strict validation of per-unit generated meeting counts
    for (const unit of sortedMappingUnits) {
      const diagUnit = perUnitDiagnosticMap.get(unit.id)!;
      const expectedNew = targetsByUnitId.get(unit.id)!.newTargetCount;
      const actualNew = diagUnit.generatedCount;
      if (actualNew !== expectedNew) {
        const delta = actualNew - expectedNew;
        const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
        return res.status(400).json({
          success: false,
          code: 'UNIT_COUNT_MISMATCH',
          error: `Jumlah Pertemuan baru AI untuk Unit '${unit.id}' (${actualNew}) tidak sesuai target exact (${expectedNew}, delta: ${deltaStr}).`,
          diagnostic: buildDiagnostic({
            stage: 'UNIT_COUNT_VERIFICATION',
            code: 'UNIT_COUNT_MISMATCH',
            suggS1Count,
            suggS2Count,
            perUnitMap: perUnitDiagnosticMap,
            issue: {
              unitId: unit.id,
              field: 'unitId',
            },
          }),
        });
      }
    }

    // Invariant check: total semester count
    if (suggS1Count !== additionalS1 || suggS2Count !== additionalS2) {
      return res.status(400).json({
        success: false,
        code: 'COUNT_MISMATCH',
        error: `Jumlah Pertemuan baru dari AI (${suggS1Count} S1, ${suggS2Count} S2) tidak sesuai kapasitas target (${additionalS1} S1, ${additionalS2} S2).`,
        diagnostic: buildDiagnostic({
          stage: 'COUNT_VERIFICATION',
          code: 'COUNT_MISMATCH',
          suggS1Count,
          suggS2Count,
          perUnitMap: perUnitDiagnosticMap,
        }),
      });
    }

    // Collect ALL remaining missing coverage across all units
    const missingCoverageList: Array<{
      unitId: string;
      materialIds: string[];
      atpItemIds: string[];
      tpIds: string[];
    }> = [];

    for (const unit of sortedMappingUnits) {
      const cov = unitCoverageMap.get(unit.id);
      if (cov) {
        const expectedMats = (unit.materials || []).map((m: any) => m.id);
        const expectedAtp = unit.linkedAtpItemIds || [];
        const expectedTp = unit.linkedTpIds || [];

        const uncovMats = expectedMats.filter((matId: string) => !cov.materials.has(matId));
        const uncovAtp = expectedAtp.filter((atpId: string) => !cov.atpItems.has(atpId));
        const uncovTp = expectedTp.filter((tpId: string) => !cov.tps.has(tpId));

        if (uncovMats.length > 0 || uncovAtp.length > 0 || uncovTp.length > 0) {
          missingCoverageList.push({
            unitId: unit.id,
            materialIds: uncovMats,
            atpItemIds: uncovAtp,
            tpIds: uncovTp,
          });
        }
      }
    }

    if (missingCoverageList.length > 0) {
      const firstMissing = missingCoverageList[0];
      let firstMsg = `Cakupan belum terpenuhi pada Unit '${firstMissing.unitId}'.`;
      if (firstMissing.materialIds.length > 0) {
        firstMsg = `Cakupan Materi '${firstMissing.materialIds[0]}' belum terpenuhi pada Unit '${firstMissing.unitId}'.`;
      } else if (firstMissing.atpItemIds.length > 0) {
        firstMsg = `Cakupan ATP '${firstMissing.atpItemIds[0]}' belum terpenuhi pada Unit '${firstMissing.unitId}'.`;
      } else if (firstMissing.tpIds.length > 0) {
        firstMsg = `Cakupan TP '${firstMissing.tpIds[0]}' belum terpenuhi pada Unit '${firstMissing.unitId}'.`;
      }

      return res.status(400).json({
        success: false,
        code: 'AI_COVERAGE_MISSING',
        error: firstMsg,
        diagnostic: buildDiagnostic({
          stage: 'COVERAGE_VERIFICATION',
          code: 'AI_COVERAGE_MISSING',
          suggS1Count,
          suggS2Count,
          perUnitMap: perUnitDiagnosticMap,
          missingCoverage: missingCoverageList,
        }),
      });
    }

    return res.json({
      success: true,
      data: { units: sanitizedUnits },
      engine: 'gemini',
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      code: 'AI_GENERATION_ERROR',
      error: err.message || 'Gagal memproses penyusunan AI.',
      diagnostic: buildDiagnostic({
        stage: 'AI_CALL',
        code: 'AI_GENERATION_ERROR',
      }),
    });
  }
});

// Endpoint: AI Recommend Meeting Reconciliation
app.post('/api/ai/recommend-meeting-reconciliation', async (req, res) => {
  const {
    subject = 'Mata Pelajaran',
    grade = '',
    phase = '',
    unitTitle = '',
    unresolvedMeetingTitle = '',
    sourceMaterials = [],
    sourceAtpSummary = [],
    sourceTpSummary = [],
    adjacentMeetings = [],
    safeOptions = [],
  } = req.body || {};

  if (!Array.isArray(safeOptions) || safeOptions.length === 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_PAYLOAD',
      error: 'Daftar opsi aman (safeOptions) diperlukan dan tidak boleh kosong.',
    });
  }

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      code: 'AI_NOT_CONFIGURED',
      error: 'Layanan AI belum dikonfigurasi pada server.',
    });
  }

  try {
    const ai = createAIClient(apiKey);

    const prompt = `Anda adalah asisten kurikulum pedagogis yang membantu guru menentukan rekomendasi terbaik ketika sebuah Pertemuan Pembelajaran tidak memperoleh slot tanggal aktual pada kalender pendidikan semester.

Aplikasi telah menghitung opsi yang AMAN (safeOptions). Tugas Anda HANYA MEMILIH satu dari safeOptions tersebut secara pedagogis yang paling masuk akal dan efisien bagi guru tanpa mengurangi kualitas/tujuan pembelajaran.

Dilarang keras membuat tanggal, sesi, ID, atau opsi baru yang TIDAK ada di safeOptions.
Dilarang menghapus atau mengubah referensi materi kanonikal.

KONTEKS PEMBELAJARAN:
- Mata Pelajaran: ${subject}
- Kelas / Fase: ${grade} / ${phase}
- Unit / Bab: ${unitTitle}
- Pertemuan Belum Terjadwal (Unresolved): ${unresolvedMeetingTitle}
- Materi Source: ${JSON.stringify(sourceMaterials)}
- Summary ATP: ${JSON.stringify(sourceAtpSummary)}
- Summary TP: ${JSON.stringify(sourceTpSummary)}
- Pertemuan Berdampingan pada Unit Sama: ${JSON.stringify(adjacentMeetings)}

DAFTAR OPSI AMAN YANG TERSEDIA (HANYA PILIH DARI SINI):
${JSON.stringify(safeOptions, null, 2)}

PANDUAN PRIORITAS PEDAGOGIS:
1. "REDUCE" (Padatkan Pertemuan): Pilih jika pertemuan source TIDAK membawa materi kanonikal unik dan pemadatannya tetap menjaga kelengkapan alur.
2. "MERGE" (Gabungkan Pertemuan): Pilih jika cakupan materi source penting untuk digabungkan dengan pertemuan berdampingan pada Unit yang sama.
3. "RESCHEDULE" (Jadwalkan Ulang): Pilih jika pertemuan harus tetap berdiri sendiri dan tersedia slot jadwal pengganti yang cocok.

Format respons WAJIB berupa JSON murni dengan skema berikut:
{
  "action": "RESCHEDULE" | "MERGE" | "REDUCE",
  "candidateDate": "YYYY-MM-DD" (opsional, hanya jika RESCHEDULE),
  "candidateSessionId": "sessionId" (opsional, hanya jika RESCHEDULE),
  "targetMeetingId": "targetMeetingId" (opsional, hanya jika MERGE),
  "suggestedTitle": "Judul Usulan Gabungan" (opsional, untuk MERGE),
  "reason": "Penjelasan pedagogis ringkas (1-2 kalimat) dalam Bahasa Indonesia mengapa solusi ini dipilih."
}`;

    const result = await generateContentWithRetry(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const rawText = result.text || '';
    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    // STRICT SERVER VALIDATION AGAINST safeOptions
    let isValidSelection = false;

    if (parsed.action === 'RESCHEDULE') {
      isValidSelection = safeOptions.some(
        (opt: any) =>
          opt.action === 'RESCHEDULE' &&
          opt.candidateDate === parsed.candidateDate &&
          opt.candidateSessionId === parsed.candidateSessionId
      );
    } else if (parsed.action === 'MERGE') {
      isValidSelection = safeOptions.some(
        (opt: any) =>
          opt.action === 'MERGE' && opt.targetMeetingId === parsed.targetMeetingId
      );
    } else if (parsed.action === 'REDUCE') {
      isValidSelection = safeOptions.some((opt: any) => opt.action === 'REDUCE');
    }

    if (!isValidSelection) {
      return res.status(400).json({
        success: false,
        code: 'AI_RECONCILIATION_INVALID',
        error: 'AI merekomendasikan opsi yang tidak valid atau tidak aman.',
      });
    }

    return res.json({
      success: true,
      recommendation: {
        action: parsed.action,
        candidateDate: parsed.candidateDate,
        candidateSessionId: parsed.candidateSessionId,
        targetMeetingId: parsed.targetMeetingId,
        suggestedTitle: parsed.suggestedTitle,
        reason: parsed.reason || 'Rekomendasi disesuaikan secara pedagogis oleh AI.',
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      code: 'AI_RECONCILIATION_ERROR',
      error: `Gagal memproses rekomendasi AI: ${err.message || String(err)}`,
    });
  }
});

// Endpoint: AI Analyze ATP Unit Mapping (Read-Only Analysis)
app.post('/api/ai/analyze-atp-unit-mapping', async (req, res) => {
  const { subject, grade, phase, tpData, atpData, currentMapping } = req.body || {};

  if (!tpData || !Array.isArray(tpData.items) || tpData.items.length === 0) {
    return res.status(400).json({ error: 'Data TP canonical diperlukan untuk analisis pemetaan.' });
  }

  if (!atpData || !Array.isArray(atpData.items) || atpData.items.length === 0) {
    return res.status(400).json({ error: 'Data ATP canonical diperlukan untuk analisis pemetaan.' });
  }

  if (!currentMapping || !Array.isArray(currentMapping.units) || currentMapping.units.length === 0) {
    return res.status(400).json({ error: 'Data draft Bab / Unit diperlukan untuk analisis pemetaan.' });
  }

  const serverParams = {
    subject,
    grade,
    phase,
    tpData,
    atpData,
    currentMapping,
  };

  const apiKey = resolveApiKey(req);
  if (apiKey) {
    try {
      const ai = createAIClient(apiKey);
      const prompt = buildMappingAnalysisPrompt(serverParams);

      const response = await generateContentWithRetry(ai, {
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      if (response && response.text) {
        let parsed: any;
        try {
          parsed = JSON.parse(response.text);
        } catch {
          const jsonMatch = response.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            parsed = JSON.parse(jsonMatch[1]);
          }
        }

        if (parsed && (Array.isArray(parsed.atpFindings) || Array.isArray(parsed.materialFindings) || Array.isArray(parsed.alignmentProposals))) {
          const sanitized = sanitizeMappingAnalysisResult(parsed, serverParams);
          return res.json({
            success: true,
            data: sanitized,
            engine: 'gemini_ai',
          });
        }
      }
    } catch (err: any) {
      console.warn('[AI Mapping Analysis] AI call failed, falling back to deterministic analyzer:', err?.message || err);
    }
  }

  // Fallback deterministic analysis
  const fallbackResult = fallbackAnalyzeMapping(serverParams);
  return res.json({
    success: true,
    data: fallbackResult,
    engine: 'pedagogical_engine',
  });
});

// 4. Endpoint: AI Refine / Polish any custom text
app.post('/api/ai/refine-text', async (req, res) => {
  const { text, instruction, context } = req.body || {};
  if (!text) {
    return res.status(400).json({ error: 'Teks tidak boleh kosong' });
  }

  // If GEMINI_API_KEY is configured or user key provided, try Gemini AI first
  const apiKey = resolveApiKey(req);
  if (apiKey) {
    try {
      const ai = createAIClient(apiKey);
      const prompt = `Anda adalah asisten ahli administrasi guru Indonesia.
Teks asli: "${text}"
Konteks: ${context || 'Administrasi Kurikulum Merdeka'}
Instruksi perbaikan: ${instruction || 'Sempurnakan tata bahasa, ketepatan pedagogis, dan istilah Kurikulum Merdeka agar lebih formal, jelas, dan operasional.'}

Berikan versi teks hasil penyempurnaan dalam bahasa Indonesia yang baku dan elegan. Langsung berikan teks hasil tanpa pembuka/penutup.`;

      const response = await generateContentWithRetry(ai, {
        contents: prompt,
      });

      if (response.text && response.text.trim().length > 0) {
        return res.json({ success: true, refinedText: response.text.trim(), engine: 'gemini' });
      }
    } catch (error: unknown) {
      console.warn('Gemini refine text failed or unconfigured, using fallback:', error);
    }
  }

  const refined = fallbackRefineText(text, instruction, context);
  res.json({ success: true, refinedText: refined, engine: 'pedagogical_engine' });
});

// Safe phase normalization helper for learning plan
function normalizeExperiencePhase(phase: any): 'UNDERSTAND' | 'APPLY' | 'REFLECT' | null {
  if (typeof phase !== 'string') return null;
  const s = phase.trim().toUpperCase();
  if (s === 'UNDERSTAND' || s === 'MEMAHAMI') {
    return 'UNDERSTAND';
  }
  if (s === 'APPLY' || s === 'MENGAPLIKASI' || s === 'MENGAPLIKASIKAN') {
    return 'APPLY';
  }
  if (s === 'REFLECT' || s === 'MEREFLEKSI' || s === 'MEREFLEKSIKAN') {
    return 'REFLECT';
  }
  return null;
}

// Runtime validator for AI Learning Plan response
export function isPedagogicalItemValid(item: any): boolean {
  return Boolean(
    item &&
    typeof item === 'object' &&
    typeof item.description === 'string' &&
    item.description.trim().length > 0
  );
}

export function validateAILearningPlanPayload(data: any, meetings: { meetingId: string; jp: number }[] = [], academicSetting?: any): { isValid: boolean; reason?: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { isValid: false, reason: 'Payload AI bukan berupa objek valid' };
  }

  // Print-readiness mandatory pedagogical fields for Kurikulum Merdeka
  if (typeof data.initialCompetency !== 'string' || data.initialCompetency.trim() === '') {
    return { isValid: false, reason: 'Kompetensi Awal (initialCompetency) kosong atau tidak valid' };
  }

  const dimVal = validateGraduateProfileDimensions(data.graduateProfileDimensions);
  if (!dimVal.isValid) {
    return { isValid: false, reason: dimVal.error || 'Dimensi Profil Lulusan (graduateProfileDimensions) kosong atau tidak valid' };
  }

  if (!Array.isArray(data.resources) || data.resources.filter((r: any) => r && typeof r === 'object' && ((typeof r.title === 'string' && r.title.trim().length > 0) || (typeof r.source === 'string' && r.source.trim().length > 0))).length === 0) {
    return { isValid: false, reason: 'Sarana dan prasarana / sumber belajar (resources) kosong atau tidak valid' };
  }

  if (typeof data.learningModel !== 'string' || data.learningModel.trim() === '') {
    return { isValid: false, reason: 'Model/praktik pembelajaran (learningModel) kosong atau tidak valid' };
  }

  if (!Array.isArray(data.learningExperiences) || data.learningExperiences.length === 0) {
    return { isValid: false, reason: 'Daftar Pengalaman Belajar (learningExperiences) kosong atau bukan array' };
  }

  const meetingIds = meetings.map(m => m.meetingId);
  const activityValidation = validateLearningPlanActivityMeetings(data, meetingIds, meetingIds.length > 0, meetings, academicSetting);
  if (!activityValidation.isValid) return activityValidation;

  const phaseSet = new Set<string>();
  for (let i = 0; i < data.learningExperiences.length; i++) {
    const exp = data.learningExperiences[i];
    if (!exp || typeof exp !== 'object') {
      return { isValid: false, reason: `Butir pengalaman belajar ke-${i + 1} bukan berupa objek` };
    }
    const normalizedPhase = normalizeExperiencePhase(exp.phase);
    if (!normalizedPhase) {
      return { isValid: false, reason: `Fase pengalaman belajar ke-${i + 1} ('${exp.phase}') tidak valid. Pilihan sah: UNDERSTAND, APPLY, REFLECT` };
    }
    exp.phase = normalizedPhase;
    phaseSet.add(normalizedPhase);

    if (!exp.description || typeof exp.description !== 'string' || exp.description.trim() === '') {
      return { isValid: false, reason: `Deskripsi pengalaman belajar ke-${i + 1} kosong` };
    }

    exp.id = `exp-ai-${i + 1}`;
  }

  for (const phase of ['UNDERSTAND', 'APPLY', 'REFLECT']) {
    if (!phaseSet.has(phase)) {
      return { isValid: false, reason: `Pengalaman Belajar wajib memuat fase ${phase}` };
    }
  }

  if (!data.assessmentPlan || typeof data.assessmentPlan !== 'object' || Array.isArray(data.assessmentPlan)) {
    return { isValid: false, reason: 'Rencana Asesmen (assessmentPlan) wajib berupa objek' };
  }

  const initialItems = Array.isArray(data.assessmentPlan.initial)
    ? data.assessmentPlan.initial.filter(isPedagogicalItemValid)
    : [];
  const formativeItems = Array.isArray(data.assessmentPlan.formative)
    ? data.assessmentPlan.formative.filter(isPedagogicalItemValid)
    : [];
  const summativeItems = Array.isArray(data.assessmentPlan.summative)
    ? data.assessmentPlan.summative.filter(isPedagogicalItemValid)
    : [];

  if (initialItems.length === 0) {
    return { isValid: false, reason: 'Rencana Asesmen Awal (initial) tidak memuat item pedagogis valid' };
  }
  if (formativeItems.length === 0) {
    return { isValid: false, reason: 'Rencana Asesmen Formatif (formative) tidak memuat item pedagogis valid' };
  }
  if (summativeItems.length === 0) {
    return { isValid: false, reason: 'Rencana Asesmen Sumatif (summative) tidak memuat item pedagogis valid' };
  }

  if (data.triggerQuestions !== undefined && !Array.isArray(data.triggerQuestions)) {
    return { isValid: false, reason: 'Pertanyaan pemantik (triggerQuestions) harus berupa array' };
  }

  // Normalize arrays
  data.triggerQuestions = Array.isArray(data.triggerQuestions) ? data.triggerQuestions : [];
  data.resources = Array.isArray(data.resources) ? data.resources : [];
  data.graduateProfileDimensions = Array.isArray(data.graduateProfileDimensions) ? data.graduateProfileDimensions : [];
  if (data.reflection && typeof data.reflection === 'object') {
    data.reflection = {
      teacherReflection: typeof data.reflection.teacherReflection === 'string'
        ? data.reflection.teacherReflection
        : (typeof data.reflection.teacher === 'string' ? data.reflection.teacher : undefined),
      studentReflection: typeof data.reflection.studentReflection === 'string'
        ? data.reflection.studentReflection
        : (typeof data.reflection.student === 'string' ? data.reflection.student : undefined),
    };
  }
  delete data.allocatedJP;

  return { isValid: true };
}

export function getFailedAssessmentGroups(data: any): string[] {
  const failedGroups: string[] = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    failedGroups.push('Format JSON Modul Ajar');
    return failedGroups;
  }
  if (!data.assessmentPlan || typeof data.assessmentPlan !== 'object' || Array.isArray(data.assessmentPlan)) {
    failedGroups.push('Struktur assessmentPlan (wajib objek dengan initial, formative, summative)');
    return failedGroups;
  }
  const initialItems = Array.isArray(data.assessmentPlan.initial)
    ? data.assessmentPlan.initial.filter(isPedagogicalItemValid)
    : [];
  const formativeItems = Array.isArray(data.assessmentPlan.formative)
    ? data.assessmentPlan.formative.filter(isPedagogicalItemValid)
    : [];
  const summativeItems = Array.isArray(data.assessmentPlan.summative)
    ? data.assessmentPlan.summative.filter(isPedagogicalItemValid)
    : [];

  if (initialItems.length === 0) failedGroups.push('initial (Asesmen Diagnostik Awal)');
  if (formativeItems.length === 0) failedGroups.push('formative (Asesmen Formatif)');
  if (summativeItems.length === 0) failedGroups.push('summative (Asesmen Sumatif)');

  return failedGroups;
}

export function buildLearningPlanRepairPrompt(params: {
  parsed: any;
  validationReason?: string;
  failedGroups: string[];
  topic?: string;
  tps: any[];
  meetings?: any[];
  canonicalAllocatedJP?: number;
}): string {
  const { parsed, validationReason, failedGroups, topic, tps, meetings, canonicalAllocatedJP } = params;
  return `PERINGATAN PERBAIKAN STRUKTUR MODUL AJAR:
Hasil keluaran sebelumnya tidak memenuhi syarat validasi pedagogis Modul Ajar Kurikulum Merdeka.
Alasan kegagalan: "${validationReason || 'Rencana Asesmen tidak lengkap'}"
${failedGroups.length > 0 ? `Kelompok asesmen yang gagal/kosong: ${failedGroups.join(', ')}.` : ''}

INSTRUKSI PERBAIKAN (WAJIB DIPATUHI SECARA MUTLAK):
1. Perbaiki dan lengkapi bagian Rencana Asesmen (assessmentPlan):
   - Wajib memiliki 'initial' (minimal 1 butir item dengan description tidak kosong).
   - Wajib memiliki 'formative' (minimal 1 butir item dengan description tidak kosong).
   - Wajib memiliki 'summative' (minimal 1 butir item dengan description tidak kosong).
   - Setiap butir asesmen WAJIB memiliki 'description' yang spesifik, operasional, dan relevan dengan TP/materi, bukan teks generik. Sertakan juga 'technique' dan 'instrument'.
2. PERTAHANKAN seluruh data asli yang sudah ada:
   - Judul & Topik Bab: ${topic || tps[0]?.contentScope || tps[0]?.statement || 'Topik Pembelajaran'}
   - Rujukan TP (${tps.length} butir) dan ATP
   - Struktur ${meetings && meetings.length > 0 ? `${meetings.length} pertemuan` : 'pertemuan kanonikal'}
   - Acuan KKTP jika tersedia
   - Pengalaman Belajar (UNDERSTAND, APPLY, REFLECT)
   - Alokasi waktu kanonikal: ${canonicalAllocatedJP ? `${canonicalAllocatedJP} JP` : 'tetap sesuai rancangan'}
3. Jika scope meeting tersedia, setiap learningExperience/learningStep wajib memiliki learningMeetingId EXACT dari daftar: ${JSON.stringify((meetings || []).map(m => m.meetingId))}. Setiap meeting wajib memiliki learningSteps.opening + core + closing, deskripsi nonblank dan durationMinutes > 0; jumlah menit tiga fase harus tepat durationMinutes pada anggaran meeting (jp × minutesPerJP dari konteks kurikulum). learningExperiences hanya pendekatan kegiatan inti, bukan pengganti fase atau tambahan durasi. Anggaran canonical: ${JSON.stringify(meetings || [])}. Jangan infer ID dari urutan, judul atau TP. Jika scope tidak tersedia, jangan buat learningMeetingId.
3a. Opening ringkas mencakup salam, sapa, kabar/kesiapan, kehadiran, apersepsi materi sebelumnya, fokus materi hari ini, kaitan kehidupan sehari-hari, afirmasi/motivasi. Closing mencakup refleksi/cek pemahaman, simpulan, tindak lanjut bila relevan, apresiasi, salam; PJOK boleh pendinginan sesuai konteks.
4. JANGAN menghasilkan asesmen fiktif, JANGAN mengosongkan kelompok asesmen '${failedGroups.join(', ') || 'apapun'}', dan JANGAN menggunakan placeholder generik.

Draft JSON sebelumnya yang memerlukan perbaikan:
${JSON.stringify(parsed || {}, null, 2)}

Kembalikan dokumen JSON Modul Ajar lengkap yang telah diperbaiki sesuai schema yang valid.`;
}

export const learningPlanResponseSchema = {
  type: Type.OBJECT,
  required: [
    'learningExperiences',
    'learningSteps',
    'initialCompetency',
    'graduateProfileDimensions',
    'resources',
    'learningModel',
    'assessmentPlan',
  ],
  properties: {
    title: { type: Type.STRING },
    topic: { type: Type.STRING },
    initialCompetency: { type: Type.STRING, description: 'Kompetensi awal atau prasyarat pembelajaran' },
    graduateProfileDimensions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '2-4 Dimensi Profil Lulusan kanonikal yang relevan',
    },
    learningModel: { type: Type.STRING, description: 'Model atau praktik pembelajaran kontekstual' },
    resources: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
        },
        required: ['title'],
      },
      description: 'Daftar sarana dan prasarana / sumber belajar',
    },
    meaningfulUnderstanding: { type: Type.STRING },
    triggerQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    learningExperiences: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          learningMeetingId: { type: Type.STRING, description: 'Exact canonical meetingId from the active meeting scope; required when meetings are provided' },
          phase: { type: Type.STRING, description: 'MUST be UNDERSTAND, APPLY, or REFLECT' },
          description: { type: Type.STRING },
          durationMinutes: { type: Type.NUMBER },
        },
        required: ['phase', 'description'],
      },
    },
    deepLearningContext: {
      type: Type.OBJECT,
      properties: {
        principles: { type: Type.ARRAY, items: { type: Type.STRING } },
        graduateProfileDimensions: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    },
    learningSteps: {
      type: Type.OBJECT,
      required: ['opening', 'core', 'closing'],
      properties: {
        opening: {
          type: Type.ARRAY,
          minItems: 1,
          items: {
            type: Type.OBJECT,
            required: ['learningMeetingId', 'description', 'durationMinutes'],
            properties: {
              learningMeetingId: { type: Type.STRING, description: 'Exact canonical meetingId from the active meeting scope' },
              stepName: { type: Type.STRING },
              description: { type: Type.STRING, minLength: '1', description: 'Nonblank operational activity description' },
              durationMinutes: { type: Type.NUMBER, minimum: 1, description: 'Positive minutes; opening + core + closing per meeting must equal its supplied durationMinutes budget (jp * minutesPerJP)' },
            },
          },
        },
        core: {
          type: Type.ARRAY,
          minItems: 1,
          items: {
            type: Type.OBJECT,
            required: ['learningMeetingId', 'description', 'durationMinutes'],
            properties: {
              learningMeetingId: { type: Type.STRING, description: 'Exact canonical meetingId from the active meeting scope' },
              stepName: { type: Type.STRING },
              description: { type: Type.STRING, minLength: '1', description: 'Nonblank operational activity description' },
              durationMinutes: { type: Type.NUMBER, minimum: 1, description: 'Positive minutes; opening + core + closing per meeting must equal its supplied durationMinutes budget (jp * minutesPerJP)' },
            },
          },
        },
        closing: {
          type: Type.ARRAY,
          minItems: 1,
          items: {
            type: Type.OBJECT,
            required: ['learningMeetingId', 'description', 'durationMinutes'],
            properties: {
              learningMeetingId: { type: Type.STRING, description: 'Exact canonical meetingId from the active meeting scope' },
              stepName: { type: Type.STRING },
              description: { type: Type.STRING, minLength: '1', description: 'Nonblank operational activity description' },
              durationMinutes: { type: Type.NUMBER, minimum: 1, description: 'Positive minutes; opening + core + closing per meeting must equal its supplied durationMinutes budget (jp * minutesPerJP)' },
            },
          },
        },
      },
    },
    assessmentPlan: {
      type: Type.OBJECT,
      description: 'Rencana Asesmen autentik memuat asesmen awal, formatif, dan sumatif',
      required: ['initial', 'formative', 'summative'],
      properties: {
        initial: {
          type: Type.ARRAY,
          minItems: 1,
          description: 'Minimal 1 butir asesmen diagnostik awal pembelajaran yang relevan dengan TP',
          items: {
            type: Type.OBJECT,
            required: ['description'],
            properties: {
              type: { type: Type.STRING },
              technique: { type: Type.STRING },
              method: { type: Type.STRING },
              instrument: { type: Type.STRING },
              description: { type: Type.STRING, description: 'Deskripsi operasional spesifik asesmen awal' },
            },
          },
        },
        formative: {
          type: Type.ARRAY,
          minItems: 1,
          description: 'Minimal 1 butir asesmen formatif proses belajar spesifik terhadap aktivitas dan KKTP',
          items: {
            type: Type.OBJECT,
            required: ['description'],
            properties: {
              type: { type: Type.STRING },
              technique: { type: Type.STRING },
              method: { type: Type.STRING },
              instrument: { type: Type.STRING },
              description: { type: Type.STRING, description: 'Deskripsi operasional spesifik asesmen formatif' },
            },
          },
        },
        summative: {
          type: Type.ARRAY,
          minItems: 1,
          description: 'Minimal 1 butir asesmen sumatif lingkup materi/akhir bab spesifik terhadap capaian TP',
          items: {
            type: Type.OBJECT,
            required: ['description'],
            properties: {
              type: { type: Type.STRING },
              technique: { type: Type.STRING },
              method: { type: Type.STRING },
              instrument: { type: Type.STRING },
              description: { type: Type.STRING, description: 'Deskripsi operasional spesifik asesmen sumatif' },
            },
          },
        },
      },
    },
    differentiation: {
      type: Type.OBJECT,
      properties: {
        content: { type: Type.STRING },
        process: { type: Type.STRING },
        product: { type: Type.STRING },
      },
    },
    reflection: {
      type: Type.OBJECT,
      properties: {
        teacherReflection: { type: Type.STRING },
        studentReflection: { type: Type.STRING },
      },
    },
    enrichmentPlan: { type: Type.STRING },
    remedialPlan: { type: Type.STRING },
  },
};

// Endpoint: AI Generate Learning Plan (Modul Ajar DRAFT)
app.post('/api/ai/generate-learning-plan', async (req, res) => {
  const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const { academicSetting, tps, atpItems, topic, allocatedJP, cognitiveAdaptation, meetings: rawMeetings, kktpCriteria } = req.body || {};

  if (!tps || !Array.isArray(tps) || tps.length === 0) {
    return res.status(400).json({ error: 'Minimal satu Tujuan Pembelajaran (TP) diperlukan untuk menyusun Modul Ajar' });
  }

  if (rawMeetings !== undefined && !Array.isArray(rawMeetings)) {
    return res.status(400).json({ error: 'Scope meeting canonical tidak valid.' });
  }

  const budgets = resolveLearningPlanMeetingBudgets(rawMeetings || [], academicSetting);
  if (!budgets.isValid) return res.status(400).json({ error: budgets.reason });
  const meetings = budgets.meetings;

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      code: 'AI_NOT_CONFIGURED',
      error: 'Layanan AI belum dikonfigurasi pada server.',
    });
  }

  try {
    const ai = createAIClient(apiKey);
    const subject = academicSetting?.subject || '';
    const grade = academicSetting?.grade || '';
    const phase = academicSetting?.phase || '';

    const activeCognitiveAdaptation: CognitiveAdaptationProfile | undefined =
      cognitiveAdaptation ||
      (academicSetting ? getCognitiveAdaptationProfile(academicSetting, grade) : undefined);

    const canonicalAllocatedJP =
      typeof allocatedJP === 'number' && Number.isFinite(allocatedJP) && allocatedJP > 0
        ? allocatedJP
        : undefined;

    const atpContextStr = atpItems && atpItems.length > 0
      ? atpItems.map((a: any, i: number) => {
          const parts: string[] = [];
          if (a.unitTitle && typeof a.unitTitle === 'string' && a.unitTitle.trim()) {
            parts.push(`Unit/Bab: ${a.unitTitle.trim()}`);
          }
          parts.push(`ATP Langkah: ${a.stepNumber || i + 1}`);
          if (a.materialScope && typeof a.materialScope === 'string' && a.materialScope.trim()) {
            parts.push(`Lingkup Materi: ${a.materialScope.trim()}`);
          }
          return `${i + 1}. ${parts.join(', ')}`;
        }).join('\n')
      : 'ATP: Belum tersedia';

    const meetingsContextStr = meetings && Array.isArray(meetings) && meetings.length > 0
      ? meetings.map((m: any, i: number) => {
          const parts: string[] = [];
          parts.push(`Pertemuan ID: ${m.meetingId}`);
          parts.push(`Urutan: ${m.order || i + 1}`);
          parts.push(`Judul: ${m.title || '-'}`);
          if (m.date) parts.push(`Tanggal: ${m.date}`);
          parts.push(`JP: ${m.jp || '-'}`);
          parts.push(`Menit per JP: ${m.minutesPerJP}; anggaran durasi: ${m.durationMinutes} menit`);
          const mats = m.materials || m.materialIds;
          if (mats && Array.isArray(mats)) {
            const matTitles = mats.map((mat: any) => typeof mat === 'string' ? mat : (mat.title || mat.id)).join(', ');
            if (matTitles) parts.push(`Materi: ${matTitles}`);
          }
          if (m.linkedTpIds && m.linkedTpIds.length > 0) {
            parts.push(`TP Terhubung: ${m.linkedTpIds.join(', ')}`);
          }
          if (m.linkedAtpItemIds && m.linkedAtpItemIds.length > 0) {
            parts.push(`ATP Terhubung: ${m.linkedAtpItemIds.join(', ')}`);
          }
          return `${i + 1}. ${parts.join(', ')}`;
        }).join('\n')
      : 'Pertemuan/Meeting: Belum tersedia';

    const kktpContextStr = kktpCriteria && Array.isArray(kktpCriteria) && kktpCriteria.length > 0
      ? kktpCriteria.map((ac: any, i: number) => {
          const indicatorsStr = ac.indicators && Array.isArray(ac.indicators) ? ac.indicators.join('; ') : '-';
          const levelsStr = ac.levels && Array.isArray(ac.levels)
            ? ac.levels.map((lvl: any) => `${lvl.level || lvl.label}: ${lvl.description}`).join(' | ')
            : '-';
          return `${i + 1}. [TP ID: ${ac.tpId || '-'}] Deskripsi Kriteria: ${ac.description || '-'}\n   - Pendekatan: ${ac.approach || ac.method || '-'}\n   - Indikator: ${indicatorsStr}\n   - Kriteria Level/Deskripsi: ${levelsStr}`;
        }).join('\n')
      : 'KKTP/Kriteria Ketercapaian Tujuan Pembelajaran: Belum tersedia secara formal.';

    const prompt = `Anda adalah spesialis penyusun Modul Ajar / RPP Berdiferensiasi Kurikulum Merdeka 2026 (Deep Learning & Kemendikdasmen).
Susun draf Modul Ajar pedagogis yang komprehensif berdasarkan data rujukan berikut:

MATA PELAJARAN: ${subject}
KELAS / FASE: ${grade} / ${phase}
TOPIK: ${topic || tps[0]?.contentScope || tps[0]?.statement || 'Topik Pembelajaran'}
ALOKASI WAKTU KANONIKAL: ${canonicalAllocatedJP ? `${canonicalAllocatedJP} JP` : 'Belum ditentukan'}

TUJUAN PEMBELAJARAN (TP) RUJUKAN:
${tps.map((t: any, i: number) => `${i + 1}. [Kode: ${t.code || '-'}] ${t.statement} (Materi: ${t.contentScope || '-'}, Kompetensi: ${t.competence || '-'})`).join('\n')}

ATP RUJUKAN:
${atpContextStr}

STRUKTUR PERTEMUAN KANONIKAL (WAJIB DIPATUHI):
${meetingsContextStr}

KRITERIA KETERCAPAIAN TUJUAN PEMBELAJARAN (KKTP) SEBAGAI ACUAN ASESMEN:
${kktpContextStr}

INSTRUKSI WAJIB MENGENAI STRUKTUR PERTEMUAN & KKTP:
1. Pertahankan urutan, jumlah, dan lingkup pertemuan kanonikal yang diberikan di atas. Jangan memangkas, mengganti, atau menambah pertemuan.
2. Jika pertemuan canonical tersedia, setiap learningExperience dan setiap learningStep WAJIB memiliki learningMeetingId yang disalin EXACT dari meetingId scope di atas. Untuk SETIAP meeting canonical, wajib isi learningSteps.opening, core, closing dengan description nonblank dan durationMinutes > 0. Total durasi opening + core + closing meeting tersebut harus tepat anggaran durasi meeting yang diberikan (JP aktual × minutesPerJP dari konteks kurikulum). Setiap meeting dapat memiliki anggaran berbeda, termasuk pola 3+2 JP; gunakan anggaran masing-masing ID. Jangan memakai total JP unit untuk satu meeting. Jangan infer ID dari urutan, judul, TP, atau membuat ID baru. learningExperiences UNDERSTAND, APPLY, REFLECT adalah pendekatan kegiatan inti/deep learning; tidak menggantikan opening/closing dan tidak dihitung sebagai tambahan durasi learningSteps. Jika scope pertemuan tidak tersedia, hilangkan learningMeetingId dan pertahankan aktivitas global; jangan mengarang pertemuan.
2a. Opening ringkas memuat salam, sapa, kabar/kesiapan, kehadiran, apersepsi materi sebelumnya, fokus materi hari ini, kaitan kehidupan sehari-hari, afirmasi/motivasi. Closing memuat refleksi/cek pemahaman, simpulan, tindak lanjut bila relevan, apresiasi, salam; PJOK boleh pendinginan sesuai konteks.
3. Batasi topik pembahasan ketat hanya pada Unit, TP, ATP, dan struktur pertemuan kanonikal di atas. Jangan memperluas materi di luar batas-batas tersebut.
4. Alokasi JP total tepat ${canonicalAllocatedJP ? `${canonicalAllocatedJP} JP` : 'sesuai jumlah JP pertemuan'} dan bersifat mutlak dari rancangan pertemuan kanonikal.
5. Jika rujukan KKTP di atas tersedia (bukan 'Belum tersedia'):
   - Gunakan indikator dan kriteria level tersebut secara langsung sebagai acuan utama penyusunan rencana penilaian/asesmen (initial, formative, summative) agar terintegrasi secara autentik.
   - JANGAN mengarang, membuat baru, atau memodifikasi KKTP yang sudah ada.
6. Jika rujukan KKTP belum tersedia (bernilai 'Belum tersedia'):
   - Buat rancangan penilaian/asesmen (initial, formative, summative) secara pedagogis umum/draf yang relevan dengan TP/ATP.
   - JANGAN mengarang kriteria atau indikator KKTP formal baru.

INSTRUKSI INFORMASI UMUM & PEDAGOGIS:
1. "initialCompetency" (Kompetensi Awal): Tuliskan kalimat prasyarat kompetensi awal yang diharapkan (misal: "Murid diharapkan telah mengenal..." atau "Prasyarat pembelajaran meliputi..."). Jangan mengklaim penguasaan murid tanpa asesmen nyata.
2. "graduateProfileDimensions": Pilih 2–4 dimensi profil lulusan yang paling relevan dari 8 dimensi kanonikal: "Keimanan dan Ketakwaan terhadap Tuhan Yang Maha Esa", "Kewargaan", "Penalaran Kritis", "Kreativitas", "Kolaborasi", "Kemandirian", "Kesehatan", "Komunikasi".
3. "resources": Susun daftar sarana, prasarana, atau sumber belajar yang diperlukan atau direncanakan sesuai mata pelajaran dan aktivitas nyata.
4. "learningModel": Tentukan model atau praktik pembelajaran kontekstual yang operasional (misal: "Pembelajaran kontekstual melalui demonstrasi, praktik terbimbing, kolaborasi, dan refleksi").

INSTRUKSI KEGIATAN & ASESMEN:
5. Susun Pengalaman Belajar (learningExperiences) dengan struktur 3 fase utama (UNDERSTAND, APPLY, REFLECT) sesuai panduan 2026. Nilai properti "phase" HARUS salah satu dari: "UNDERSTAND", "APPLY", atau "REFLECT".
6. Setiap Pengalaman Belajar memuat "description" yang jelas dan operasional, serta "durationMinutes" (dalam menit, opsional).
7. Gunakan terminologi "Murid" (bukan peserta didik) dan "Dimensi Profil Lulusan".
8. Rencana Asesmen (assessmentPlan) WAJIB memuat 3 kelompok asesmen secara lengkap, spesifik, dan non-generik:
   a. "initial" (Asesmen Diagnostik Awal): Menilai pengetahuan atau keterampilan prasyarat murid sebelum memulai materi ini. Minimal 1 butir item dengan "description" konkret.
   b. "formative" (Asesmen Formatif Proses Belajar): Memantau dan membimbing proses belajar murid di sepanjang kegiatan/pertemuan, selaras dengan indikator KKTP Bab dan aktivitas Pengalaman Belajar. JANGAN kosong dan JANGAN generik. Minimal 1 butir item dengan "description" konkret.
   c. "summative" (Asesmen Sumatif Lingkup Materi): Menilai ketercapaian seluruh TP pada akhir Bab/Unit materi. Minimal 1 butir item dengan "description" konkret.
   - PENTING: DILARANG KERAS membuat deskripsi asesmen generik seperti sekadar "Tes formatif", "Kuis", "Tanya jawab", atau "Penilaian harian". Deskripsi WAJIB menjelaskan secara eksplisit apa yang dinilai, materi apa yang diukur, serta teknik dan instrumen yang digunakan (misal: "Observasi unjuk kerja dan lembar ceklis saat murid menyusun alur flowchart percabangan secara berkelompok").
   - Setiap butir asesmen WAJIB memiliki properti "description" yang tidak kosong. Lengkapi juga dengan "technique" (misal: Observasi, Kinerja, Tes Tertulis, Portofolio, Jurnal) dan "instrument" (misal: Rubrik Analitik, Lembar Ceklis, Soal Pilihan Ganda & Esai).
9. Sediakan Rencana Diferensiasi (Konten, Proses, Produk).
10. Buat kalimat pemahaman bermakna dan pertanyaan pemantik yang relevan.
${
  activeCognitiveAdaptation ? `11. ADAPTASI KOGNITIF (WAJIB & KAIDAH TUNGGAL):
     - Tingkat Abstraksi: ${activeCognitiveAdaptation.abstractionLevel}
     - Beban Bahasa (Language/Reading Load): ${activeCognitiveAdaptation.languageLoad}
     - Kompleksitas Instruksi: ${activeCognitiveAdaptation.instructionComplexity}
     - Dukungan Visual (Visual Support): ${activeCognitiveAdaptation.visualSupport}
     - Derajat Scaffolding: ${activeCognitiveAdaptation.scaffoldingLevel}
     - Preferensi Konteks: ${activeCognitiveAdaptation.contextPreference || 'Kontekstual'}
     - ATURAN ADAPTASI KOGNITIF:
       1) Pertahankan tuntutan kompetensi TP secara utuh.
       2) Grade/fase tidak boleh otomatis menurunkan level kognitif (jangan menurunkan tuntutan proses kognitif hanya karena kelas rendah).
       3) Sesuaikan abstraksi, bahasa, instruksi, scaffolding, aktivitas, dan bukti belajar sesuai tingkat perkembangan kognitif di atas.
       4) ANALYZE pada kelas awal dapat berupa mengamati, mencoba, membandingkan, memilih, dan memberikan alasan sederhana (BUKAN diturunkan menjadi sekadar hafalan/recall).
       5) Jangan memaksakan HOTS jika tidak sesuai dengan kompetensi TP atau kapasitas perkembangan murid.
       6) Gunakan bahasa, judul, dan rancangan kegiatan yang natural sesuai usia.` : ''
}
${
  canonicalAllocatedJP
    ? `${activeCognitiveAdaptation ? '12' : '11'}. ALOKASI WAKTU KANONIKAL: Lingkup pembelajaran ini memiliki Alokasi Waktu tepat ${canonicalAllocatedJP} JP dari pemetaan waktu semester. Rancang seluruh rangkaian kegiatan dan pengalaman belajar secara proporsional sesuai durasi ${canonicalAllocatedJP} JP tersebut. Jangan menebak, mengubah, atau menyimpulkan angka JP yang berbeda.`
    : `${activeCognitiveAdaptation ? '12' : '11'}. ALOKASI WAKTU: Belum ditentukan. JANGAN mengarang atau memalsukan Alokasi JP.`
}

Kembalikan output JSON sesuai schema.`;

    const response = await generateContentWithRetry(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: learningPlanResponseSchema,
      },
    });

    let parsed = cleanAndParseJSON(response.text, null);
    let validation = validateAILearningPlanPayload(parsed, meetings, academicSetting);

    // AI Recovery: Jika validasi asesmen atau struktur gagal, jalankan MAKSIMAL SATU perbaikan AI
    if (!validation.isValid) {
      const failedGroups = getFailedAssessmentGroups(parsed);
      console.warn(
        `[AI Service][learning-plan][${requestId}] Gemini initial output invalid: "${validation.reason}". Kelompok asesmen gagal: [${failedGroups.join(', ')}]. Menjalankan 1x percobaan perbaikan AI...`
      );

      const repairPrompt = buildLearningPlanRepairPrompt({
        parsed,
        validationReason: validation.reason,
        failedGroups,
        topic,
        tps,
        meetings,
        canonicalAllocatedJP,
      });

      try {
        const repairResponse = await generateContentWithRetry(ai, {
          contents: repairPrompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: learningPlanResponseSchema,
          },
        });

        const repairedParsed = cleanAndParseJSON(repairResponse.text, null);
        const repairedValidation = validateAILearningPlanPayload(repairedParsed, meetings, academicSetting);

        if (repairedValidation.isValid) {
          console.info(`[AI Service][learning-plan][${requestId}] Percobaan perbaikan AI berhasil!`);
          parsed = repairedParsed;
          validation = repairedValidation;
        } else {
          console.warn(
            `[AI Service][learning-plan][${requestId}] Percobaan perbaikan AI tetap gagal: "${repairedValidation.reason}"`
          );
          return res.status(400).json({
            error: `Respons AI tidak memenuhi kualifikasi struktur Modul Ajar setelah perbaikan: ${repairedValidation.reason}`,
            code: 'AI_RESPONSE_VALIDATION_FAILED',
            reason: repairedValidation.reason,
            failedGroups,
          });
        }
      } catch (repairErr: any) {
        console.error(
          `[AI Service][learning-plan][${requestId}] Panggilan perbaikan AI gagal:`,
          repairErr?.message || repairErr
        );
        return res.status(400).json({
          error: `Respons AI tidak memenuhi kualifikasi struktur Modul Ajar: ${validation.reason}. Percobaan perbaikan gagal: ${repairErr.message || 'Error AI'}`,
          code: 'AI_RESPONSE_VALIDATION_FAILED',
          reason: validation.reason,
          failedGroups,
        });
      }
    }

    if (canonicalAllocatedJP) {
      parsed.allocatedJP = canonicalAllocatedJP;
    }

    if (activeCognitiveAdaptation) {
      parsed.cognitiveAdaptation = activeCognitiveAdaptation;
    }

    return res.json({ success: true, data: parsed, engine: 'gemini' });
  } catch (error: any) {
    console.error(`[AI Service][learning-plan][${requestId}] Gemini generate learning plan failed:`, error?.message || error);
    return res.status(500).json({ error: `Gagal menyusun Draf AI Modul Ajar: ${error.message || 'Respons provider AI tidak dapat diproses'}` });
  }
});

// 2. Endpoint: AI Assessment Package Generation (9C.4 / 9C.7)
app.post('/api/ai/generate-assessment-package', async (req, res) => {
  const { systemPrompt, userPrompt } = req.body || {};
  if (!userPrompt) {
    return res.status(400).json({ error: 'User prompt is required' });
  }

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      code: 'AI_NOT_CONFIGURED',
      error: 'Layanan AI belum dikonfigurasi pada server.',
    });
  }

  try {
    const ai = createAIClient(apiKey);
    const response = await generateContentWithRetry(ai, {
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: assessmentAIResponseSchema,
      },
    });

    if (response.text) {
      return res.json({ success: true, rawText: response.text });
    }
  } catch (error: any) {
    console.error('Gemini generate assessment package failed:', error);
    const isAuth = error?.status === 401 || error?.status === 403;
    return res.status(isAuth ? error.status : 500).json({ error: error.message || 'Gagal generate perangkat asesmen via Gemini' });
  }

  return res.status(500).json({ error: 'Gagal menghasilkan perangkat asesmen' });
});

// 3. Endpoint: AI Assessment Target Granular Regeneration (9C.6 / 9C.7)
app.post('/api/ai/regenerate-assessment-target', async (req, res) => {
  const { contract } = req.body || {};
  if (!contract) {
    return res.status(400).json({ error: 'Contract is required' });
  }

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      code: 'AI_NOT_CONFIGURED',
      error: 'Layanan AI belum dikonfigurasi pada server.',
    });
  }

  try {
    const ai = createAIClient(apiKey);
    const systemInstruction = `Anda adalah asisten AI kurikulum dan pembuat soal profesional di Indonesia.
Bantu guru melakukan regenerasi granular (pembaruan bertahap) secara aman untuk target: ${contract.target}.
Target ID: ${contract.targetId}.

Aturan utama:
- Tanggapi HANYA dengan objek JSON valid berisi rincian bidang yang diminta di editableContent.
- Kembalikan bidang yang berubah atau yang baru saja, pertahankan tipe data bidang aslinya.
- Jangan menambahkan penjelasan, markdown block (seperti \`\`\`json), atau teks pengantar lainnya. Tanggapi dengan format mentah JSON objek saja.`;

    const userPrompt = `Lakukan regenerasi target ${contract.target} untuk Target ID: ${contract.targetId}.

Konteks tidak berubah (Immutable Context):
${JSON.stringify(contract.immutableContext, null, 2)}

Materi & Kriteria:
- Kalibrasi Kelas: ${JSON.stringify(contract.gradeCalibration, null, 2)}
- Profil Subjek: ${JSON.stringify(contract.subjectProfile, null, 2)}

Temuan Validasi yang Perlu Diperbaiki (Validation Findings):
${JSON.stringify(contract.validationFindings, null, 2)}

Konten yang Dipertahankan (Preserved Content):
${JSON.stringify(contract.preservedContent, null, 2)}

Konten yang Boleh Diedit & Diminta Regenerasi (Editable/Requested Content):
${JSON.stringify(contract.editableContent, null, 2)}

Hasilkan pembaruan untuk editableContent tersebut dalam format JSON.`;

    const response = await generateContentWithRetry(ai, {
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
      },
    });

    if (response.text) {
      const cleanedText = response.text.trim();
      const parsed = cleanAndParseJSON(cleanedText, null);
      if (parsed) {
        return res.json({ success: true, data: parsed });
      } else {
        return res.status(500).json({ error: 'Gagal parse JSON hasil regenerasi AI' });
      }
    }
  } catch (error: any) {
    console.error('Gemini regenerate assessment target failed:', error);
    const isAuth = error?.status === 401 || error?.status === 403;
    return res.status(isAuth ? error.status : 500).json({ error: error.message || 'Gagal regenerasi granular via Gemini' });
  }

  return res.status(500).json({ error: 'Gagal meregenerasi target asesmen' });
});

// 4. Endpoint: AI Assessment Answer Key Verification (9C.5 / 9C.7)
app.post('/api/ai/verify-assessment-answers', async (req, res) => {
  const { assessmentPackage, itemsToVerify } = req.body || {};
  if (!itemsToVerify || !Array.isArray(itemsToVerify) || itemsToVerify.length === 0) {
    return res.json({ success: true, data: { results: [] } });
  }

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      code: 'AI_NOT_CONFIGURED',
      error: 'Layanan AI belum dikonfigurasi pada server.',
    });
  }

  try {
    const ai = createAIClient(apiKey);
    const systemInstruction = `Anda adalah Verifikator Kunci Jawaban Asesmen (AI Answer Verifier) profesional di Indonesia.
Tugas Anda adalah memverifikasi kebenaran dan ketepatan semantik kunci jawaban untuk butir-butir soal yang diberikan.

Pedoman evaluasi status:
- 'VERIFIED': Kunci jawaban terbukti benar, tepat, dan tidak memiliki ambiguitas berdasarkan pertanyaan dan opsi/pasangan.
- 'REJECTED': Kunci jawaban terbukti SALAH secara faktual/konseptual, opsi yang ditandai benar keliru, atau pasangan menjodohkan salah.
- 'REVIEW': Terdapat ambiguitas soal, ada lebih dari satu opsi yang bisa dianggap benar, teks kunci jawaban mengandung salah ketik fatal, atau butir memerlukan penilaian subjektif guru.

Wajib sertakan alasan ringkas dan jelas pada 'reason'.
Kembalikan HANYA format JSON sesuai schema.`;

    const promptData = itemsToVerify.map((item: any, idx: number) => ({
      index: idx + 1,
      instrumentItemId: item.instrumentItemId,
      itemType: item.itemType,
      prompt: item.prompt,
      stimulus: item.stimulus || undefined,
      options: item.options || undefined,
      premises: item.premises || undefined,
      responses: item.responses || undefined,
      categories: item.categories || undefined,
      proposedAnswerKey: item.proposedAnswerKey || undefined,
    }));

    const userPrompt = `Verifikasi kebenaran kunci jawaban untuk ${itemsToVerify.length} butir soal berikut:
${JSON.stringify(promptData, null, 2)}

Kembalikan hasil verifikasi untuk SETIAP instrumentItemId di atas dalam array results.`;

    const verifyAnswersResponseSchema = {
      type: Type.OBJECT,
      properties: {
        results: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              instrumentItemId: { type: Type.STRING },
              status: { type: Type.STRING, enum: ['VERIFIED', 'REVIEW', 'REJECTED'] },
              reason: { type: Type.STRING },
            },
            required: ['instrumentItemId', 'status', 'reason'],
          },
        },
      },
      required: ['results'],
    };

    const response = await generateContentWithRetry(ai, {
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: verifyAnswersResponseSchema,
      },
    });

    if (response.text) {
      const parsed = cleanAndParseJSON(response.text, null);
      if (parsed && Array.isArray(parsed.results)) {
        return res.json({ success: true, data: parsed });
      }
    }
    return res.status(500).json({ error: 'Gagal parse JSON hasil verifikasi jawaban AI' });
  } catch (error: any) {
    console.error('Gemini verify assessment answers failed:', error);
    const isAuth = error?.status === 401 || error?.status === 403;
    return res.status(isAuth ? error.status : 500).json({ error: error.message || 'Gagal verifikasi jawaban via Gemini' });
  }
});

// 5. Endpoint: AI Assessment Quality Review (9C.5 / 9C.7)
app.post('/api/ai/review-assessment-quality', async (req, res) => {
  const { assessmentPackage, generationPlan, gradeCalibration, subjectProfile } = req.body || {};
  if (!assessmentPackage) {
    return res.status(400).json({ error: 'Assessment package is required' });
  }

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      code: 'AI_NOT_CONFIGURED',
      error: 'Layanan AI belum dikonfigurasi pada server.',
    });
  }

  try {
    const ai = createAIClient(apiKey);
    const systemInstruction = `Anda adalah AI Quality Reviewer profesional untuk kurikulum dan perangkat asesmen di Indonesia.
Tugas Anda adalah menelaah kualitas butir dan instrumen asesmen yang dirancang berdasarkan konten pedagogis nyata, bukan hanya kecocokan ID.

PRINSIP PENJALAJARAN PEDAGOGIS (ALUR ALIGNMENT):
Pahami relasi penurunan berikut dalam setiap butir asesmen:
TP / Objective (tujuan pembelajaran umum)
  → Criterion / KKTP (kriteria ketercapaian tujuan pembelajaran)
    → Assessment Indicator (indikator spesifik apa yang diukur pada butir)
      → Item Soal / Task (pertanyaan/tugas yang dikerjakan murid)
        → Cognitive Demand (tingkat proses kognitif: RECALL_UNDERSTAND, APPLY, ANALYZE_REASON, EVALUATE_CREATE)

Dimensi evaluasi kualitas:
1. CONTENT_ALIGNMENT: Keselarasan materi butir soal dengan isi teks TP/objective, criterion/KKTP, dan indikator asesmen (assessmentIndicator). Butir soal harus benar-benar menguji kompetensi dan materi yang ditargetkan, bukan sekadar cocok ID.
2. COGNITIVE_ALIGNMENT: Keselarasan tingkat kognitif butir soal dengan target kognitif (cognitiveDemand) yang direncanakan. Soal pemahaman/ingatan tidak boleh dilabeli atau menguji penalaran tingkat tinggi, begitu pula sebaliknya.
3. ITEM_CONSTRUCTION: Kualitas konstruksi butir soal (kejelasan pokok soal/stem, tidak ambigu, tidak memberi petunjuk jawaban, opsi homogen).
4. STIMULUS_QUALITY: Kualitas dan relevansi stimulus dengan pertanyaan (jika ada stimulus).
5. ANSWER_VERIFICATION: Kepastian kunci jawaban dan objektivitas penskoran.
6. DISTRACTOR_QUALITY: Kualitas dan efektivitas pilihan pengecoh (hanya untuk butir yang memiliki opsi pilihan ganda).
7. GRADE_LANGUAGE: Kesesuaian bahasa, keterbacaan, dan istilah dengan fase/tingkat kelas murid.
8. SENSITIVITY: Bebas dari bias SARA, diskriminasi gender, politik praktis, atau kekerasan.
9. TRACEABILITY: Keterlacakan pemetaan butir ke kisi-kisi asesmen (keterkaitan item ke kisi-kisi dan indikator).
10. DUPLICATION: Tidak ada pengulangan atau duplikasi materi dan butir soal.

ATURAN TARGET ID SANGAT PENTING:
- Setiap finding untuk butir soal WAJIB menyertakan 'instrumentItemId' yang SAMA PERSIS dengan ID butir soal yang dievaluasi.
- Jika mengevaluasi kisi-kisi atau cakupan umum, gunakan 'coverageUnitId' atau 'unitId' yang ada di data.
- 'DISTRACTOR_QUALITY' HANYA boleh diterapkan pada butir pilihan ganda yang memiliki opsi jawaban.
- Status:
  - 'PASS': Memenuhi standar kualitas dengan baik.
  - 'REVIEW': Terdapat catatan atau saran perbaikan minor yang perlu ditinjau guru.
  - 'FAIL': Terdapat pelanggaran kaidah penulisan fatal yang perlu diganti/diperbaiki.
- 'reason': Penjelasan singkat dan konstruktif dengan merujuk isi pedagogis (tujuan, materi, atau tingkat kognitif).

ATURAN LINKAGE KANONIKAL EKSPLISIT:
- Setiap butir soal (item) memiliki relasi kanonikal eksplisit:
  instrumentItemId → blueprintItemId → coverageUnitId → TP/KKTP/assessmentIndicator → cognitiveDemand
- Reviewer WAJIB menggunakan linkage ID tersebut (blueprintItemId, coverageUnitId, instrumentId, instrumentItemIds) untuk menentukan blueprint, TP, KKTP, indikator asesmen, dan target kognitif milik setiap item.
- DILARANG KERAS menebak atau mereka-reka hubungan antara soal dan kisi-kisi berdasarkan kemiripan teks atau asumsi bebas.`;

    const objectivesList = generationPlan?.generationSpec?.objectives || [];
    const criteriaList = generationPlan?.generationSpec?.criteria || [];
    const coverageUnitsList = generationPlan?.coverageUnits || [];

    const objMap = new Map<string, string>();
    for (const obj of objectivesList) {
      if (obj && obj.id) {
        objMap.set(obj.id, obj.text || (obj as any).statement || '');
      }
    }

    const critMap = new Map<string, string>();
    for (const crit of criteriaList) {
      if (crit && crit.id) {
        const text = crit.description
          ? (crit.name ? `${crit.name}: ${crit.description}` : crit.description)
          : (crit.name || '');
        critMap.set(crit.id, text);
      }
    }

    const covMap = new Map<string, any>();
    for (const cu of coverageUnitsList) {
      if (cu && cu.id) {
        covMap.set(cu.id, cu);
      }
    }

    const compactBlueprint = (assessmentPackage.blueprintItems || []).map((bp: any) => {
      const cov = bp.coverageUnitId ? covMap.get(bp.coverageUnitId) : undefined;
      const objectiveText = bp.objectiveText || objMap.get(bp.objectiveRefId) || (cov ? objMap.get(cov.objectiveRefId) : undefined) || undefined;
      const criterionText = bp.criterionText || (bp.criterionId ? critMap.get(bp.criterionId) : undefined) || (cov?.criterionId ? critMap.get(cov.criterionId) : undefined) || undefined;
      const assessmentIndicator = bp.assessmentIndicator || cov?.assessmentIndicator || undefined;
      const materialOrContext = bp.materialOrContext || cov?.materialOrContext || undefined;

      return {
        id: bp.id,
        coverageUnitId: bp.coverageUnitId,
        objectiveRefId: bp.objectiveRefId,
        objectiveText,
        criterionText,
        assessmentIndicator,
        materialOrContext,
        instrumentType: bp.instrumentType,
        instrumentId: bp.instrumentId,
        instrumentItemIds: bp.instrumentItemIds,
        cognitiveDemand: bp.cognitiveDemand,
        difficultyTarget: bp.difficultyTarget,
      };
    });

    const compactInstruments = (assessmentPackage.instruments || []).map((inst: any) => ({
      id: inst.id,
      type: inst.type,
      title: inst.title,
      items: Array.isArray(inst.items)
        ? inst.items.map((it: any) => {
            const bp = assessmentPackage.blueprintItems?.find(
              (b: any) => b.id === it.blueprintItemId || (Array.isArray(b.instrumentItemIds) && b.instrumentItemIds.includes(it.id))
            );
            return {
              id: it.id,
              blueprintItemId: it.blueprintItemId || (bp ? bp.id : undefined),
              coverageUnitId: it.coverageUnitId || (bp ? bp.coverageUnitId : undefined),
              plannedItemId: it.plannedItemId || undefined,
              cognitiveDemand: it.cognitiveDemand || (bp ? bp.cognitiveDemand : undefined),
              difficultyTarget: it.difficultyTarget || (bp ? bp.difficultyTarget : undefined),
              itemType: it.itemType,
              prompt: it.prompt,
              stimulus: it.stimulus,
              options: it.options ? it.options.map((o: any) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })) : undefined,
            };
          })
        : undefined,
      aspects: inst.aspects,
    }));

    const userPrompt = `Lakukan telaah kualitas untuk perangkat asesmen berikut berdasarkan linkage kanonikal eksplisit:
[instrumentItemId → blueprintItemId → coverageUnitId → TP/KKTP/assessmentIndicator → cognitiveDemand]

Gunakan linkage ID tersebut secara ketat untuk menelaah keselarasan materi (CONTENT_ALIGNMENT) dan kognitif (COGNITIVE_ALIGNMENT) setiap butir soal terhadap TP, KKTP, indikator, dan cognitiveDemand yang telah dipetakan, TANPA menebak berdasarkan kemiripan teks.

Judul Perangkat: ${assessmentPackage.title || '-'}
Kalibrasi Kelas: ${JSON.stringify(gradeCalibration || {}, null, 2)}
Profil Subjek: ${JSON.stringify(subjectProfile || {}, null, 2)}

Kisi-Kisi Asesmen (Blueprint dengan teks rujukan TP, KKTP, Indikator, dan Target Kognitif):
${JSON.stringify(compactBlueprint, null, 2)}

Instrumen & Butir Soal yang Dinilai:
${JSON.stringify(compactInstruments, null, 2)}

Berikan evaluasi kualitas untuk butir-butir soal dan instrumen tersebut dalam format JSON sesuai schema.`;

    const qualityReviewResponseSchema = {
      type: Type.OBJECT,
      properties: {
        findings: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              dimension: {
                type: Type.STRING,
                enum: [
                  'CONTENT_ALIGNMENT',
                  'COGNITIVE_ALIGNMENT',
                  'ITEM_CONSTRUCTION',
                  'STIMULUS_QUALITY',
                  'ANSWER_VERIFICATION',
                  'DISTRACTOR_QUALITY',
                  'GRADE_LANGUAGE',
                  'SENSITIVITY',
                  'TRACEABILITY',
                  'DUPLICATION',
                ],
              },
              status: { type: Type.STRING, enum: ['PASS', 'REVIEW', 'FAIL'] },
              reason: { type: Type.STRING },
              unitId: { type: Type.STRING },
              instrumentItemId: { type: Type.STRING },
              coverageUnitId: { type: Type.STRING },
            },
            required: ['dimension', 'status', 'reason'],
          },
        },
      },
      required: ['findings'],
    };

    const response = await generateContentWithRetry(ai, {
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: qualityReviewResponseSchema,
      },
    });

    if (response.text) {
      const parsed = cleanAndParseJSON(response.text, null);
      if (parsed && Array.isArray(parsed.findings)) {
        return res.json({ success: true, data: parsed });
      }
    }
    return res.status(500).json({ error: 'Gagal parse JSON hasil telaah kualitas AI' });
  } catch (error: any) {
    console.error('Gemini review assessment quality failed:', error);
    const isAuth = error?.status === 401 || error?.status === 403;
    return res.status(isAuth ? error.status : 500).json({ error: error.message || 'Gagal telaah kualitas via Gemini' });
  }
});

// Explicit Express Error Handler for /api routes - guarantees JSON response on any unhandled error or exception
app.use('/api', (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const reqId = (req.headers['x-cp4-request-id'] as string) || '-';
  console.error(`[Express API Error] ${req.method} ${req.originalUrl} | ReqID: ${reqId}:`, err);
  if (res.headersSent) {
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const statusCode = typeof err?.status === 'number' && err.status >= 400 && err.status <= 599
    ? err.status
    : typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode <= 599
    ? err.statusCode
    : 500;
  return res.status(statusCode).json({
    service: CP4_BACKEND_SERVICE,
    requestId: reqId !== '-' ? reqId : undefined,
    code: err?.code || 'INTERNAL_SERVER_ERROR',
    stage: 'server',
    error: err?.message || 'Terjadi kesalahan internal pada server API Express.',
  });
});

// Final /api 404 handler - must return JSON and never fall through to Vite static HTML fallback
app.all('/api/*', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({
    service: CP4_BACKEND_SERVICE,
    error: 'Unknown API route',
    path: req.path
  });
});

// Vite middleware in dev or static files in prod
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Administrasi Guru AI Server running at http://0.0.0.0:${PORT}`);
  });
}

const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.cjs') ||
    process.argv[1].endsWith('server.js') ||
    process.argv[1].includes('server.ts'));

if (isDirectExecution && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer();
}


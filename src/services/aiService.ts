import { checkCP4Backend } from './cpAnalysisBackend';
import { validateCP4Input, validateCP4Targets } from './cpAnalysisDraft';
import type { CP4RepairTarget } from './cpAnalysisAIContract';
import { CP4ResponseError, parseCP4JSON, responseMime, safeResponseInfo } from './cpAnalysisResponse';
import { CP4_RUN_POLICY, initialCP4Trace, newCP4RequestId, isCP4RequestId, sanitizeCP4Trace, type CP4Trace } from './cpAnalysisRun';
import { validateAnalysisAI, type UnderstandingTarget, type AnalysisAIValidation } from './cpAnalysisAIContract';
import { CPAnalysisAIError } from './cpAnalysisAIDiagnostics';
import { validateLearningPlanActivityMeetings, resolveLearningPlanMeetingBudgets } from './learningPlanActivityMeetingService';
import {
  CPElem,
  TPItem,
  ATPItem,
  AcademicSetting,
  LearningPlan,
  TPData,
  ATPData,
  CPAnalysisData,
  ATPUnitMappingData,
  UnitExecutionPlanData,
  AssessmentCriterion,
} from '../types';
import { CognitiveAdaptationProfile, getCognitiveAdaptationProfile } from './cognitiveAdaptationService';
import {
  normalizeLearningExperiencePhase,
  normalizeAIAssessmentPlan,
  normalizeAIReflection,
  normalizeDeepLearningContext,
  normalizeAIResources,
} from './learningPlanService';
import { recordDiagnosticEvent } from './diagnosticService';
import { assignGeneratedTPCodes, CANONICAL_MERDEKA_TP_CODE_REGEX } from './tpCodeContract';

export interface CanonicalCPAnalysisResult {
  trace?: CP4Trace;
  validation?: AnalysisAIValidation;
  generalSummary: string;
  items: Array<{
    elementId?: string;
    elementName: string;
    scopeCode?: string;
    cpText?: string;
    cpCompetence: string;
    materialScope: string;
    meaningfulUnderstanding?: string;
    suggestedTp?: string;
  }>;
  engine?: 'gemini' | 'pedagogical_engine';
}

export interface GenerateTPParams {
  cpGeneral: string;
  cpElements: CPElem[];
  cpAnalysisItems?: any[];
  existingTps?: TPItem[];
  subject: string;
  grade: string;
  phase: string;
  curriculum: string;
  count?: number;
  mode?: 'ALIGN_EXISTING' | 'REBUILD_FROM_UPSTREAM';
}

export interface GenerateTPResult {
  items: TPItem[];
  engine: 'gemini' | 'pedagogical_engine';
}

export interface GenerateATPParams {
  tps: TPItem[];
  cpGeneral: string;
  subject: string;
  grade: string;
  phase: string;
  academicYear: string;
  curriculum?: string;
  semester?: string;
  totalHoursPerWeek?: number;
}

export interface GenerateATPResult {
  rationale: string;
  items: Omit<ATPItem, 'id'>[];
}

export const GEMINI_API_KEY_STORAGE_KEY = 'alco_admin_gemini_api_key';

let inMemoryKey: string | null = null;

export function getGeminiApiKey(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || null;
    }
    return inMemoryKey;
  } catch {
    return inMemoryKey;
  }
}

export function saveGeminiApiKey(key: string): void {
  const trimmed = key.trim();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
    }
    inMemoryKey = trimmed;
    notifyApiKeyUpdated(trimmed);
  } catch {
    inMemoryKey = trimmed;
    notifyApiKeyUpdated(trimmed);
  }
}

export function removeGeminiApiKey(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    }
    inMemoryKey = null;
    notifyApiKeyRemoved();
  } catch {
    inMemoryKey = null;
    notifyApiKeyRemoved();
  }
}

type KeyResolver = (key: string) => void;
type KeyRejecter = (err: Error) => void;

interface PendingKeyRequest {
  resolve: KeyResolver;
  reject: KeyRejecter;
}

let pendingRequests: PendingKeyRequest[] = [];
let modalOpenListeners: ((isOpen: boolean, initialError?: string) => void)[] = [];

export function subscribeApiKeyModal(listener: (isOpen: boolean, initialError?: string) => void): () => void {
  modalOpenListeners.push(listener);
  return () => {
    modalOpenListeners = modalOpenListeners.filter((l) => l !== listener);
  };
}

export function openApiKeyModal(initialError?: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    pendingRequests.push({ resolve, reject });
    modalOpenListeners.forEach((listener) => listener(true, initialError));
  });
}

export function closeApiKeyModal(): void {
  const err = new Error('Penyusunan AI dibatalkan: Kunci API Gemini diperlukan.');
  const requests = [...pendingRequests];
  pendingRequests = [];
  modalOpenListeners.forEach((listener) => listener(false));
  requests.forEach((r) => r.reject(err));
}

export function submitApiKeyFromModal(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) return;
  saveGeminiApiKey(trimmed);
}

function notifyApiKeyUpdated(key: string): void {
  const requests = [...pendingRequests];
  pendingRequests = [];
  modalOpenListeners.forEach((listener) => listener(false));
  requests.forEach((r) => r.resolve(key));
}

function notifyApiKeyRemoved(): void {
  // Key removed
}

export async function ensureGeminiApiKey(): Promise<string> {
  const existing = getGeminiApiKey();
  if (existing && existing.trim()) {
    return existing.trim();
  }
  if (modalOpenListeners.length > 0) {
    return await openApiKeyModal();
  }
  return '';
}

export interface AIBackendReadyResult {
  ready: boolean;
  geminiConfigured: boolean;
  attempts: number;
}

/**
 * Probes the backend /api/health endpoint to ensure preview server is fully warm
 * and retrieves the server-side Gemini configuration state.
 * Performs bounded health check polling (up to maxAttempts) to handle cold starts.
 */
export async function waitForAIBackendReady(
  maxAttempts: number = 6,
  intervalMs: number = 750
): Promise<AIBackendReadyResult> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'cache-control': 'no-cache',
        },
      });

      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.toLowerCase().includes('application/json')) {
        let payload: any = null;
        try {
          payload = await res.json();
        } catch {
          payload = null;
        }

        if (payload && typeof payload === 'object' && payload.status === 'ok') {
          return {
            ready: true,
            geminiConfigured: Boolean(payload.geminiConfigured),
            attempts: attempt,
          };
        }
      } else {
        const text = await res.text().catch(() => '');
        lastError = new Error(
          text.includes('Starting Server')
            ? 'Runtime preview sedang memulai ulang.'
            : `Endpoint health mengembalikan format non-JSON (Status ${res.status}).`
        );
      }
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const err = new Error(
    'Runtime preview belum siap menerima request API. Backend health check gagal.'
  );
  (err as any).attempts = maxAttempts;
  (err as any).lastError = lastError;
  throw err;
}

export interface AIFetchPolicy {
  preferLocalKeyOnFirstRequest?: boolean;
}

export async function aiFetch(
  url: string,
  options: RequestInit = {},
  policy: AIFetchPolicy = {}
): Promise<Response> {
  const makeRequest = async (currentKey?: string | null): Promise<Response> => {
    const headers = new Headers(options.headers || {});
    if (currentKey && currentKey.trim()) {
      headers.set('X-Gemini-API-Key', currentKey.trim());
    } else {
      headers.delete('X-Gemini-API-Key');
    }
    return fetch(url, {
      ...options,
      headers,
    });
  };

  const localKey = getGeminiApiKey();

  // 1. Request PERTAMA: jika policy.preferLocalKeyOnFirstRequest === true dan localKey tersedia,
  // gunakan local BYOK pada request pertama; jika tidak, request pertama dikirim tanpa key (server key first).
  const firstKey =
    policy.preferLocalKeyOnFirstRequest && localKey && localKey.trim()
      ? localKey.trim()
      : null;

  let res = await makeRequest(firstKey);

  // 2. Jika response 200 adalah pedagogical_engine fallback DAN user punya local BYOK,
  // beri prioritas pada Gemini dengan retry TEPAT SATU KALI memakai key user.
  const activeLocalKey = getGeminiApiKey();
  if (res.ok && activeLocalKey && activeLocalKey.trim()) {
    try {
      const cloned = typeof res.clone === 'function' ? res.clone() : res;
      const bodyJson = await cloned.json().catch(() => null);
      if (bodyJson && bodyJson.engine === 'pedagogical_engine') {
        try {
          const retryRes = await makeRequest(activeLocalKey.trim());
          if (retryRes.status === 401 || retryRes.status === 403) {
            removeGeminiApiKey();
            // Kembalikan fallback valid pertama agar proses tidak gagal
            return res;
          }

          if (retryRes.ok) {
            const contentType = retryRes.headers.get('content-type') || '';
            if (contentType.toLowerCase().includes('application/json')) {
              const retryCloned = typeof retryRes.clone === 'function' ? retryRes.clone() : retryRes;
              const retryBody = await retryCloned.json().catch(() => null);
              if (
                retryBody &&
                typeof retryBody === 'object' &&
                retryBody.engine === 'gemini'
              ) {
                if (url.includes('generate-tp')) {
                  const rawItems = Array.isArray(retryBody.items)
                    ? retryBody.items
                    : null;

                  const hasValidItems =
                    rawItems !== null &&
                    rawItems.length > 0 &&
                    rawItems.every((it: any) => {
                      if (!it || typeof it !== 'object') return false;
                      const stmt = it.statement || it.description;
                      return typeof stmt === 'string' && stmt.trim().length > 0;
                    });

                  if (hasValidItems) {
                    return retryRes;
                  }
                } else if (url.includes('analyze-cp')) {
                  const rawItems = Array.isArray(retryBody.items)
                    ? retryBody.items
                    : Array.isArray(retryBody.data?.items)
                    ? retryBody.data.items
                    : null;

                  const hasValidItems =
                    rawItems !== null &&
                    rawItems.length > 0 &&
                    rawItems.every((it: any) => {
                      if (!it || typeof it !== 'object') return false;
                      return Boolean(it.elementName || it.cpCompetence || it.materialScope);
                    });

                  if (hasValidItems) {
                    return retryRes;
                  }
                } else {
                  return retryRes;
                }
              }
            }
          }
          // Jika retry menghasilkan text/html, 5xx, non-gemini, atau malformed JSON:
          // kembalikan fallback valid pertama
          return res;
        } catch {
          // Network / fetch failure on retry: gunakan fallback valid pertama
          return res;
        }
      }
    } catch {
      // not json or clone failed, return original res
      return res;
    }
  }

  if (res.ok) {
    return res;
  }

  // 3. Penanganan 401 / 403:
  if (res.status === 401 || res.status === 403) {
    if (firstKey) {
      // Request pertama sudah membawa local key dan ditolak 401/403
      removeGeminiApiKey();
      if (modalOpenListeners.length > 0) {
        try {
          const newKey = await openApiKeyModal(
            'Kunci API Gemini tidak valid atau izin ditolak (401/403). Silakan periksa kembali dan masukkan API Key yang benar:'
          );
          if (newKey && newKey.trim()) {
            const freshRes = await makeRequest(newKey.trim());
            if (freshRes.status === 401 || freshRes.status === 403) {
              removeGeminiApiKey();
            }
            return freshRes;
          }
        } catch {
          // Modal cancelled
        }
      }
      return res;
    } else if (localKey && localKey.trim()) {
      // Request pertama tanpa key (server key). Retry tepat satu kali dengan local key.
      const retryRes = await makeRequest(localKey.trim());
      if (retryRes.ok) {
        return retryRes;
      }

      // Jika request yang BENAR-BENAR membawa local key menghasilkan 401/403, barulah key dianggap invalid
      if (retryRes.status === 401 || retryRes.status === 403) {
        removeGeminiApiKey();
        if (modalOpenListeners.length > 0) {
          try {
            const newKey = await openApiKeyModal(
              'Kunci API Gemini tidak valid atau izin ditolak (401/403). Silakan periksa kembali dan masukkan API Key yang benar:'
            );
            if (newKey && newKey.trim()) {
              const freshRes = await makeRequest(newKey.trim());
              if (freshRes.status === 401 || freshRes.status === 403) {
                removeGeminiApiKey();
              }
              return freshRes;
            }
          } catch {
            // Modal cancelled
          }
        }
      }
      return retryRes;
    } else {
      // Tidak ada local BYOK: buka modal jika listener tersedia
      if (modalOpenListeners.length > 0) {
        try {
          const newKey = await openApiKeyModal(
            'Layanan AI memerlukan API Key Gemini (BYOK). Silakan masukkan API Key Anda:'
          );
          if (newKey && newKey.trim()) {
            const freshRes = await makeRequest(newKey.trim());
            if (freshRes.status === 401 || freshRes.status === 403) {
              removeGeminiApiKey();
            }
            return freshRes;
          }
        } catch {
          // Modal cancelled
        }
      }
      return res;
    }
  }

  // 4. Penanganan 503 + AI_NOT_CONFIGURED
  let isNotConfigured = false;
  if (res.status === 503) {
    try {
      const cloned = res.clone();
      const bodyJson = await cloned.json().catch(() => null);
      if (
        bodyJson &&
        (bodyJson.code === 'AI_NOT_CONFIGURED' ||
          (typeof bodyJson.error === 'string' && bodyJson.error.toLowerCase().includes('belum dikonfigurasi')))
      ) {
        isNotConfigured = true;
      }
    } catch {
      // not json or clone failed
    }
  }

  if (isNotConfigured) {
    let keyForRetry = localKey && localKey.trim() ? localKey.trim() : null;
    if (!keyForRetry && modalOpenListeners.length > 0) {
      try {
        keyForRetry = await openApiKeyModal(
          'Layanan AI belum dikonfigurasi pada server. Silakan masukkan API Key Gemini Anda (BYOK):'
        );
      } catch {
        keyForRetry = null;
      }
    }

    if (keyForRetry && keyForRetry.trim()) {
      const retryRes = await makeRequest(keyForRetry.trim());
      if (retryRes.status === 401 || retryRes.status === 403) {
        removeGeminiApiKey();
        if (modalOpenListeners.length > 0) {
          try {
            const freshKey = await openApiKeyModal(
              'Kunci API Gemini tidak valid atau izin ditolak (401/403). Silakan periksa kembali dan masukkan API Key yang benar:'
            );
            if (freshKey && freshKey.trim()) {
              const freshRes = await makeRequest(freshKey.trim());
              if (freshRes.status === 401 || freshRes.status === 403) {
                removeGeminiApiKey();
              }
              return freshRes;
            }
          } catch {
            // Modal cancelled
          }
        }
      }
      return retryRes;
    }
  }

  return res;
}

/**
 * Maps raw backend or fetch errors into a clear, user-friendly Indonesian explanation.
 */
export function formatAIErrorMessage(error: any, actionName: string = 'memproses permintaan'): string {
  if (!error) return `Terjadi kendala saat ${actionName}. Silakan coba lagi.`;
  const raw = (error.message || String(error)).toLowerCase();

  if (raw.includes('dibatalkan') || raw.includes('batal')) {
    return error.message || 'Proses penyusunan AI dibatalkan.';
  }
  if (raw.includes('backend health check gagal') || raw.includes('health check gagal')) {
    return error.message;
  }
  if (raw.includes('layanan ai belum dikonfigurasi') || raw.includes('ai_not_configured')) {
    return 'Layanan AI belum dikonfigurasi pada server.';
  }
  if (raw.includes('starting server') || raw.includes('runtime preview sedang memulai ulang')) {
    return 'Runtime preview sedang memulai ulang atau mengintersep respons API.';
  }
  if (raw.includes('503') || raw.includes('high demand') || raw.includes('unavailable') || raw.includes('spikes in demand')) {
    return 'Layanan AI sedang mengalami lonjakan antrean trafik tinggi. Silakan klik tombol "Coba Lagi" dalam beberapa detik.';
  }
  if (raw.includes('429') || raw.includes('quota') || raw.includes('rate limit')) {
    return 'Batas kuota AI sementara tercapai. Mohon tunggu sebentar lalu coba kembali.';
  }
  if (raw.includes('failed to fetch') || raw.includes('network') || raw.includes('econnrefused')) {
    return 'Gagal terhubung ke server backend AI. Pastikan koneksi internet Anda aktif dan server berjalan.';
  }
  if (raw.includes('api key') || raw.includes('unauthorized') || raw.includes('401') || raw.includes('403')) {
    return 'Kunci API Gemini tidak valid atau belum dikonfigurasi. Silakan periksa kembali API Key Anda.';
  }
  if (raw.includes('timeout') || raw.includes('timed out')) {
    return 'Permintaan AI membutuhkan waktu terlalu lama. Silakan coba kembali dengan cakupan data yang lebih spesifik.';
  }

  return error.message || `Terjadi kesalahan saat ${actionName}. Silakan periksa kembali data Anda.`;
}

const activeCP4Requests=new Set<string>();
export async function analyzeCPWithAI(params: {
  cpText: string; elements: CPElem[]; subject: string; grade: string; phase: string; curriculum: string;
  retryTargets?: UnderstandingTarget[];
  repairTargets?:CP4RepairTarget[];
}, options: number | {timeoutMs?:number; signal?:AbortSignal;requestId?:string} = {}): Promise<CanonicalCPAnalysisResult> {
  if(validateCP4Input(params.elements).length)throw new CPAnalysisAIError('CP_INPUT_INVALID','request');
  if(params.repairTargets && !validateCP4Targets(params.repairTargets,params.elements))throw new CPAnalysisAIError('RETRY_TARGET_INVALID','request');
  const settings=typeof options==='number'?{timeoutMs:options}:options;
  const timeoutMs=Math.max(1,Math.min(CP4_RUN_POLICY.totalMs,settings.timeoutMs ?? CP4_RUN_POLICY.totalMs));
  const requestId=isCP4RequestId(settings.requestId)?settings.requestId:newCP4RequestId();
  const localKey=getGeminiApiKey(); // Select once; no server-key/BYOK fallback chain or auth modal retries.
  const started=Date.now(),deadlineAt=started+timeoutMs;
  let trace=initialCP4Trace(requestId,localKey?'local':'server-or-none');
  const failure=(code:string,stage:string)=>new CPAnalysisAIError(code,stage,sanitizeCP4Trace({...trace,elapsedMs:Date.now()-started})!);
  if(activeCP4Requests.has(requestId))throw failure('AI_DUPLICATE_REQUEST','request');
  activeCP4Requests.add(requestId);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let backendReady=false;
  const check=()=>{if(controller.signal.aborted)throw failure(trace.timeoutSource==='client'?'AI_TIMEOUT':'AI_ABORTED',trace.lastStage);if(Date.now()>=deadlineAt){trace.timeoutSource='client';controller.abort();throw failure('AI_TIMEOUT',trace.lastStage);}};
  const request = async (): Promise<CanonicalCPAnalysisResult> => {
    check();trace.lastStage='transport';
    await checkCP4Backend(controller.signal,requestId);
    check();backendReady=true;
    const res = await fetch('/api/ai/analyze-cp', {
      redirect:'error',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CP4-Request-ID':requestId,'X-CP4-Deadline':String(deadlineAt),...(localKey?{'X-Gemini-API-Key':localKey}:{}) },
      body: JSON.stringify(params), signal: controller.signal,
    });
    check();trace.lastStage='response';
    const mime=responseMime(res.headers.get('Content-Type'));
    const echoedId=res.headers.get('X-CP4-Request-ID');
    const echoedService=res.headers.get('X-CP4-Service');
    const isExpressBackend=Boolean(echoedService==='administrasi-guru-ai'||(echoedId&&echoedId===requestId));
    const raw=await res.text();check();
    if(!res.ok) {
      let body:any=null;
      if(mime==='json')try {body=parseCP4JSON(raw,{source:'endpoint',mime,httpStatus:res.status},false);}catch {}
      trace=sanitizeCP4Trace(body?.trace,requestId) || trace;
      const code = ['AI_ABORTED','AI_DUPLICATE_REQUEST','AI_REQUEST_BUSY','AI_NOT_CONFIGURED','AI_PROVIDER_ERROR','AI_TIMEOUT','CP_ELEMENTS_REQUIRED','RETRY_TARGET_INVALID','RESPONSE_INVALID'].includes(body?.code) ? body.code : 'AI_API_ERROR';
      const error=failure(code, ['provider','request','transport','response','validation','apply','backoff','aborted'].includes(body?.stage)?body.stage:'response');
      if(typeof body?.error === 'string' && body.error.trim()) {
        error.message = body.error.trim();
      }
      const reported=safeResponseInfo(body?.responseInfo);
      error.responseInfo=reported?{...reported,httpStatus:res.status}:{source:'endpoint',httpStatus:res.status,mime,reason:mime==='html'?'HTML':'HTTP_ERROR',gatewayIntercepted:!isExpressBackend&&mime==='html'};
      throw error;
    }
    if(mime!=='json')throw new CP4ResponseError({source:'endpoint',httpStatus:res.status,mime,reason:mime==='html'?'HTML':'CONTENT_TYPE',gatewayIntercepted:!isExpressBackend&&mime==='html'});
    const body=parseCP4JSON(raw,{source:'endpoint',httpStatus:res.status,mime},false);
    if(body.engine!==undefined&&!['gemini','pedagogical_engine'].includes(body.engine))throw new CP4ResponseError({source:'endpoint',httpStatus:res.status,mime,reason:'CONTRACT'});
    if(body?.trace && !sanitizeCP4Trace(body.trace,requestId))throw failure('RESPONSE_INVALID','response');
    trace=sanitizeCP4Trace(body?.trace,requestId) || trace;trace.lastStage='validation';
    const payload = body?.data || body;
    if(!payload || !Array.isArray(payload.items) || !payload.items.length)throw new CP4ResponseError({source:'endpoint',httpStatus:res.status,mime,reason:'CONTRACT'});
    const validation = validateAnalysisAI(payload, params.elements, params.retryTargets,params.repairTargets);
    // Server-only semantic coverage findings are additive, not a replacement for client validation.
    if(Array.isArray(body?.validation?.issues)) for(const issue of body.validation.issues) {
      if(['CP_COVERAGE_REVIEW','CANONICAL_REFERENCE_INVALID','DUPLICATE_TARGET','RESPONSE_INVALID'].includes(issue.code)) {
        validation.issues.push({elementId:params.elements.find(e=>e.id===issue.elementId)?.id || '',field:issue.code==='CP_COVERAGE_REVIEW'?'coverage':'items',code:issue.code,clauseIndex:Number.isInteger(issue.clauseIndex)?issue.clauseIndex:undefined,category:issue.code==='CP_COVERAGE_REVIEW'?'quality':'structure'});
      }
    }
    validation.valid=!validation.issues.some(i=>i.category==='technical'||i.category==='structure');
    check();
    return {generalSummary:typeof payload?.generalSummary==='string'?payload.generalSummary:'', items:validation.items,
      engine:body?.engine==='gemini'?'gemini':'pedagogical_engine',validation,trace:{...trace,elapsedMs:Date.now()-started}};
  };
  let onAbort:()=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{
    onAbort=()=>{trace.lastStage='aborted';reject(failure('AI_ABORTED','aborted'));controller.abort();};
    settings.signal?.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>{trace.timeoutSource='client';reject(failure('AI_TIMEOUT',trace.lastStage));controller.abort();},timeoutMs);
    if(settings.signal?.aborted)onAbort();
  });
  try { return await Promise.race([Promise.resolve().then(request),interrupted]); }
  catch(error) {
    if(error instanceof CP4ResponseError){
      const code = error.info.phase === 'health' ? 'BACKEND_UNAVAILABLE' : 'RESPONSE_INVALID';
      const stage = error.info.phase === 'health' ? 'transport' : 'response';
      const invalid = failure(code, stage);
      invalid.responseInfo = error.info;
      throw invalid;
    }
    if(error instanceof CPAnalysisAIError){
      if(!backendReady && ['AI_TIMEOUT','AI_ABORTED'].includes(error.code))error.responseInfo={source:'endpoint',phase:'health',reason:error.code==='AI_TIMEOUT'?'TIMEOUT':'ABORTED'};
      throw error;
    }
    throw failure(controller.signal.aborted?(trace.timeoutSource==='client'?'AI_TIMEOUT':'AI_ABORTED'):'AI_API_ERROR',trace.lastStage);
  } finally {clearTimeout(timer!);settings.signal?.removeEventListener('abort',onAbort);activeCP4Requests.delete(requestId);}
}

export async function generateTPWithAI(params: GenerateTPParams): Promise<GenerateTPResult> {
  try {
    const { existingTps, mode = 'ALIGN_EXISTING', ...payloadToSend } = params;
    const res = await aiFetch('/api/ai/generate-tp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadToSend),
    });

    const contentType = res.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '');
      if (text.includes('Starting Server')) {
        throw new Error('Runtime preview sedang memulai ulang atau mengintersep respons API.');
      }
      const mime = contentType.split(';')[0]?.trim() || contentType || 'unknown';
      throw new Error(`Endpoint AI TP tidak mengembalikan JSON (received ${mime}). (Status ${res.status})`);
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menghasilkan TP dengan AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Respons AI TP tidak valid: format data harus berupa objek.');
    }
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error('Respons AI TP tidak valid: "items" harus berupa array dan tidak boleh kosong.');
    }
    if (
      data.engine &&
      data.engine !== 'gemini' &&
      data.engine !== 'pedagogical_engine'
    ) {
      throw new Error('Respons AI TP tidak memiliki provenance engine yang valid.');
    }
    const resolvedEngine = (data.engine === 'pedagogical_engine' ? 'pedagogical_engine' : 'gemini') as 'gemini' | 'pedagogical_engine';
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (!item || typeof item !== 'object') {
        throw new Error(`Respons AI TP tidak valid: butir ke-${i + 1} bukan objek.`);
      }
      const stmt = item.statement || item.description;
      if (!stmt || typeof stmt !== 'string' || stmt.trim() === '') {
        throw new Error(`Respons AI TP tidak valid: butir ke-${i + 1} tidak memiliki statement/description yang sah.`);
      }
    }

    return {
      items: mergeGeneratedTPsWithExisting(
        data.items,
        params.existingTps || [],
        params.cpAnalysisItems || [],
        mode,
        params.cpElements
      ),
      engine: resolvedEngine,
    };
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'merumuskan Tujuan Pembelajaran'));
  }
}

/**
 * Deterministic safe merge for TP regeneration.
 * Matches generated TPs to existing TPs using strict canonical lineage + semantic identity match.
 * Generated semantic content always wins on match. Supports ALIGN_EXISTING and REBUILD_FROM_UPSTREAM modes.
 */
export function mergeGeneratedTPsWithExisting(
  generatedItems: Array<Partial<TPItem>>,
  existingItems: TPItem[] = [],
  activeAnalysisItems: Array<{ id: string; elementId?: string; elementName?: string; scopeCode?: string; materialScope?: string }> = [],
  mode: 'ALIGN_EXISTING' | 'REBUILD_FROM_UPSTREAM' = 'ALIGN_EXISTING',
  cpElements: CPElem[] = []
): TPItem[] {
  const activeAnalysisItemIds = new Set<string>(
    activeAnalysisItems.map((a) => String(a.id)).filter(Boolean)
  );
  const hasCanonicalAnalysis = activeAnalysisItemIds.size > 0;

  const normalizeText = (s?: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  if (!existingItems || existingItems.length === 0) {
    return assignGeneratedTPCodes(generatedItems.map((g, idx) => {
      const stmt = g.statement || (g as any).description || '';
      return {
        id: g.id || `tp-item-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
        code: g.code || `TP ${idx + 1}`,
        scopeCode: g.scopeCode || '',
        elementName: g.elementName || '',
        statement: stmt,
        description: stmt,
        competence: g.competence || '',
        contentScope: g.contentScope || '',
        p3Dimensions: Array.isArray(g.p3Dimensions) ? g.p3Dimensions : [],
        order: idx + 1,
        cpAnalysisItemIds: Array.isArray(g.cpAnalysisItemIds) ? g.cpAnalysisItemIds.map(String) : [],
      };
    }), activeAnalysisItems, cpElements);
  }

  const matchedExistingIds = new Set<string>();
  const result: TPItem[] = [];

  for (let i = 0; i < generatedItems.length; i++) {
    const gen = generatedItems[i];
    let bestMatch: TPItem | null = null;

    const genAnalysisIds = Array.isArray(gen.cpAnalysisItemIds)
      ? gen.cpAnalysisItemIds.map(String).filter(Boolean)
      : [];
    let bestScore = 0;
    let ambiguousMatch = false;

    for (const exist of existingItems) {
      if (matchedExistingIds.has(exist.id)) continue;
      const existAnalysisIds = Array.isArray(exist.cpAnalysisItemIds) && exist.cpAnalysisItemIds.length
        ? exist.cpAnalysisItemIds.map(String).filter(Boolean)
        : exist.cpAnalysisId ? [exist.cpAnalysisId] : [];

      // 1. Lineage condition: overlap in cpAnalysisItemIds, valid in active analysis items
      const hasLineageOverlap = genAnalysisIds.some(
        (gId) => existAnalysisIds.includes(gId) && (!hasCanonicalAnalysis || activeAnalysisItemIds.has(gId))
      );

      if (!hasLineageOverlap) continue;

      // 2. Semantic identity addition (at least one of: normalized statement exact match, normalized contentScope exact match, semantic code exact match)
      const genCode = normalizeText(gen.code);
      const existCode = normalizeText(exist.code);
      const isCodeMatch = genCode && existCode && genCode === existCode;

      const genScope = normalizeText(gen.contentScope);
      const existScope = normalizeText(exist.contentScope);
      const isScopeMatch = genScope && existScope && genScope === existScope;

      const genStmt = normalizeText(gen.statement || (gen as any).description);
      const existStmt = normalizeText(exist.statement || exist.description);
      const isStmtMatch = genStmt && existStmt && genStmt === existStmt;

      const score = isStmtMatch ? 4 : isScopeMatch ? (normalizeText(gen.competence) === normalizeText(exist.competence) ? 3 : 2) : isCodeMatch ? 1 : 0;
      if (score > bestScore) {
        bestMatch = exist;
        bestScore = score; ambiguousMatch = false;
      } else if (score > 0 && score === bestScore) {
        ambiguousMatch = true;
      }
    }
    if (ambiguousMatch) bestMatch = null;

    if (bestMatch) {
      matchedExistingIds.add(bestMatch.id);

      // Generated semantics always win
      const finalCode = CANONICAL_MERDEKA_TP_CODE_REGEX.test(bestMatch.code) ? bestMatch.code : gen.code || bestMatch.code;
      const finalScopeCode = gen.scopeCode || bestMatch.scopeCode || '';
      const finalElementName = gen.elementName || bestMatch.elementName || '';
      const finalStatement = gen.statement || (gen as any).description || bestMatch.statement || bestMatch.description || '';
      const finalCompetence = gen.competence || bestMatch.competence || '';
      const finalContentScope = gen.contentScope || bestMatch.contentScope || '';
      const finalP3 = Array.isArray(gen.p3Dimensions) && gen.p3Dimensions.length > 0
        ? gen.p3Dimensions
        : (bestMatch.p3Dimensions || []);
      const finalAnalysisIds = genAnalysisIds.length > 0
        ? genAnalysisIds
        : (bestMatch.cpAnalysisItemIds || []).filter((id) => !hasCanonicalAnalysis || activeAnalysisItemIds.has(id));

      result.push({
        ...bestMatch,
        id: bestMatch.id, // Stable ID preserved
        code: finalCode,
        scopeCode: finalScopeCode,
        elementName: finalElementName,
        statement: finalStatement,
        description: finalStatement,
        competence: finalCompetence,
        contentScope: finalContentScope,
        p3Dimensions: finalP3,
        cpAnalysisItemIds: finalAnalysisIds,
        order: result.length + 1,
      });
    } else {
      const stmt = gen.statement || (gen as any).description || '';
      result.push({
        id: gen.id || `tp-item-${Date.now()}-${i + 1}-${Math.random().toString(36).substring(2, 6)}`,
        code: gen.code || `TP ${result.length + 1}`,
        scopeCode: gen.scopeCode || '',
        elementName: gen.elementName || '',
        statement: stmt,
        description: stmt,
        competence: gen.competence || '',
        contentScope: gen.contentScope || '',
        p3Dimensions: Array.isArray(gen.p3Dimensions) ? gen.p3Dimensions : [],
        order: result.length + 1,
        cpAnalysisItemIds: genAnalysisIds,
      });
    }
  }

  // Mode processing for unmatched existing items
  if (mode === 'ALIGN_EXISTING') {
    for (const exist of existingItems) {
      if (!matchedExistingIds.has(exist.id)) {
        if (!hasCanonicalAnalysis) {
          result.push({
            ...exist,
            order: result.length + 1,
          });
        } else {
          const existIds = Array.isArray(exist.cpAnalysisItemIds) ? exist.cpAnalysisItemIds.map(String) : [];
          const validLineageIds = existIds.filter((id) => activeAnalysisItemIds.has(id));
          if (validLineageIds.length > 0) {
            result.push({
              ...exist,
              cpAnalysisItemIds: validLineageIds,
              order: result.length + 1,
            });
          }
        }
      }
    }
  }
  // If mode === 'REBUILD_FROM_UPSTREAM', unmatched existing TPs are dropped entirely.

  return assignGeneratedTPCodes(result.map((item, idx) => ({ ...item, order: idx + 1 })), activeAnalysisItems, cpElements, new Set(existingItems.map(item => item.id)));
}

export interface GenerateLearningPlanParams {
  academicSetting: AcademicSetting;
  tps: TPItem[];
  atpItems?: ATPItem[];
  topic?: string;
  allocatedJP?: number;
  cognitiveAdaptation?: CognitiveAdaptationProfile;
  meetings?: {
    meetingId: string;
    order: number;
    title: string;
    date?: string;
    jp: number;
    materials?: { id: string; title: string }[];
    linkedTpIds?: string[];
    linkedAtpItemIds?: string[];
  }[];
  kktpCriteria?: AssessmentCriterion[];
}

export async function generateLearningPlanWithAI(params: GenerateLearningPlanParams): Promise<Partial<LearningPlan>> {
  const budgets = resolveLearningPlanMeetingBudgets(params.meetings || [], params.academicSetting);
  if (!budgets.isValid) throw new Error(budgets.reason);
  const paramsWithAdaptation = {
    ...params,
    meetings: budgets.meetings,
    cognitiveAdaptation: params.cognitiveAdaptation || getCognitiveAdaptationProfile(params.academicSetting, params.academicSetting.grade)
  };
  try {
    const res = await aiFetch('/api/ai/generate-learning-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paramsWithAdaptation),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menyusun draf Modul Ajar AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)) {
      throw new Error('Hasil respon AI Modul Ajar tidak berbentuk objek valid.');
    }

    const meetingIds = (params.meetings || []).map(m => m.meetingId);
    const activityValidation = validateLearningPlanActivityMeetings(data.data, meetingIds, meetingIds.length > 0, params.meetings || [], params.academicSetting);
    if (!activityValidation.isValid) throw new Error(activityValidation.reason);

    // Runtime validation and normalization for critical structure
    if (typeof data.data.initialCompetency !== 'string' || data.data.initialCompetency.trim() === '') {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Kompetensi Awal (initialCompetency) yang valid.');
    }
    data.data.initialCompetency = data.data.initialCompetency.trim();

    const rawDimensions = Array.isArray(data.data.graduateProfileDimensions) ? data.data.graduateProfileDimensions : [];
    const validDimensions = rawDimensions.filter((d: any) => typeof d === 'string' && d.trim().length > 0).map((d: any) => d.trim());
    if (validDimensions.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Dimensi Profil Lulusan yang valid.');
    }
    data.data.graduateProfileDimensions = validDimensions;

    const normalizedResources = normalizeAIResources(data.data.resources);
    if (normalizedResources.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Sarana dan Prasarana / Sumber Belajar (resources) yang valid.');
    }
    data.data.resources = normalizedResources;

    if (typeof data.data.learningModel !== 'string' || data.data.learningModel.trim() === '') {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Model/Praktik Pembelajaran (learningModel) yang valid.');
    }
    data.data.learningModel = data.data.learningModel.trim();

    if (!Array.isArray(data.data.learningExperiences) || data.data.learningExperiences.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Pengalaman Belajar (learningExperiences).');
    }

    const phaseSet = new Set<string>();
    for (let i = 0; i < data.data.learningExperiences.length; i++) {
      const exp = data.data.learningExperiences[i];
      if (!exp || typeof exp !== 'object') {
        throw new Error(`Butir pengalaman belajar ke-${i + 1} tidak valid.`);
      }
      const normPhase = normalizeLearningExperiencePhase(exp.phase);
      if (!normPhase) {
        throw new Error(`Fase pengalaman belajar ke-${i + 1} ('${exp.phase}') tidak sah. Pilihan sah: UNDERSTAND, APPLY, REFLECT`);
      }
      exp.phase = normPhase;
      phaseSet.add(normPhase);
      if (!exp.description || typeof exp.description !== 'string' || exp.description.trim() === '') {
        throw new Error(`Deskripsi pengalaman belajar ke-${i + 1} kosong.`);
      }
      exp.id = `exp-ai-${i + 1}`;
    }
    for (const phase of ['UNDERSTAND', 'APPLY', 'REFLECT']) {
      if (!phaseSet.has(phase)) {
        throw new Error(`Hasil respon AI Modul Ajar belum memuat fase ${phase}.`);
      }
    }
    const normalizedAssessmentPlan = normalizeAIAssessmentPlan(data.data.assessmentPlan, params.tps.map((t) => t.id));
    if (normalizedAssessmentPlan.initial.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Rencana Asesmen Awal (initial / diagnostik) yang valid.');
    }
    if (normalizedAssessmentPlan.formative.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Rencana Asesmen Formatif (formative) yang valid.');
    }
    if (normalizedAssessmentPlan.summative.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Rencana Asesmen Sumatif (summative) yang valid.');
    }
    data.data.assessmentPlan = normalizedAssessmentPlan;
    data.data.reflection = normalizeAIReflection(data.data.reflection);
    data.data.deepLearningContext = normalizeDeepLearningContext(data.data.deepLearningContext);
    if (typeof params.allocatedJP === 'number' && params.allocatedJP > 0) {
      data.data.allocatedJP = params.allocatedJP;
    } else {
      delete data.data.allocatedJP;
    }

    if (paramsWithAdaptation.cognitiveAdaptation && !data.data.cognitiveAdaptation) {
      data.data.cognitiveAdaptation = paramsWithAdaptation.cognitiveAdaptation;
    }

    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun Modul Ajar / RPP'));
  }
}

export interface GenerateATPOptions {
  backendReady?: AIBackendReadyResult;
  preferLocalKeyOnFirstRequest?: boolean;
}

export async function generateATPWithAI(
  params: GenerateATPParams,
  options?: GenerateATPOptions
): Promise<GenerateATPResult> {
  try {
    // 1. Health preflight
    let health: AIBackendReadyResult;
    try {
      health = options?.backendReady || (await waitForAIBackendReady());
    } catch (healthErr: any) {
      const attempts = (healthErr as any)?.attempts || 6;
      const reason = healthErr?.message || 'Backend health check gagal.';
      recordDiagnosticEvent({
        scope: 'ATP',
        action: 'ATP_BACKEND_NOT_READY',
        status: 'FAILED',
        metadata: {
          healthAttempts: attempts,
          reason,
        },
      });
      throw healthErr;
    }

    // 2. Resolve key source
    let preferLocalKey = options?.preferLocalKeyOnFirstRequest;
    let localKey = getGeminiApiKey();
    let keySource: 'SERVER' | 'LOCAL' = health.geminiConfigured ? 'SERVER' : 'LOCAL';

    if (preferLocalKey === undefined) {
      if (!health.geminiConfigured) {
        if (!localKey || !localKey.trim()) {
          try {
            localKey = await ensureGeminiApiKey();
          } catch (modalErr: any) {
            throw new Error(modalErr?.message || 'Penyusunan ATP dengan AI dibatalkan: Kunci API Gemini diperlukan.');
          }
          if (!localKey || !localKey.trim()) {
            throw new Error('Penyusunan ATP dengan AI dibatalkan: Kunci API Gemini diperlukan.');
          }
        }
        preferLocalKey = true;
        keySource = 'LOCAL';
      } else {
        preferLocalKey = false;
        keySource = 'SERVER';
      }
    } else {
      keySource = preferLocalKey ? 'LOCAL' : 'SERVER';
    }

    // Catat ATP_BACKEND_READY SEBELUM Generate ATP POST dikirim
    recordDiagnosticEvent({
      scope: 'ATP',
      action: 'ATP_BACKEND_READY',
      status: 'READY',
      metadata: {
        healthAttempts: health.attempts,
        serverGeminiConfigured: health.geminiConfigured,
        localKeyPresent: Boolean(localKey && localKey.trim()),
        keySource,
      },
    });

    // 3. POST ATP TEPAT SATU KALI
    const res = await aiFetch(
      '/api/ai/generate-atp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      },
      {
        preferLocalKeyOnFirstRequest: preferLocalKey,
      }
    );

    let contentType = res.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      const text = await res.text().catch(() => '');

      if (text.includes('Starting Server')) {
        throw new Error(
          'Runtime preview sedang memulai ulang atau mengintersep respons API.'
        );
      }

      const mime =
        contentType.split(';')[0]?.trim() ||
        contentType ||
        'unknown';

      throw new Error(
        `Endpoint AI ATP tidak mengembalikan JSON (received ${mime}). (Status ${res.status})`
      );
    }

    if (!res.ok) {
      let errData: any = {};
      try {
        errData = await res.json();
      } catch {
        errData = {};
      }

      if (errData && errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData?.error || `Gagal menyusun ATP dengan AI (Status ${res.status})`);
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new Error('Respons endpoint AI ATP tidak dapat dibaca sebagai JSON valid.');
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Respons endpoint AI ATP tidak dapat dibaca sebagai JSON valid.');
    }

    if (!data.data || !Array.isArray(data.data.items) || data.data.items.length === 0) {
      throw new Error('Hasil respon AI ATP tidak memuat butir alur yang valid.');
    }

    const normalizedItems = data.data.items.map((item: any, idx: number) => {
      const rawLinked = Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0
        ? item.linkedTpIds.map((id: any) => String(id).trim()).filter(Boolean)
        : item.tpId ? [String(item.tpId).trim()] : [];

      return {
        ...item,
        stepNumber: typeof item.stepNumber === 'number' && item.stepNumber > 0 ? item.stepNumber : idx + 1,
        linkedTpIds: rawLinked,
        focus: item.focus ? String(item.focus).trim() : undefined,
      };
    });

    return {
      rationale: data.data.rationale || '',
      items: normalizedItems,
    };
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun Alur Tujuan Pembelajaran'));
  }
}

export async function refineTextWithAI(params: {
  text: string;
  instruction?: string;
  context?: string;
}): Promise<string> {
  try {
    const res = await aiFetch('/api/ai/refine-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Gagal menyempurnakan teks');
    }

    const data = await res.json();
    return data.refinedText;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyempurnakan kalimat'));
  }
}

export interface TeacherUnitConstraint {
  unitIndex: number;
  unitTitle: string;
}

export interface GenerateATPMappingParams {
  atpItems: Array<{
    id: string;
    stepNumber?: number;
    tpCode: string;
    tpStatement?: string;
    tpContentScope?: string;
    unitTitle?: string;
    materialScope?: string;
  }>;
  subject?: string;
  grade?: string;
  phase?: string;
  targetUnitCount?: number;
  teacherUnits?: TeacherUnitConstraint[];
  completeEmptyOnly?: boolean;
}

export interface ATPMappingResult {
  units: Array<{
    unitIndex: number;
    unitTitle: string;
    description?: string;
  }>;
  mappings: Array<{
    atpItemId: string;
    unitTitle: string;
    materialScope: string;
  }>;
}

export async function generateATPMappingWithAI(
  params: GenerateATPMappingParams
): Promise<ATPMappingResult> {
  try {
    const res = await aiFetch('/api/ai/generate-atp-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menyusun pemetaan Unit/Bab dengan AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data.mappings)) {
      throw new Error('Hasil respon AI Pemetaan Unit tidak memuat data pemetaan yang valid.');
    }
    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun pemetaan Unit/Bab & Lingkup Materi'));
  }
}

export interface GenerateCanonicalATPUnitMappingParams {
  academicSettingId?: string;
  subject?: string;
  grade?: string;
  phase?: string;
  tpData: TPData;
  atpData: ATPData;
  cpAnalysisData?: CPAnalysisData;
  existingMapping?: ATPUnitMappingData;
  targetUnitCount?: number;
  targetMaterialCountPerUnit?: number;
}

export async function generateCanonicalATPUnitMappingWithAI(
  params: GenerateCanonicalATPUnitMappingParams
): Promise<ATPUnitMappingData> {
  try {
    const res = await aiFetch('/api/ai/generate-canonical-atp-unit-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menyusun pemetaan Unit/Bab dengan AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data.units)) {
      throw new Error('Hasil respon AI Pemetaan Unit tidak memuat data Bab / Unit yang valid.');
    }
    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun pemetaan Unit/Bab & Lingkup Materi'));
  }
}

export interface MappingAnalysisResult {
  alignmentProposals?: import('./mappingAlignmentService').AlignmentProposal[];
  gapFindings?: { kind: 'TP' | 'ATP' | 'MATERIAL'; id: string; proposalIds: string[]; reason: string }[];
  engine?: 'gemini_ai' | 'pedagogical_engine';
  summary: {
    totalAtp: number;
    mappedAtp: number;
    unmappedAtp: number;
    alignedAtp: number;
    reviewAtp: number;
    alignableMaterials: number;
    missingMaterialSuggestions: number;
    manualMaterialReview: number;
  };

  atpFindings: Array<{
    id: string;
    atpItemId: string;
    status: 'ALIGNED' | 'UNMAPPED' | 'REVIEW';

    currentUnitId?: string;
    suggestedUnitId?: string;
    suggestedMaterialId?: string;

    supportingTpIds: string[];

    strength?: 'STRONG' | 'MODERATE' | 'LOW';

    reason: string;

    action?: {
      type: 'ASSIGN_ATP_TO_UNIT';
      atpItemId: string;
      targetUnitId: string;
      linkedTpIds: string[];
      targetMaterialId?: string;
    };
  }>;

  materialFindings: Array<{
    id: string;

    status: 'SUPPORTED' | 'ALIGNABLE' | 'MISSING_MATERIAL' | 'MANUAL_REVIEW';

    unitId: string;
    materialId?: string;

    suggestedTitle?: string;

    supportingTpIds: string[];
    supportingAtpItemIds: string[];

    strength?: 'STRONG' | 'MODERATE' | 'LOW';

    reason: string;

    action?: {
      type: 'ADD_MATERIAL_TO_UNIT';
      targetUnitId: string;
      title: string;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
    } | {
      type: 'ALIGN_EXISTING_MATERIAL';
      targetUnitId: string;
      targetMaterialId: string;
      linkedAtpItemIds: string[];
      linkedTpIds: string[];
    } | {
      type: 'RECOVER_ATP_LINEAGE';
      targetUnitId: string;
      targetMaterialId?: string;
      removeAtpItemIds: string[];
      linkedAtpItemIds: string[];
      linkedTpIds: string[];
    };
  }>;
}

export interface AnalyzeATPUnitMappingParams {
  subject?: string;
  grade?: string;
  phase?: string;
  tpData: TPData;
  atpData: ATPData;
  currentMapping: ATPUnitMappingData;
}

export async function analyzeATPUnitMappingWithAI(
  params: AnalyzeATPUnitMappingParams
): Promise<MappingAnalysisResult> {
  try {
    const res = await aiFetch('/api/ai/analyze-atp-unit-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menganalisis pemetaan Unit/Bab (Status ${res.status})`);
    }

    const data = await res.json();
    if (
      !data.data ||
      typeof data.data.summary !== 'object' ||
      !Array.isArray(data.data.atpFindings) ||
      !Array.isArray(data.data.materialFindings)
    ) {
      throw new Error('Hasil respon Analisis Pemetaan tidak memuat struktur data yang valid.');
    }
    return {
      ...data.data,
      engine: data.engine,
    };
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menganalisis pemetaan Bab & Lingkup Materi'));
  }
}

export interface AIMeetingSuggestion {
  title: string;
  materialIds: string[];
  linkedAtpItemIds: string[];
  linkedTpIds: string[];
}

export interface AIUnitMeetingSuggestion {
  unitId: string;
  meetings: AIMeetingSuggestion[];
}

export interface AIMeetingGenerationResult {
  units: AIUnitMeetingSuggestion[];
}

export interface AIMeetingDiagnostic {
  version?: number;
  stage?: string;
  code?: string;
  mappingId?: string;
  planId?: string;
  semester1LastUnitId?: string | null;
  semester1UnitIds?: string[];
  semester2UnitIds?: string[];
  capacity?: {
    semester1: {
      target: number;
      existing: number;
      requestedNew: number;
    };
    semester2: {
      target: number;
      existing: number;
      requestedNew: number;
    };
  };
  generated?: {
    semester1: number;
    semester2: number;
    deltaSemester1: number;
    deltaSemester2: number;
  };
  perUnit?: Array<{
    unitId: string;
    semester: 1 | 2;
    existingCount: number;
    targetNewCount?: number;
    generatedCount: number;
    delta?: number;
    suggestions?: Array<{
      suggestionIndex: number;
      title: string;
      materialIds: string[];
      linkedAtpItemIds: string[];
      linkedTpIds: string[];
    }>;
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
}

export class AIMeetingGenerationError extends Error {
  code?: string;
  diagnostic?: AIMeetingDiagnostic;

  constructor(message: string, code?: string, diagnostic?: AIMeetingDiagnostic) {
    super(message);
    this.name = 'AIMeetingGenerationError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export interface GenerateUnitMeetingsWithAIParams {
  subject?: string;
  grade?: string;
  phase?: string;
  mapping: ATPUnitMappingData;
  tpData: TPData;
  atpData: ATPData;
  currentPlan: UnitExecutionPlanData;
  capacityContext?: {
    semester1LastUnitId: string | null;
    semester1: {
      targetMeetingCount: number;
      totalJP: number;
    };
    semester2: {
      targetMeetingCount: number;
      totalJP: number;
    };
  };
  unitMeetingTargets?: Array<{
    unitId: string;
    semester: 1 | 2;
    existingCount: number;
    newTargetCount: number;
  }>;
}

export async function generateUnitMeetingsWithAI(
  params: GenerateUnitMeetingsWithAIParams
): Promise<AIMeetingGenerationResult> {
  try {
    const res = await aiFetch('/api/ai/generate-unit-meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new AIMeetingGenerationError(
          'Layanan AI belum dikonfigurasi pada server.',
          'AI_NOT_CONFIGURED',
          errData.diagnostic
        );
      }
      const rawMsg = errData.error || `Gagal menyusun draf Pertemuan dengan AI (Status ${res.status})`;
      const formatted = formatAIErrorMessage(rawMsg, 'menyusun draf Pertemuan dengan AI');
      throw new AIMeetingGenerationError(formatted, errData.code, errData.diagnostic);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data.units)) {
      throw new AIMeetingGenerationError('Hasil respon AI tidak memuat data unit meeting yang valid.', 'AI_FORMAT_INVALID');
    }
    return data.data;
  } catch (err: any) {
    if (err instanceof AIMeetingGenerationError) {
      throw err;
    }
    throw new AIMeetingGenerationError(
      formatAIErrorMessage(err, 'menyusun draf Pertemuan dengan AI'),
      'AI_GENERATION_ERROR'
    );
  }
}

import { MeetingReconciliationSafeOption } from './meetingReconciliationService';

export interface AIMeetingReconciliationRecommendation {
  action: 'RESCHEDULE' | 'MERGE' | 'REDUCE';
  candidateDate?: string;
  candidateSessionId?: string;
  targetMeetingId?: string;
  suggestedTitle?: string;
  reason: string;
}

export interface AIMeetingReconciliationRecommendationParams {
  subject: string;
  grade: string;
  phase: string;
  unitTitle: string;
  unresolvedMeetingTitle: string;
  sourceMaterials: string[];
  sourceAtpSummary: string[];
  sourceTpSummary: string[];
  adjacentMeetings: Array<{
    meetingId: string;
    title: string;
    materials: string[];
    isPrevious: boolean;
  }>;
  safeOptions: MeetingReconciliationSafeOption[];
}

export interface AIMeetingReconciliationRecommendationResponse {
  success: boolean;
  code?: string;
  error?: string;
  recommendation?: AIMeetingReconciliationRecommendation;
}

export async function requestMeetingReconciliationAI(
  params: AIMeetingReconciliationRecommendationParams
): Promise<AIMeetingReconciliationRecommendationResponse> {
  try {
    const res = await aiFetch('/api/ai/recommend-meeting-reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        code: errData.code || 'AI_RECONCILIATION_ERROR',
        error: errData.error || `Layanan AI mengalami kendala (${res.status})`,
      };
    }

    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      code: 'AI_RECONCILIATION_ERROR',
      error: `Gagal memproses rekomendasi AI: ${err.message || String(err)}`,
    };
  }
}



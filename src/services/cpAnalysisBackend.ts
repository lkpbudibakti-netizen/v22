import { CP4ResponseError, parseCP4JSON, responseMime, type CP4ResponseInfo } from './cpAnalysisResponse';

// A generic status:ok (or a preview shell) does not identify our Express backend.
export const CP4_BACKEND_SERVICE = 'administrasi-guru-ai';
export const CP4_BACKEND_PROTOCOL = 1;
export async function checkCP4Backend(signal: AbortSignal, requestId: string): Promise<void> {
  const info: CP4ResponseInfo = {source:'endpoint',reason:'CONTRACT',phase:'health'};
  try {
    // 1. Verify GET /api/health
    const resGet = await fetch('/api/health', {
      method: 'GET', cache: 'no-store', redirect: 'error', signal,
      headers: { Accept: 'application/json', 'X-CP4-Request-ID': requestId }
    });
    info.httpStatus = resGet.status;
    info.mime = responseMime(resGet.headers.get('Content-Type'));
    if (!resGet.ok) throw new CP4ResponseError({ ...info, reason: 'HTTP_ERROR' });
    if (info.mime !== 'json') throw new CP4ResponseError({ ...info, reason: info.mime === 'html' ? 'HTML' : 'CONTENT_TYPE', gatewayIntercepted: info.mime === 'html' });
    const bodyGet = parseCP4JSON(await resGet.text(), info, false);
    if (bodyGet.status !== 'ok' || bodyGet.service !== CP4_BACKEND_SERVICE || bodyGet.cpAnalysisProtocol !== CP4_BACKEND_PROTOCOL || bodyGet.requestId !== requestId)
      throw new CP4ResponseError(info);

    // 2. Verify POST /api/ai/analyze-cp-ping to ensure Express POST route is reachable
    const resPost = await fetch('/api/ai/analyze-cp-ping', {
      method: 'POST', cache: 'no-store', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CP4-Request-ID': requestId },
      body: JSON.stringify({ ping: true }),
    });
    info.httpStatus = resPost.status;
    info.mime = responseMime(resPost.headers.get('Content-Type'));
    if (!resPost.ok) throw new CP4ResponseError({ ...info, reason: 'HTTP_ERROR' });
    if (info.mime !== 'json') throw new CP4ResponseError({ ...info, reason: info.mime === 'html' ? 'HTML' : 'CONTENT_TYPE', gatewayIntercepted: info.mime === 'html' });
    const bodyPost = parseCP4JSON(await resPost.text(), info, false);
    if (bodyPost.status !== 'ok' || bodyPost.service !== CP4_BACKEND_SERVICE || bodyPost.diagnostic !== 'express_post_handler_reached')
      throw new CP4ResponseError(info);
  } catch(error) {
    if(signal.aborted)throw error;
    if(error instanceof CP4ResponseError)throw error;
    throw new CP4ResponseError({...info,reason:'NETWORK_ERROR'});
  }
}

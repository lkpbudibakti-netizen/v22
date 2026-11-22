import { CP4_BACKEND_SERVICE, CP4_BACKEND_PROTOCOL } from '../../src/services/cpAnalysisBackend';

// Existing AI/parser fixtures exercise POST responses. Connection failures have their own HTTP suite.
export function withCP4Health(post:typeof fetch):typeof fetch {
  return async(input,options)=>{
    const url = String(input);
    const reqId = new Headers(options?.headers).get('X-CP4-Request-ID');
    if (url === '/api/health') {
      return new Response(JSON.stringify({status:'ok',service:CP4_BACKEND_SERVICE,cpAnalysisProtocol:CP4_BACKEND_PROTOCOL,requestId:reqId}),{headers:{'Content-Type':'application/json'}});
    }
    if (url === '/api/ai/analyze-cp-ping') {
      return new Response(JSON.stringify({status:'ok',diagnostic:'express_post_handler_reached',service:CP4_BACKEND_SERVICE,requestId:reqId}),{headers:{'Content-Type':'application/json'}});
    }
    return post(input,options);
  };
}

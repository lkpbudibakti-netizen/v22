# Step 4: Preview API connection audit

## Evidence and limits (2026-10-30)

The reported symptom is HTTP 200 with HTML for POST `/api/ai/analyze-cp`.
The repository's Express application registers this API before Vite/static middleware.
Its `/api/*` JSON 404 guard precedes both middleware stacks; the production SPA
fallback handles GET only. There is no Vite proxy because `npm run dev` starts
`tsx server.ts`, which hosts Express and Vite in one process on `PORT` (default 3000),
listening on `0.0.0.0`. `npm run build` builds both client and server;
`npm start` and `npm run preview` run `dist/server.cjs`. `preview:static` is frontend only.
No port, proxy, deployment, Gemini configuration, prompt or AI retry policy was changed.

The user supplied the AI Studio app link. Reading its Preview iframe located the
actual preview origin. A keyless, empty POST to that origin, **without a preview
session**, reproduced:

| Request | Redirect policy | HTTP | Result |
| --- | --- | --- | --- |
| GET `/api/health` | manual | 302 | HTML redirect present |
| GET `/api/health` | follow | 200 | HTML at `/__cookie_check.html` |
| POST `/api/ai/analyze-cp`, body `{}` | manual | 302 | Location path `/__cookie_check.html` |
| POST `/api/ai/analyze-cp`, body `{}` | follow | 200 | HTML at `/__cookie_check.html` |

This proves a preview cookie/auth gateway can produce the symptom before Express;
it is not evidence of Gemini failure or an Express SPA fallback for that request.
The frontend previously followed redirects by default and had no Step 4 backend
precheck, allowing this HTML to be reported as an invalid AI response.
The user's authenticated failing request and its 33.6-second duration could not
be captured: the browser debugger disconnected. Its exact redirect chain, cookie
state, deployed source revision and startup command remain unverified. No token,
cookie, redirect query, CP text or credentials were saved in this report.

## Changes

Existing GET `/api/health` remains backward compatible and now adds a service ID,
Step 4 protocol version, validated request-ID echo and `Cache-Control: no-store`.
Step 4 performs one keyless health request before its one analysis POST. Both
reject redirects. Health verifies status, JSON MIME, parsed contract and the
request-ID echo; stale cached health or a different server cannot satisfy it.
It shares the existing operation deadline, cancellation and single-flight guard;
there is no polling, new retry, timeout increase or model change.

Failed health stops before sending CP or the local API key. The existing error
area and Salin Diagnosis show BACKEND_UNAVAILABLE with health phase, HTTP/MIME,
safe reason, request ID and elapsed time. Connection timeout/abort retain their
existing code and timeout source with a health-phase annotation. The existing
Clipboard API, legacy copy and manual-copy fallback remain in use. No draft,
storage, workflow, canonical ID or downstream data writer was changed.

## Runtime action outside the repository

1. In the affected preview session, inspect the failing Network request with
   redirect preservation enabled. A final `/__cookie_check.html` identifies the
   preview gateway, not this API. Do not copy authentication query parameters.
2. Open the Preview in its own tab and complete the normal preview-session/cookie
   initialization. If cookies are blocked, inspect the browser's site-specific
   blocking reason; do not change global browser security settings speculatively.
3. Confirm that the AI Studio source copy contains this change and its startup is
   `npm run dev`, with frontend and `/api/*` forwarded to the same Express port.
   A static-only Vite preview does not run backend routes. Do not guess a proxy target.
4. In production run `npm run build` then `npm start`. Confirm health returns the
   service/protocol/request-ID contract and invalid CP POST returns JSON 400
   CP_ELEMENTS_REQUIRED. API routing must not rewrite to an index or login page.

These are verification/configuration steps, not changes made to the external app.

## Verification

`scripts/testStep4BackendConnection.ts` starts the actual complete Express app in
development and production. It checks frontend HTML, correlated noncached JSON
health, actual CP handler JSON 400, unknown API JSON 404 and health-to-analysis
local fallback without a provider key. It also reproduces the cookie redirect
with a real HTTP server and proves the new client does not follow it or submit CP
after failed health. Browser connection failures and timeout/abort are simulated
separately; provider behavior is covered by the existing Step 4 suites.

The existing parser, deadline and meaningful-understanding fixtures now explicitly
provide a healthy backend for their POST-specific scenarios. They still exercise
the original API response, retry, data protection and UI assertions.

Local Express initially could not import because installed debug@2.6.9 and
iconv-lite@0.4.24 source files were missing. Only these exact installed packages
were restored from npm registry archives in ignored node_modules. No dependency
was added and no manifest was changed. There is no root lockfile, so npm ci was
not applicable. This local dependency fault does not prove a fault in AI Studio.

Final results:

| Check | Result |
| --- | --- |
| Actual Express development + production HTTP integration | PASS |
| Real HTTP cookie-check redirect reproduction and rejection | PASS |
| Step 4 P0/P1/P2/P3 hardening | PASS |
| Step 4 deadline, cancellation, SDK mock, late-response/data protection | PASS |
| Meaningful-understanding, targeted retry, UI apply/save, copy fallback + production HTTP | PASS |
| Existing two-semester Step 3–10 compatibility and ZIP restore fixture | PASS; two mapping DOCX exports remain blocked exactly as baseline |
| Production build | PASS |
| TypeScript, exact tsconfig/diagnostics compared against main 1465464 using a virtual compiler host | FAIL baseline: 68 diagnostics on each, zero added/removed |
| Authenticated AI Studio Step 4 execution / live Gemini | NOT VERIFIED; no credentials or provider calls used |

Changed files (this fix only):

- `server.ts`
- `src/services/aiService.ts`
- `src/services/cpAnalysisBackend.ts` (new)
- `src/services/cpAnalysisResponse.ts`
- `src/services/cpAnalysisAIDiagnostics.ts`
- `scripts/testStep4BackendConnection.ts` (new)
- `scripts/fixtures/cp4BackendHealth.ts` (new)
- `scripts/testStep4DeadlineRegression.ts`
- `scripts/testStep4HardeningRegression.ts`
- `scripts/testStep4MeaningfulUnderstandingRegression.ts`
- `docs/step4-preview-backend-audit.md` (this report)

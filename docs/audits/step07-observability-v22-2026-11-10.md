# Step 07 observability audit — 2026-11-10

Baseline: `9f0565c91da5ca301b8ee658d5ae19ffb2778ee4`, branch `main`.

## Confirmed causes and scope

1. **BLOCKED Bab still reach GLOBAL.** `runHybridStep07Repair` stops the local queue for stale results, TIMEOUT, BUDGET_LIMIT, SAVE_FAILED or a CHECKPOINT error. STAGNATED, REPEATED_ISSUES and ordinary INCOMPLETE are not stop conditions. After the queue, `execute('GLOBAL')` is unconditional. This is the existing reconciliation policy; this change records `GLOBAL_WITH_BLOCKED`, counts, IDs and the actual terminal outcomes rather than changing it.
2. **Repeated proposals / apparently unused cache.** The VALIDATE hook sets `cacheUsable=false` for both DONE and BLOCKED. A following repair cycle can therefore call PROPOSE again even though an analysis/proposal object is stored. Reuse additionally depends on exact source/history fingerprints and verification action IDs. Pending checkpoints depend on the full canonical candidate set; completed Bab use their relevant subset. The new trace distinguishes these causes and fingerprints proposal content without depending on AI-generated proposal IDs.
3. **A legacy success flag can mislead diagnostics.** The terminal checkpoint event uses `!result.stale` as its success flag, even for stagnation or transport failure. The report marks inconsistent legacy flags and uses explicit new terminal/HTTP observations and shared readiness. Stored checkpoint flags and repair policy are preserved.
4. **`Unexpected token '<'`.** `analyzeATPUnitMappingWithAI` previously called `res.json()` directly for successful HTTP responses. A 200 HTML response from a static/SPA/proxy route therefore surfaced a JSON SyntaxError. BYOK probing also attempted JSON without first checking the initial response's Content-Type. Step 07 now validates MIME and status before parsing, rejects HTML without recording its body, and preserves typed safe error metadata. The deployed origin of a particular HTML page cannot be established from the user's description alone.
5. **Conditional BYOK engine-contract mismatch.** The analysis endpoint returns `gemini_ai`; the shared retry selector accepts `gemini`. When the first response is `pedagogical_engine` and a BYOK retry returns `gemini_ai`, the existing selector retains the first fallback. The actual endpoint and mocked client retry both reproduce this contract mismatch. It is now visible as `AI_RETRY_ENGINE_MISMATCH` and `FIRST_VALID_FALLBACK`. Selection behavior is deliberately unchanged in this observability task; this is not claimed as the proven cause of the user's specific run without its captured trace.
6. **The previous report dumped the entire checkpoint.** This included identity/source snapshots and large duplicate model histories without structured transport metadata. The new report projects the relevant state and redacts sensitive data; it does not export raw checkpoint JSON.

## Changes

- `step07DiagnosticsService.ts`: bounded per-profile/year ring (160 events and 100000 serialized characters), source/proposal diagnostic hashes, secret/identity redaction, safe transport errors and a reader reusing the existing bounded JSON parser. In-memory fallback is explicit when persistence is unavailable. Ring corruption does not reset the raw buffer or any checkpoint. Cached sanitized reads avoid repeatedly reprocessing the entire ring on each event.
- `step07FullDiagnosticReport.ts`: build/commit/dirty state, mode, active Bab/phase/progress, every Bab's authoritative issues versus checkpoint status, current proposals/evidence/filter/apply/save reasons, checkpoint read/resume/invalidation/persistence information, HTTP attempts/results/fallbacks, stagnation and last successful stage. Raw identity/source fingerprints are replaced with diagnostic hashes. Missing historical transport data is labeled unavailable rather than invented.
- `ATPUnitMappingManager.tsx`: one always-enabled **Salin Diagnostik Lengkap** control. It works without a valid checkpoint and after timeout/reload. The existing Clipboard API → legacy copy → selectable manual-report fallback and notices remain. The report path makes no AI call or draft/checkpoint save.
- `aiService.ts`: scoped JSON-probe guard and passive per-attempt/probe observers; safe Step 07 response parsing and typed errors with status, Content-Type, duration and request ID. Observer failures cannot change retry behavior. Request headers/API key values and response bodies are not logged. Status failures are rejected before body parsing.
- `server.ts`: safe request-ID echo, Server-Timing and fallback category metadata for the existing analysis endpoint. Provider error logging is redacted. Model selection, prompt, semantic sanitization and fallback execution remain unchanged.
- `step07HybridRepairService.ts`, `step07AutoRepairService.ts`, `step07CheckpointService.ts`: passive stage/cache/invalidation/transition/terminal/store observations. No queue, cache eligibility, retry, canonical, apply, validator or readiness rule is changed.
- Regression scripts/package/CI group: observability tests and a 5/9, 12-issue hybrid regression. The previous diagnostic-button source assertion now targets the full report builder.

## Regression evidence

The hybrid test starts from the existing PJOK class 6 fixture, retains five fully supported Bab and removes support-history records from the final four (12 materials) without changing their canonical mappings. Shared readiness reports exactly 12 semantic issues. Empty local proposals produce four BLOCKED Bab; the unchanged queue reaches GLOBAL PROPOSE. A mocked HTTP 200 HTML response is rejected as `API_NON_JSON_RESPONSE`. One report shows 5/9 complete, all 12 issues, GLOBAL/PROPOSE, the HTML MIME/status/request ID and checkpoint outcomes. Checkpoint bytes are compared before/after report generation and remain identical. No raw HTML or test secret is stored.

The dedicated observability cases exercise:

1. HTTP 200 and 503 HTML rejection without reading the body or invoking JSON parsing.
2. HTML mislabeled as JSON, malformed JSON and safe error categories.
3. HTTP JSON errors, fallback response metadata and cancellation/timeout metadata.
4. Ring retention/drop counts, redaction, idempotent source preservation and memory-only fallback on quota failure.
5. A corrupt checkpoint still producing a safe report without reset.
6. The actual copy-controller callback, single enabled button, manual fallback and successful copy confirmation.
7. The actual endpoint callback: request ID, timing, invalid provider JSON, input rejection and `gemini_ai` success metadata.
8. Existing BYOK retry mismatch, proving it is observed while its selection policy remains unchanged.

| Final check | Result |
| --- | --- |
| Dedicated observability suite | PASS, 8/8 |
| Hybrid checkpoint suite, including 5/9 and 12-issue reproduction | PASS, 13 scenario groups |
| Existing auto-repair suite | PASS, 28/28 |
| Planning CI group | PASS, 13/13 scripts |
| Transport CI group | PASS, 5/5 scripts |
| Related Step 07–08 regression scripts | PASS, 21/21 |
| TypeScript | PASS |
| Production build | PASS, existing large-bundle warning |
| Live Gemini / authenticated deployed UI | Not verified |

Evidence: `tmp/step07-observability-proof-final.log`, `tmp/step07-observability-planning.log`, `tmp/step07-observability-transport.log`, `tmp/step07-observability-final-types.log`, `tmp/step07-observability-final-build.log`, `artifacts/ci/step07-observability-related.json`. Artifacts/logs remain ignored and are not committed.

## Limits and remaining work

- This change makes the failure trace actionable; it does not claim to resolve semantic stagnation, change BLOCKED→GLOBAL policy or fix the conditional BYOK engine-label mismatch.
- Live Gemini and the authenticated deployed/browser scenario were not exercised. Provider/network/clipboard and locking boundaries are tested with fixtures/mocks; no live pedagogical success is claimed.
- A response's HTML origin (SPA route, reverse proxy, auth gateway or another intermediary) requires captured metadata/deployment logs. No raw HTML is kept for diagnosis.
- New diagnostic storage is bounded and reports dropped events. Existing checkpoint analysis/response/invalidation archives are not reset or pruned; they can still consume quota. Active proposals/verifications and all existing resume state remain intact.
- Reports redact standard secret patterns and known profile/school fields, omit raw identity snapshots and never store HTTP bodies. Arbitrary personal names embedded in pedagogical prose cannot be reliably identified automatically.
- The existing production bundle-size warning remains.

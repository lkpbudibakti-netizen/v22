# Step 07 validation-driven auto-repair

Baseline: `29a884b0e171d58edb91b3f2a566a609aab43c60`, branch `main`.

## Root causes confirmed in code

1. `runStep07AutoRepair` clamped all runs to three rounds, even when each round made legitimate progress.
2. Its own gap score and semantic-gap list decided whether to continue; the shared Step 08 readiness resolver was consulted only after structural completeness. Upstream readiness failures then caused an immediate break.
3. Follow-up requests carried focus IDs but not the full remaining readiness errors or the reasons prior actions had been rejected.
4. Only a complete run was saved. A timeout/stagnation stop left safe partial work in memory. There was no explicit continuation control after reload.
5. The UI maintained another completion predicate (`autoReady`) alongside shared readiness.
6. Candidate filtering excluded an already-reviewed material even when an additional, substantiated relation was needed to close a Bab's local coverage gap. Filtering now admits that targeted repair through the unchanged semantic/action validators.

The PJOK class 6 fixture remains unchanged: 9 Bab, 27 Materi, 4 Bab / 12 Materi without lineage, with 5/5 TP/ATP covered globally. Global coverage is still insufficient for Step 08.

## Minimal implementation

- `resolveATPUnitMappingReadiness` now exposes identified repair issues for scoped auto-repair. It owns the existing semantic support checks as well as canonical validity, local lineage, coverage, source identity/status and staleness. Existing non-scoped legacy behavior remains unchanged.
- Its `evaluateRepair` option evaluates an in-flight candidate using those same requirements, deferring only the saved-run certificate. It does not defer semantic or canonical checks. Completion is decided only by this resolver's `canProceed`; the saved result is checked again through normal shared readiness, including the certificate. V5 storage retains its normal canonical validation and compare-before-write guard.
- The orchestrator revalidates the complete candidate after each atomic action batch. Every follow-up request includes all current repair issues, their stable IDs and locations, plus the rejected action reasons. A new prompt instruction explains that upstream status/source errors must be reported rather than bypassed by editing canonical TP/ATP.
- The three-round limit is removed. Progress is measured by resolved readiness issue IDs, not a parallel numerical pass threshold. Unit coverage issues have separate IDs per TP/ATP so incremental coverage repairs count as progress.
- Guards: no applied change stops immediately; repeated unresolved issues across two changed rounds or a repeated graph stop safely; total time defaults to 120 seconds and each request to 30 seconds. Default per-invocation cost proxies are 24 requests, 2,000,000 cumulative input characters and 300,000 characters per response. Hard ceilings remain bounded. These are resource proxies, not a currency price guarantee. Snapshot/CAS metadata is excluded from AI input.
- On a guard/provider failure, actual progress is saved in one atomic write only if the canonical validator permits a draft save and the source is still current. Failed/stale batches never overwrite newer manual work. Incomplete checkpoints have no completion certificate and do not unlock Step 08. No-op failures have no new progress to save.
- `Lanjutkan Perbaikan` resumes the saved draft with a fresh bounded request/time budget after an explicit user click. Compatible unfinished runs retain their original snapshot, issue baseline, colors, histories and undo target across reload. Manual graph edits start a fresh baseline rather than silently overwriting those edits.
- UI progress shows initial issues, resolved initial issues and current remaining issues. Remaining issues include newly discovered issues, so they need not always equal initial minus resolved. UI completion uses shared readiness plus the saved/unsaved prerequisite. No approval classification, mutation engine, semantic evidence rule, canonical curriculum or storage architecture is replaced.

## Files and owning functions

| File | Changes |
| --- | --- |
| `src/services/atpMappingReadinessService.ts` | `resolveATPUnitMappingReadiness`: shared pedagogical requirements and located repair issues; candidate evaluation mode |
| `src/services/step07AutoRepairService.ts` | `runStep07AutoRepair`, `focusFor`: validation feedback, continued progress, resource guards, safe checkpoints and continuation metadata |
| `src/components/ATPUnitMappingManager.tsx` | `handleAnalyzeMapping`, readiness memo and status UI: checkpoint handling, progress and continuation button; remove separate completion logic |
| `src/types/index.ts` | Optional backward-compatible repair issue/progress/budget metadata and feedback fields |
| `server/mappingAnalysis.ts` | Existing scoped prompt: use readiness feedback and rejection reasons; preserve canonical source authority |
| `scripts/testStep07AutoRepair.ts` | Existing regression extended to 28 scenarios |
| `scripts/testStep7ApplyActionsEligibilityRegression.ts` | Update source assertion for the single readiness predicate |

## Verification and limits

The existing 21-case suite remains, with three obsolete expectations updated: a fixed three-round stop, refusing to save safe partial progress, and refusing a timeout checkpoint. Seven new scenarios cover real V5 checkpoint/backup/reload/continuation and preserved undo; upstream status/staleness; repeated unresolved issues; rejection feedback; input/output budgets; provider failure/retry; and repairing local Bab coverage using an already-reviewed material while global coverage is full.

With a simulated structured proposer/verifier returning four material repairs per round, the unchanged fixture now completes in **seven rounds**, with 14 requests, all local lineage present, `isValid=true`, `isComplete=true`, one complete save and normal Step 08 readiness true. A six-request budget safely checkpoints an incomplete run; continuation completes it. These results prove execution and persistence behavior under representative provider responses, not live pedagogical model performance.

The initial progress counter is 31: 4 unit-lineage issues, 12 material-lineage issues and 15 existing materials requiring semantic support verification. The all-actions fixture resolves 31/31 with zero remaining issues. A 1365px static desktop rendering of the real component and production CSS was inspected; the progress summary, saved readiness and draft colors rendered correctly. The paused continuation button and disabled Step 08 are checked against the real component markup in the reload regression.

- PASS: 28/28 scoped repair scenarios, including unsafe AI rejection, timeout, stagnation, conflicts, idempotence, histories, manual drift, undo, shared readiness, and actual controller/component tests.
- PASS: full configured local CI, 46/46 scripts (storage 22, planning 11, documents 8, transport 5), exit code 0. Final evidence: `tmp/step07-validation-ci-final.log`, `artifacts/ci/*-results.json`.
- PASS: TypeScript, production build (existing large-bundle warning), and 21/21 related regression scripts. Final evidence: `tmp/step07-validation-types-final.log`, `tmp/step07-validation-build-final.log`, `artifacts/ci/step07-validation-related-final.json`.
- BLOCKED / not verified: live Gemini and an authenticated full-browser run. This task did not access browser BYOK credentials or execute a live-provider fixture. No live completion is claimed.
- Residual risk: semantic model quality and conservative evidence rules can still leave real pedagogical gaps unresolved. The application now preserves safe progress and exposes continuation rather than fabricating completion. Repeated user continuations deliberately start new budgets; there is no unattended retry loop.

Local logs and fixture render artifacts remain ignored under `tmp/` and `artifacts/ci/`; no generated temporary files or user curriculum data are committed.

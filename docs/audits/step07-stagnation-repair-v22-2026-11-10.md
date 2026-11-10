# Step 07 bounded local repair — 2026-11-10

Audit baseline: `700f8a1b4f24a97feb955187cde008d24ffb6f0d`, branch `main`. While this work was running, `main` received `48f2c05` containing the first implementation changes. That commit was preserved; remaining hardening and regression work continues on top of it.

## Confirmed root causes

1. `attachMinimalAlignment` previewed proposals with the existing action engine before the automatic execution path could inspect them. A wrong source quote caused `EVIDENCE_MISSING/TOO_SHORT`, a REJECTED proposal and no executable action. This was textual source failure, not proof of pedagogical mismatch.
2. `validateStep07AutoExecution` correctly rejects unsupported competence/context and negative independent verification. Retrying the same LINK_TP cannot cure missing competence in the original wording.
3. VALIDATE unconditionally disabled the entire proposal/verification cache, including valid results. Cached application filtering also compared UI proposal IDs (`minimal-…`) to raw action IDs, allowing completed work to reappear.
4. Stagnant local results did not stop or isolate local problems from GLOBAL. GLOBAL was entered unconditionally after the queue, despite local unresolved semantics.
5. The previous code recorded repeated proposal fingerprints only for observation; it did not use a persistent attempt state to stop the same unsafe proposal across reloads.
6. The Step 07 endpoint returns `gemini_ai`, while shared BYOK retry selection previously accepted only `gemini`. A successful Step 07 retry could be discarded in favor of the first deterministic fallback.

## Implementation and safety boundaries

- Actions are classified as EVIDENCE_INVALID, SEMANTIC_MISMATCH, STRUCTURAL_CONFLICT, API_FAILURE or NO_PROGRESS. The action ID, phase and reason are retained in checkpoint events, attempt state and bounded diagnostics. Reports expose the classifications.
- `normalizeStep07SourceEvidence` restores exact TP statements/material source quotes only when canonical IDs and the original source binding are valid. Unicode/space/case differences in `before` may be normalized; an unrelated/stale `before` or fabricated ID is not repaired. Source text and canonical TP/ATP are never rewritten by this helper.
- Verification normalization repairs existing source-quote fields (and an existing ADD/MOVE target-unit quote). It does not synthesize evidence items, change a verdict, clear missingEvidence, repair competence/context claims or grant semantic approval. Negative/missing semantic verification remains a rejection. The existing hard-conflict and full canonical validators remain in force.
- Scoped server normalization happens before preview so a textual quote error does not discard an otherwise reviewable action. Legacy/manual callers without the Step 07 scope retain exact-citation rejection behavior.
- Semantic mismatch produces structured, action-specific feedback and the REVISE_MATERIAL strategy. The existing AI prompt requires a measured EDIT_MATERIAL/EDIT_UNIT_TITLE or another permitted action that retains context. Repeated LINK_TP without actual semantic support is not accepted. No automatic DELETE action was added.
- Unchanged local input has at most two no-progress repair attempts. Proposal fingerprints ignore generated IDs and ordering, and compare the actual targets, wording and canonical TP selections. An identical rejected proposal stops before another VERIFY/APPLY. A completed repair or real readiness progress can continue under the existing request/time/input/output budgets; cosmetic edits alone cannot reset the no-progress budget.
- Exhaustion produces NEEDS_TEACHER_REVIEW in checkpoint and saved run metadata. Reloading unchanged review work makes no new AI request. Source/manual edits trigger the existing invalidation mechanism and permit a fresh, source-bound attempt.
- VALIDATE retains usable analysis/proposals and supported verification results. Applied/rejected IDs are handled separately using raw action IDs. Verification is reused only when its per-action material/context/TP/ATP dependency fingerprint still matches. Failed evidence is removed for its action only. Completed legacy VERIFY checkpoints can migrate their exact full-source binding without repeating the model call; unknown legacy dependencies are conservatively reverified rather than treated as approved.
- Local unresolved problems are not rerouted to GLOBAL. GLOBAL performs validation and permitted cross-Bab reconciliation; local actions are filtered out there. After a successful cross-Bab save, affected local status records are reconciled against the same full readiness result. No status is marked DONE merely because an action was proposed.
- API failures, invalid responses, fallback without usable semantic support and timeout pause execution with valid progress retained. They do not consume the semantic teacher-review budget. V5 writes retain compare-before-write, serialized storage access and read-back confirmation.
- BYOK acceptance of `gemini_ai` is limited to `/api/ai/analyze-atp-unit-mapping`. Other endpoint engine contracts, HTTP/JSON validation, and independent semantic checks are unchanged.

## Changed files/functions (logical changes since audit baseline)

| File | Owning change |
| --- | --- |
| `src/services/step07AutoExecutionPolicy.ts` | Failure classification, source citation normalization, semantic-preserving verification normalization, proposal and action dependency fingerprints |
| `src/services/step07AutoRepairService.ts` | Targeted repair strategies, bounded attempts/duplicate guard, per-action feedback and GLOBAL local-action filter |
| `src/services/step07HybridRepairService.ts` | Selective cache retention, legacy migration, persisted review/API status, local/global isolation and reconciliation |
| `src/services/step07CheckpointService.ts` | Optional backward-compatible attempt, rejection, verification dependency and failure metadata |
| `src/services/mappingAlignmentService.ts` | Proposal metadata for source-repair notes/raw action ID; mutation/validator rules preserved |
| `server/mappingMinimalAnalysis.ts` | Scoped source repair before the existing preview |
| `server/mappingAnalysis.ts` | Existing scoped prompt receives category/strategy/action feedback |
| `src/services/aiService.ts` | Step 07-only BYOK engine-label acceptance |
| `src/types/index.ts` | Repair feedback and NEEDS_TEACHER_REVIEW outcome |
| `src/services/step07FullDiagnosticReport.ts` | Failure categories and attempt state in the existing report |
| `src/components/ATPUnitMappingManager.tsx` | Visible teacher-review status in the existing status area |
| `scripts/testStep07HybridCheckpoint.ts`, `scripts/testStep07AutoRepair.ts`, `scripts/testStep07Observability.ts` | Extended hybrid cases, retained semantic rejection tests, and updated BYOK contract expectation |

## Test evidence

The PJOK 9-Bab/27-material fixture is reused. A representative state preserves approved mappings and restores the diagnostic's empty-lineage locations, yielding 16 initial readiness issues. The mocked independent reviewer supports six material actions, resolving those six issues plus two Bab lineage issues. Six unsupported material issues and two Bab issues remain: **16 initial → 8 resolved → 8 remaining**. The valid progress and review status persist in V5, no material is removed, canonical data is unchanged, and Step 08 stays locked. The unresolved eight are deliberately not forced into alignment.

Other cases prove: wrong citations with valid IDs can be repaired; CONFLICT/NEEDS_REVIEW still cannot apply; missing competence changes LINK into a measured wording revision with a fresh positive verification; identical proposals with different IDs do not trigger repeated verification; unchanged review checkpoints resume without model calls; legacy VERIFY checkpoints retain completed work; case-only edits cannot evade the attempt budget; local 5/9 blocked work never calls GLOBAL; legitimate cross-Bab MOVE still works and updates both local statuses; invalid input cannot claim a new save just because an old mapping exists; timeout/reload/manual drift/rollback and empty-lineage Excel import remain covered.

The obsolete negative test treating a bad quote alone as an unrepairable semantic failure was removed from that rejection loop. Negative semantic verdict/missing-competence tests remain, and explicit positive/negative source-repair regressions replace the old expectation. The former global-repeat and BYOK-fallback expectations were updated to the requested behavior.

| Final verification | Result |
| --- | --- |
| Hybrid/checkpoint suite | PASS, 20 scenario groups |
| Existing auto-repair suite | PASS, 28/28 |
| Observability / BYOK contract | PASS, 8/8 |
| Planning CI group | PASS, 13/13 scripts |
| Transport CI group | PASS, 5/5 scripts |
| Related Step 07–08 scripts | PASS, 21/21 |
| TypeScript | PASS |
| Production build | PASS, existing large-bundle warning |
| Live Gemini / authenticated deployed app | Not verified |

Evidence: `tmp/step07-stagnation-proof-final.log`, `tmp/step07-stagnation-legacy.log`, `tmp/step07-stagnation-observability.log`, `tmp/step07-stagnation-planning.log`, `tmp/step07-stagnation-transport.log`, `tmp/step07-stagnation-types-verified.log`, `tmp/step07-stagnation-build-verified.log`, `artifacts/ci/step07-stagnation-related.json`. Local artifacts remain ignored and are not committed.

## Remaining risks / limits

- Model responses and Web Locks in fixture tests are simulated. No live Gemini or authenticated deployed-browser pedagogical completion is claimed.
- Ambiguous/unsupported content intentionally remains NEEDS_TEACHER_REVIEW. A teacher must change/review the relevant draft/source; repeated clicks on unchanged data do not restart unsafe attempts.
- New/global uncovered TP without a supported local destination is not assigned to an arbitrary Bab. Global validation can report it for targeted planning rather than fabricate lineage.
- Legacy checkpoint dependencies that cannot be established safely may need re-verification. Existing source/context invalidation remains conservative.
- Existing localStorage quota and Web Locks requirements remain; diagnostic/source-repair features do not erase history to manufacture space or success.
- Production build retains the existing bundle-size warning.

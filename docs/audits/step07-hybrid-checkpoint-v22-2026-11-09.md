# Step 07 — Hybrid per-Bab and persistent AI checkpoint

Baseline: `3cf5345da38d1fabbe97193e74b074a964a8e2fa`, branch `main`.

## Audit findings

- The previous orchestrator sent the complete mapping repeatedly. It saved repaired drafts at resource guards, but successful AI analysis, proposals and verification responses remained only in memory.
- A timeout during verification therefore repeated a completed proposal request on the next attempt. A process interruption between applying an action and saving its draft had no durable stage record.
- All chosen actions were applied as a single batch. One failing action could reject other safe actions in that batch.
- A single profile-scoped operation must also account for V5 being one localStorage blob. Independent profile locks alone would not serialize writes to that shared blob.
- The manager had two conditional header diagnostic controls and another in its details panel. Copying relied directly on the Clipboard API without the application's existing fallback.

## Implementation

The existing `runStep07AutoRepair` remains the entry point. The manager supplies its actual V5 year/profile/school context, enabling a per-Bab scheduler around the same repair pass. Existing callers without that context retain their behavior. There is no replacement semantic engine, action classifier or canonical validator.

Automatic modes:

| Mode | Condition |
| --- | --- |
| INITIAL_MAPPING | Every Bab and material has empty TP and ATP lineage |
| REPAIR | Mapping is partial or the existing shared readiness reports issues |
| VALIDATE | Shared readiness requirements are already met; AI calls are skipped |

The scheduler uses local issues exposed by shared readiness to prioritize problematic Bab and skip completed Bab. Canonical TP/ATP remain available to AI. The editable mapping contains only the active Bab; other Bab appear as read-only summaries. Cross-Bab actions are deferred to global reconciliation. The existing canonical validator and independent semantic authority checks still decide whether an action can apply. In the scoped hybrid path actions are applied individually, with a fresh source check and full candidate validation, retaining rollback on each rejected action. Existing non-hybrid batch behavior is unchanged.

After processing the local queue, the scheduler always performs global readiness/reconciliation. Local completion never substitutes for global TP/ATP coverage or semantic readiness. A metadata-only, incomplete V5 marker is saved before awaiting AI on a previously legacy mapping, so reload cannot bypass a pending semantic review through legacy structural readiness.

## Durable stages and recovery

| Stage | Persisted state and recovery |
| --- | --- |
| ANALYZE | Initial source context, running state, then successful AI analysis response. The existing endpoint supplies analysis and proposals together; their completion is checkpointed separately. |
| PROPOSE | Proposal result, normalizer rejections and reasons. Resume reconstructs this stage from a saved analysis response if interrupted between stage writes. |
| VERIFY | Verification result and action evidence. Valid cached responses are reused; deterministic source/authority checks still run before application. |
| FILTER | Conflicts, out-of-scope/cross-Bab actions, redundant/non-gap actions and deferrals are recorded by action ID. |
| APPLY | Each successfully validated action and its buffered draft are saved before proceeding. One rejected action does not undo other successful actions. |
| VALIDATE | Local completion and full shared readiness issues. Rejected reasons are available to the next targeted AI request. A new proposal cycle starts only for unresolved work. |
| SAVE | Pending write, actual V5 draft save, read-back confirmation and checkpoint acknowledgement. Recovery recognizes an already-written draft after interruption rather than repeating its analysis or actions. |

Checkpoints use a separate, schema-versioned localStorage namespace scoped by school/profile/year. They include canonical source fingerprints, raw Bab structure/title/lineage/history fingerprints, identity fingerprints, analysis/proposal/verification results, response history, applied IDs, stage events and rejection reasons. Invalidated records are archived rather than silently discarded.

Pending model work depends on the canonical candidate set. Completed Bab depend on their relevant canonical TP/ATP subset. Draft edits invalidate the affected Bab; a global reconciliation checkpoint depends on the entire graph. Compatible buffered changes can merge into a Bab whose pre-apply source remains exact, while preserving edits in another Bab. The undo baseline incorporates manual edits made before the resumed analysis. Source/profile/draft changes during a request abort the stale result.

Web Locks exclude duplicate runs across tabs/processes for a profile/year. A separate, short shared Web Lock serializes Step 07 V5 writes across profile namespaces. Compare-before-write and read-back checks remain in force. Unsupported locking surfaces fail closed with a clear message; no localStorage read/write sequence is advertised as an atomic lock. Waiting for a V5 write lock is time bounded. Late aborted AI responses cannot write a released checkpoint.

The existing time/request/input/output budgets remain. Explicit continuation grants a fresh bounded budget; there is no unattended retry loop. Checkpoint write failures/quota errors stop safely and preserve the previous raw checkpoint and saved V5 draft.

## UI and diagnostics

- One existing Analyze & Align button chooses the mode automatically; Continue Repair remains available after interruption/reload.
- Status shows active Bab/global reconciliation, stage, completed Bab, remaining issues and checkpoint status. Initial/resolved/remaining counters retain one baseline across Bab and global reconciliation.
- Red/green/pink title indicators keep using the existing original snapshot across saves and continuation. Undo and existing histories are retained.
- The manager holds its editable draft during its own intermediate V5 refreshes, so these saves are not mistaken for manual context drift.
- One diagnostic control copies the existing report plus the checkpoint. It reuses the existing Clipboard API → legacy copy → selectable manual report fallback. Checkpoint/clipboard errors remain visible.

## Changed files

- `src/services/step07CheckpointService.ts`: schema, fingerprints, persistent store, locking and identity context.
- `src/services/step07HybridRepairService.ts`: per-Bab scheduling, cached stage transport, invalidation/merge/recovery and global reconciliation over the existing pass.
- `src/services/step07AutoRepairService.ts`: scoped scheduling hooks, isolated action application and optional serialized async persistence; existing default pass retained.
- `src/components/ATPUnitMappingManager.tsx`: context wiring, checkpoint status, refresh guard and single diagnostic/fallback UI.
- `src/types/index.ts`, `server/mappingAnalysis.ts`: scoped request context and active-Bab restrictions in the existing prompt.
- `scripts/testStep07HybridCheckpoint.ts`, `scripts/testStep07AutoRepair.ts`, `scripts/ci/test-groups.json`, `package.json`: new regression and legacy controller harness wiring.

## Verification scope and remaining limits

The hybrid regression uses the real XLSX writer/parser, unchanged PJOK class 6 fixture (9 Bab, 27 materials), actual V5 storage and the real component markup. Provider responses and Web Locks are simulated. It covers fully empty lineage, partial/complete modes, interrupted successful stages, network timeout/retry and ignored late responses, partial action failure, rollback, canonical/manual/profile drift, namespace isolation, concurrent profile saves, quota/idempotence, global MOVE reconciliation and diagnostic fallbacks.

Successful synchronous stages are interrupted to simulate process failure; they are not described as real network timeouts. Actual timer tests target ANALYZE/VERIFY requests and waiting for a SAVE lock. A pending semantic review of legacy structurally complete data is checked against shared Step 08 readiness after reload.

| Final check | Result |
| --- | --- |
| Hybrid/checkpoint suite | PASS, 12 scenario groups; includes six stage-interruption/resume cases |
| Existing scoped auto-repair suite | PASS, 28/28 |
| Related Step 07–08 scripts | PASS, 21/21 |
| Full configured local CI | PASS, 47/47 scripts: storage 22, planning 12, documents 8, transport 5 |
| TypeScript | PASS |
| Production build | PASS, existing large-bundle warning |
| Live Gemini / authenticated app / native multi-tab QA | Not verified |

Final evidence: `tmp/step07-hybrid-proof-release.log`, `tmp/step07-hybrid-final-types.log`, `tmp/step07-hybrid-final-build.log`, `tmp/step07-hybrid-ci-final.log`, `artifacts/ci/*-results.json`, `artifacts/ci/step07-hybrid-related.json`. These local artifacts remain ignored and are not committed.

- Live Gemini, authenticated application operation and native multi-tab/browser locking were not exercised. No live pedagogical completion is claimed.
- Browsers need Web Locks on a suitable HTTPS/localhost surface for safe automatic execution. Unsupported surfaces stop with `CHECKPOINT_LOCK_UNAVAILABLE`.
- LocalStorage quota is finite; large response/history archives can exhaust it. The system reports failure rather than silently dropping checkpoint history.
- The separate checkpoint cache is not added to the existing V5 backup format. Drafts and histories already committed to V5 keep their existing backup/restore behavior. Stage-only buffers remain local to that browser.
- Step 07 writers coordinate with each other; unrelated legacy V5 writers do not acquire the new lock. Source checks protect the scoped mapping, but a general cross-tab transaction system for all application writes is outside this change.
- Initially invalid legacy graphs may still be rejected by the unchanged global action validator; no local scheduler bypasses it to save an invalid mapping.
- Production build retains its existing bundle-size warning.

# Step 07 saved-progress regression

Audited baseline: `8b61d9c27ec729b3308812b762fd5e2f865d1084`, branch `main`. Previous LINK_TP fixes and the subsequent timeout-resilience commit are retained.

## Reproduction and proven causes

The real PJOK fixture (9 Bab / 27 materials) is first verified with a simulated provider. The regression then starts with four Bab carrying valid pedagogical proof. Two more Bab are repaired and saved through the real V5 service; the next AI call fails.

Before the fix:

1. The returned mapping and V5 both contain six valid Bab, but the hybrid result reports `persisted=false`: it reports only the last failed child pass, overlooking earlier confirmed saves.
2. A normal retry with the current snapshot retains six Bab. This path did **not** reproduce data loss, and is not claimed to be broken.
3. With a stale caller snapshot containing four valid Bab and a valid legacy/stage-only checkpoint without `workingMapping`, the retry returns **four** valid Bab and V5 is overwritten with **four**, even though the AI fails. The regression assertion fails. Evidence: `tmp/step07-progress-before.log`.

The hybrid service initialized `current` from `options.mapping`, while independently reading the latest V5 value into `persisted` and its current compare-and-swap key. It did not reconcile the caller's saved base with that newer source. `saveInitialProgress` interpreted the stale-draft/V5 difference as pending progress; the child save then used the newer V5 key, authorizing an old draft. V5's atomic writer and CAS correctly enforce the supplied contract; the caller supplied the wrong draft for that contract.

Two associated UI paths could regress the displayed result: the state-sync effect unconditionally loaded the mapping prop when no edits were pending, and the checkpoint restore effect counted cached `DONE` labels rather than actual local readiness. The actual sync callback is now exercised in the regression, including stale props and protection of unsaved/running drafts.

Checkpoint restoration also formerly replaced the whole working mapping using a graph fingerprint that excludes semantic history. The revised restore checks exact per-Bab source/history and only supplements unfinished source-matching work; it does not treat checkpoint status or a buffered whole mapping as authoritative saved data.

## Changes

- `src/services/step07HybridRepairService.ts`: reconcile the supplied saved base, live draft and V5 snapshot per Bab before checkpoint resume. Unchanged draft units follow V5; independent manual edits survive; conflicting edits/deletions fail closed. Restore only source-matching stage buffers. Return the confirmed V5 snapshot and cumulative persistence when a later Bab fails. Log `PROGRESS_DECREASE` with Bab ID and current readiness issue IDs/reasons.
- `src/services/atpMappingReadinessService.ts`: small count projection over the existing readiness resolver, shared by hybrid progress and UI; no validator or gate changes. The hybrid now evaluates readiness once per progress count instead of once per Bab.
- `src/components/ATPUnitMappingManager.tsx`: read the matching V5 snapshot when syncing an idle, unmodified draft; retain unsaved edits and running draft. During execution use the service's actual readiness count; afterward derive the count from current draft readiness, not checkpoint labels.
- `scripts/testStep07ProgressPersistence.ts`: seven scenarios covering the actual fixture, retry, stage-only legacy checkpoint, a same-graph buffer missing semantic history, reload, late response, manual edit/dependency invalidation, conflict, UI callback, and false checkpoint completion.
- `package.json`, `scripts/ci/test-groups.json`: register the regression locally and in planning CI.

No semantic policy, AI prompt, TP/ATP canonical data, V5 schema, checkpoint schema, or Step 08 gate is changed. Existing checkpoint formats remain readable. Newer stored progress is not dependent on a checkpoint carrying a duplicate draft.

## Validation evidence

Artifacts remain untracked under `tmp/` and `artifacts/ci/`.

- Baseline reproduction: FAIL as expected, `4 -> 6 -> stale retry -> 4` in mapping **and** V5.
- Fixed reproduction: `4 -> 6 -> retry/reload/stale retry -> 6`; exact saved semantic history retained.
- Timeout and late response: V5 and the completed timeout checkpoint remain byte-identical after the late response.
- Legitimate manual change: `6 -> 5`, only the changed Bab invalidated; diagnostic includes its ID and missing semantic support. Other repaired Bab remain exact.
- Conflicting edits: no AI invocation or V5 overwrite; caller receives stale/conflict result.
- Forged optimistic checkpoint labels cannot change the readiness count or unlock Step 08.

Final checks:

- PASS: progress persistence regression, 7 scenarios (`tmp/step07-progress-final-testStep07ProgressPersistence.ts.log`).
- PASS: existing auto-repair 29/29, checkpoint 20/20, pedagogical 13/13, semantic execution, inline UI and observability 8/8.
- PASS: 17 additional mapping and Step 07–08 regression scripts (`artifacts/ci/step07-progress-related-results.json`).
- PASS: TypeScript/lint (`npm run lint`, which runs `tsc --noEmit`; final evidence in `tmp/step07-progress-types-final-proof.log`).
- PASS: production build (`tmp/step07-progress-build-final-proof.log`), with the existing large-bundle warning.
- PASS: `git diff --check`.

The complete eight-script Step 07 run, including the existing timeout-resilience regression, is recorded in `artifacts/ci/step07-progress-results.json`.

The timeout-resilience script initially failed its first-Bab `DONE` expectation during the parallel run (its total budget for that case is 500 ms). The unchanged script passed when rerun alone. Production timeout limits and the test's limits are unchanged. Final per-script results retain the initial exit code and recheck log for transparency; this wall-clock sensitivity remains a test limitation.

## Limits

The AI provider and Web Locks are simulated. Storage operations, canonical/readiness validators and the React state-sync callback are production implementations. Live Gemini, a real browser reload, React rendering races and native multi-tab behavior have not been exercised here. The reproduction identifies a deterministic data-loss path and UI weaknesses; no production storage dump or browser event trace was supplied to establish which combination occurred in the user's original session. A simultaneous conflicting manual edit requires reloading the latest source; it is intentionally not merged automatically.

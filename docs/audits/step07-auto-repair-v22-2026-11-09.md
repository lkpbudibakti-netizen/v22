# Step 07 scoped auto-repair audit — 2026-11-09

Baseline: `86e409bc1289fb363f2f1e6eb4458d0874366516`, branch `main`.

## Findings from the existing implementation

- `ATPUnitMappingManager.handleAnalyzeMapping` previously performed one analysis and applied only actions allowed by the existing automatic authority. Substantive proposals remained teacher-approved actions; analysis did not atomically save a fully repaired result.
- `applyMinimalAlignment` correctly refused substantive execution under the old `AUTOMATIC` argument. Removing that check globally would have silently changed other callers' authorization.
- The canonical validator distinguishes global coverage from local lineage. The PJOK class 6 diagnostic fixture has 9 units, 27 materials, all 5 TP/ATP globally covered, but 4 units and 12 materials without lineage. Global coverage cannot establish completion.
- Existing linked IDs alone cannot establish pedagogical support. Older mappings without a current teacher/semantic support record need assessment too. In this fixture the simulated provider therefore assesses all 27 materials, not just the 12 missing links.
- Existing mutation, lineage normalization, revision separation, action histories, graph validation, V5 storage and readiness services remain the owning implementations. No parallel semantic engine or canonical validator was added.

## Changes and boundaries

`step07AutoRepairService.runStep07AutoRepair` coordinates the existing analysis endpoint, mutation engine and validators. It performs at most three rounds, checks only remaining gaps after the first round, stops on stagnation, and bounds each request to 30 seconds and the run to 120 seconds by default. Requests receive abort signals; late responses never write storage.

`step07AutoExecutionPolicy.validateStep07AutoExecution` grants authority only to a source-bound `STEP07_AUTO_REPAIR` batch. The original approval classification and default automatic restrictions remain intact. Nontrivial actions require a separate VERIFY request, supported verdict, reason, traceable original material/TP evidence, a competence statement in the proposed result, retained source context, and no explicit conflict under the existing semantic evidence checker. This is a second model pass plus deterministic source/graph checks, not an independent human or independent model guarantee.

Relations are prioritized before edits and additions. Already verified good rows are not rewritten on each analysis. New materials require an uncovered TP and a positive necessity/target-unit check. Automatic removal of a manual material is unsupported. Replacement of an existing TP relation requires explicit negative source evidence and an actual conflict detected by the existing checker; coverage-preserving graph validation still applies. Canonical TP/ATP are never edited or invented.

Actions retain the existing before/after history and record actual `AUTOMATIC` execution, the scoped context and semantic proof. Existing batch application rolls back a rejected candidate atomically. Incomplete/timeout runs retain only the last safe draft and do not auto-save. Manual drift aborts applying the stale result. V5 storage checks the exact persisted source before one write, preventing concurrent manual changes from being overwritten.

Shared readiness adds a certificate check only for mappings produced by this scoped workflow. A structurally complete but unverified/failed run cannot unlock Step 08 through another navigation path. The verified fingerprint uses existing structure/substance revisions and canonical content, so cosmetic title edits do not create substantive staleness. Undo uses the existing exact graph fingerprint, including raw titles, so it refuses to discard even later manual capitalization edits.

The existing manager renders results directly in the draft, without mounting the ACC report panels. It shows short process states and closed technical details. Persisted pre-analysis snapshots determine exact colors: unchanged text green, changed text red, newly added AI material pink. Relation-only changes remain green. Saving, reloading and navigating preserve this metadata. Whole-run undo restores the snapshot to an unsaved draft, preserves history and requires revalidation before proceeding.

## Verification

Before-change fixture: `isValid=true`, `isComplete=false`, 4 units / 12 materials without lineage, 0 global uncovered TP/ATP; conservative fallback had no executable semantic repair. Old substantive automatic apply was correctly rejected.

After-change **simulated structured proposer/verifier fixture**: all 9 units / 27 materials have lineage, `isValid=true`, `isComplete=true`, one atomic save, Step 08 ready. One round in the all-actions case; the limited-provider case resolves in exactly three rounds. This proves execution and persistence contracts with representative responses; it does not prove live Gemini can solve the diagnostic.

The new 21-case regression covers baseline/fallback, every fixture material, global versus local coverage, bounded rounds, stagnation, invalid evidence/IDs/conflicts, timeout and late replies, manual drift, save failure, actual V5 storage/backup/reload, idempotence, concurrent storage conflict, necessary addition, batch rollback, unchanged global approval, cosmetic/substantive revisions, false completion, undo, the actual Analyze controller, actual component markup, relation-only colors and narrowly supported relation replacement. Existing tests for semantic ambiguity, valid multiple TP links and legacy/manual action handlers remain in the regression suite.

| Check | Result |
| --- | --- |
| Baseline 4/12 gaps correctly detected | PASS |
| New auto-repair cases | PASS, 21/21 |
| Entire configured CI suite, local | PASS, 46/46 scripts: storage 22, planning 11, documents 8, transport 5 |
| TypeScript (`npm run lint`) | PASS |
| Additional Step 07–08 regression scripts | PASS, 21/21 |
| Production build | PASS, existing large-bundle warning |
| Desktop static render of actual component + production CSS | PASS, 1365px fixture preview inspected; not an authenticated browser run |
| Live Gemini + authenticated application session | BLOCKED, credentials unavailable to this execution session |

Local execution evidence is written to ignored `artifacts/ci/` and `tmp/` paths. No generated diagnostic, screenshot or temporary file is committed.

## Limits and remaining risk

- **BLOCKED: live Gemini completion of the PJOK fixture.** This CLI session has no configured `GEMINI_API_KEY`; browser BYOK credentials were not accessed. The no-provider fallback safely retains gaps with specific IDs and reasons. This does not establish that the fixture is pedagogically impossible, and no live completion is claimed.
- Separate model verification and deterministic evidence tracing reduce unsupported action execution but cannot guarantee pedagogical truth. Conservative competence/context checks may leave legitimate, implicit curriculum relationships unresolved. Such runs remain incomplete rather than forcing links.
- UI tests exercise the real component markup and controller with fixtures. They do not establish an authenticated, live-provider end-to-end browser run.
- Metadata is optional and backward-compatible. Legacy mapping approvals and imports keep their existing behavior. Snapshot/history metadata increases backup size; no dependency or storage architecture migration was added. Existing substantive revision propagation remains responsible for downstream staleness.
- The production build retains the existing bundle-size warning.

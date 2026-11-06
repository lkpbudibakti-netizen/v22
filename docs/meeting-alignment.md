# Step 08 / Langkah 4 — TP/ATP/substance optimization against actual JP slots

Baseline: `5122c3e783a94d578b9252c6d49f9ebc1462a9fc` (`main`, clean working tree before this task). Changes remain uncommitted; this SHA identifies the baseline, not a new implementation commit.

## Audit before editing

- `meetingAlignmentService`: previous merger repeated the full ATP allocation for each meeting and compared against the semester's minimum slot. This conflated curriculum allocation, meeting demand and dated session capacity.
- `meetingReconciliationService`: existing `mergeReconciliationContent` remains the canonical union primitive used by the optimizer. Existing validators, placement and save path are reused; no replacement calendar, persistence store, AI transport or document engine was added.
- `unitExecutionPlanService`: canonical unit/meeting IDs, material/ATP/TP lineage, duplicate detection and coverage remain authoritative. New optional meeting fields are validated here.
- `learningMeetingScheduleService`: canonical mapping order + meeting order are paired with actual date/session slots. The shared JP simulator is now used by both optimization and automatic scheduling; manual schedules also check explicit meeting demand.
- `storageV5`: existing actual-slot/calendar/weekly-JP resolvers feed a read-only adapter. All journal/attendance/realization, legacy date/ordinal attendance, learning-plan scopes/activities/assessments and explicit assessment/grade meeting references are protected. Ordinary saves also reject modifications of protected content.
- Generator/client: existing `/api/ai/recommend-meeting-reconciliation` and `aiFetch` gain an OPTIMIZE draft mode using the existing model/retry helper. No provider/model change. Initial meeting generation does not fabricate per-meeting JP from ATP.
- Consumers: scheduled projection -> learning-plan scope -> AI learning plan and Modul Ajar/PROTA/PROMES/journal/PDF/DOCX. New source activities and meeting demand flow through the existing projection. Essential source descriptions/time budgets are checked before a LearningPlan/document can be treated as ready. Historical snapshots remain untouched.

## JP contracts

1. ATP `allocatedJP`/legacy `jp`: curriculum source allocation only. It is never copied or multiplied into each meeting.
2. Optional `LearningMeeting.plannedJP`: explicit teacher-entered meeting demand, or a reviewed derivation from quantified meeting activities and the existing curriculum minutes/JP resolver. No migration or guessed default is applied to old records. Old `alignmentMerge.requiredJP` alone is not treated as meeting demand.
3. Actual slot `jp`: read from existing effective subject slots, sorted by date/session order. A meeting must fit its particular assigned slot (`plannedJP <= slot.jp`); dated schedules/documents retain the actual slot JP. Unused capacity is transparent, not a declaration of curriculum compliance.

Optional `activities` reuse `LearningActivity` (ID, description, minutes, activity type); optional `essential` records teacher review. A missing essential flag is treated conservatively. These fields are unnecessary for unchanged legacy records, but substantive reduction/redistribution needs evidence. Legacy records remain readable and exportable with unknown demand; optimization can block until teachers provide demand/evidence.

## Strategies and simulation

The existing proposal/apply service now searches deterministic ordered combinations and chooses lower-cost changes first: REMOVE_EMPTY, proven REDUCE_REDUNDANT, MERGE, then COMPACT/REDISTRIBUTE. ADD remains an explicit optional teacher choice. No unit crosses a Bab/semester boundary.

- REMOVE_EMPTY: no content or protected reference; every unit is preserved.
- REDUCE_REDUNDANT: adjacent meetings must have identical canonical scope, title/substance, activity sequence and quantified demand. Activities must be explicitly reviewed as nonessential; unique material/TP/ATP, assessments and essential/unreviewed activities cannot be discarded. Original source objects remain archived.
- MERGE: retains source titles, all references and activities in source order; uses the sum of **meeting demand**, not ATP allocations. Different scopes need activity evidence and valid ATP introduction/prerequisite order.
- COMPACT: can pack three meetings into two actual slots; no activity is split, shortened, invented or dropped. Durations, essential flags and order are retained.
- REDISTRIBUTE: can move whole activities between two meeting IDs within the same supported scope to fit actual 2/4 JP order. AI can propose broader canonical reference redistribution, but moved activities must carry their original lineage, all coverage and total known demand must be preserved, and prerequisite order must remain valid.

The entire candidate is simulated, including unchanged meetings and protected dated anchors. A protected meeting cannot shift date/session/JP; without a dated anchor its original sequential position is preserved. Unknown demand, insufficient JP, essential/assessment conflicts, bad lineage, missing units or stale source data produce blockers. A partially feasible proposal is never applied if the whole plan is infeasible.

Meeting-count status, actual-slot feasibility and curriculum JP review are separate. The existing annual JP assessment remains the curriculum authority; matching 41 meetings cannot mark curriculum allocation complete.

## AI and teacher approval

AI may return only a draft over existing IDs. It cannot invent demand for unknown meetings, reduce a unit's total demand, drop/reorder activities, change essential/assessment metadata or erase essential text/time. Without activity evidence, original title/substance and references must remain. Invalid provider output is rejected on the server and again on the client; provider errors and invalid drafts have separate codes. Journal/attendance payloads are excluded from AI requests.

The existing review dialog shows Bab/meeting number, before/after action, TP/ATP/material references, demand JP, actual slot JP, reasons, conflicts and dependent-data impact. The teacher can edit demand and optional quantified activities, inspect a draft, cancel or explicitly approve. A late AI response after cancellation is discarded. AI never writes data.

Approval re-reads the V5 source and reconstructs/compares the full proposal. Candidate lineage, coverage, source fingerprints, activity substance/time, protected content and slot feasibility are rechecked. One existing V5/localStorage write saves the plan plus schedule/document invalidation; injected failures leave persisted data unchanged. Surviving IDs/dated entries and historical snapshots remain intact. Existing global annual revision means both semester schedules require review at Langkah 5 after approval.

## Changed files

| File | Reason |
|---|---|
| `src/types/index.ts` | Backward-compatible meeting demand/activities and optimization provenance. |
| `src/services/meetingContentService.ts` | Shared explicit-demand/actual-slot checks and sequential simulation. |
| `src/services/meetingAlignmentService.ts` | Strategy search, actual ordered JP simulation, draft validation, protected anchors and deterministic approval. |
| `src/services/unitExecutionPlanService.ts` | Validate optional JP/activity fields without inventing legacy values. |
| `src/services/learningMeetingScheduleService.ts` | Enforce explicit demand in automatic/manual schedules. |
| `src/services/storageV5.ts` | Existing-slot details/minutes resolver, assessment/grade references, generic protected-save guard and atomic approval path. |
| `src/services/aiService.ts`, `server.ts` | Draft-only optimization through existing transport/route/model helper. |
| `src/services/scheduledLearningMeetingProjectionService.ts` | Reject incompatible JP and carry reviewed activity/demand metadata. |
| `src/services/learningPlanService.ts`, `src/services/learningPlanActivityMeetingService.ts` | Preserve source substance/durations in downstream learning plans and document readiness. |
| `src/components/UnitExecutionPlanManager.tsx` | Demand/activity editing, detailed before/after simulation, optional AI draft and mandatory approval/cancel. |
| `scripts/testMeetingAlignment.ts` | Optimization, actual UI/backend handlers, persistence/failure, schedule/document and old/new import regressions. |
| `scripts/testMeetingDurationByLevel.ts` | Give the duration fixture a persisted execution revision, required by the already-existing stale-schedule contract. No production validator was relaxed. |
| `docs/meeting-alignment.md` | Current audit, contracts, changed-file inventory and verification report. |

## Verification

The alignment suite covers the original empty-slot case plus a real 48 -> 41 mixed-strategy fixture on actual 2/4 JP slots, infeasible 48 -> 41 blockers, redundancy vs unique TP/material, essential activities, assessments, ATP prerequisites, COMPACT/REDISTRIBUTE, unknown JP, actual/manual schedule mismatches, protected dated anchors, changed calendar/source, invalid AI output, cancellation/late responses, teacher approval, one-write invalidation, injected save failure, unchanged CP/TP/ATP/mapping/calendar, historical snapshots and old/new ZIP import with activity/meeting ID remapping. UI/backend handlers run with a deterministic provider boundary; no live Gemini claim.

Executed commands/results are summarized in the final chat report and existing `artifacts/ci/{planning,documents}-results.json`.

Final results: PASS — 33 alignment scenario groups, 7/7 planning CI suites, 7/7 document CI suites, all five additional regression scripts, final typecheck, final production build, and diff whitespace checks. The final alignment run also verifies that successful approval clears the old AI draft so the saved plan does not show a stale conflict. The build retains its existing large-chunk warning.

- `npm run ci:tests -- planning` (includes alignment and calendar/integration suites).
- `npm run ci:tests -- documents` (PROTA/PROMES/time allocation, learning plans and actual DOCX/PDF exports).
- `npm run test:step08-jp`.
- `npx tsx scripts/testModulAjarMeetingProjectionRegression.ts`.
- `npx tsx scripts/testJurnalMeetingRegression.tsx`.
- `npx tsx scripts/testCompleteProjectArchiveRegression.ts`.
- `npm run test:meeting-duration-v21`.
- `npm run lint`, `npm run build`, `git diff --check`.

NOT RUN: live Gemini, visual browser walkthrough, or the entire unrelated repository test inventory. Existing large-bundle build warnings are outside this scoped change.

## Remaining teacher decisions

Supply unknown meeting demand/quantified activities instead of reusing ATP JP. Review substantive and pedagogical suitability before approval; the deterministic checks do not replace teacher judgment. Essential/assessment/prerequisite or protected-reference conflicts require explicit manual planning, never deleting factual data to unlock optimization. If 41 slots are insufficient, keep the blocker rather than forcing 41. After approval, review both schedules and regenerate current documents; historical snapshots stay historical. Curriculum annual-JP comparison remains a separate review.

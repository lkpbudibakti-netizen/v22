# Step 08 / Langkah 4 — flexible meeting alignment

## Limited audit and root cause

Repository: lkpbudibakti-netizen/v22, main; baseline fa9cbc8. The working tree was clean before this task. No commit or push was made.

The previous meetingAlignmentService always forced exact capacity and could only remove empty meetings. The allocator also requested spare capacity even when a semester already had complete coverage. The existing V5 writer did not recheck alignment dependencies or invalidate dependent records in the same write. isLearningMeetingScheduleStale accepted mapping/plan revisions as inputs but did not compare them.

The meeting-ID inventory was traced through these existing owners (including learningMeetingId/learningMeetingIds aliases):

| Owner | Reads/writes and treatment |
|---|---|
| UnitExecutionPlanManager, unitExecutionPlanService, unitSemesterPlanningService, unitMeetingAllocationService, server.ts | Canonical meeting creation/editing, lineage/coverage, existing generation target contract; retained. |
| LearningMeetingSchedulePreview, learningMeetingScheduleService, meetingReconciliationService | Dated entries, unresolved IDs, manual selections and reconciliation. The existing reconciliation content-union operation is shared; no parallel calendar or store was added. |
| storageV5, JournalRealizationEditor, documentEngine/jurnalProjection | Journal/upsert and realization IDs, direct attendance linkage, legacy date/ordinal attendance. These IDs and their stored content are protected. Orphan/ambiguous factual associations fail closed. |
| learningPlanService, learningPlanActivityMeetingService, administration/LearningPlanManager, aiService | Plan meeting scopes, activities, experiences, assessments and duration budgets. Existing manual references are protected; activities are never silently retargeted. |
| scheduledLearningMeetingProjectionService, annualJPAssessment, administration/SemesterScheduleSummary | Canonical scheduled rows and actual JP. Changed revision metadata or DRAFT schedules cannot be projected as current complete data. |
| documentEngine/meetingTimeProjection, modulAjarProjection, annualZipPlan and frozen snapshots | PROTA/PROMES/time allocation/journal/module consumers. Live outputs require current schedules; historical snapshots remain intact. |
| administrationProjectImportService, types/index, diagnosticService | Identity remapping, schema and diagnostics. Old records remain readable; diagnostics reuse actual allocator demand rather than treating all unused capacity as requested additions. |

## Behavior

- Allocation below/equal to capacity is retained by default. A preview checkbox explicitly offers additional empty slots. Coverage/completion gates are retained; new empty slots require content before finalization.
- Excess allocation first removes unprotected empty slots, deterministically and proportionally. If necessary, the same proposal merges adjacent content meetings within one Bab/semester.
- Merge candidates must share canonical ATP and TP scope, have valid material lineage, contain no unknown legacy payload, and not be identifiable assessment sessions. Their full known ATP workloads are summed for each input, without inventing a per-meeting split; this conservative bound must fit the minimum actual JP slot. Explicit null/unknown JP blocks merging, even if a legacy cached JP exists.
- Prior merged workload is retained so subsequent merging cannot underestimate duration. Both original source objects are retained verbatim in optional alignmentMerge provenance. The first canonical ID/order survives, references are unioned without duplication, and source titles are retained. Other surviving meetings keep their existing IDs/content/order.
- This is deliberately a conservative proposal, not a claim that matching IDs proves pedagogy. The teacher must review the activities before explicit approval. Different scope, assessments, insufficient/unknown time, factual records, or manual learning-plan references require a manual decision; no content is forcibly deleted or remapped.
- A blocked proposal is never partially applied, even if some empty removals were individually safe.

## Approval, persistence and invalidation

The existing App -> saveUnitExecutionPlanV5 path accepts an optional alignment approval; ordinary callers remain compatible. Immediately before saving it re-reads the scoped V5 source, reconstructs the proposal, and compares fingerprint, operations and candidate content. Fingerprints cover the draft, source plan, mapping, CP/TP/ATP, capacity inputs and actual slots, journal/attendance/dependent data, and scoped document records. Same-count calendar changes and new facts invalidate old approval. Existing canonical validators recheck lineage and coverage; lost coverage is rejected.

All candidate edits and dependent invalidations occur on the loaded state before one saveStorageV5/localStorage write. Exceptions or a rejected save leave the persisted state unchanged. The UI retains its preview/draft on failure.

Stored schedules become DRAFT with their original revision provenance. Entries for removed IDs are detached; surviving dated entries are kept exactly, and new IDs become unresolved. The annual plan has one global revision, so both semester schedules require review. Existing document draft status is reused for affected PROTA/PROMES/ALOKASI_WAKTU/JURNAL/MODUL_AJAR records; historical snapshots are preserved. No original CP/TP/ATP/mapping/calendar data changes.

## Files changed

| File | Purpose |
|---|---|
| src/services/meetingAlignmentService.ts | Extend the existing proposal/apply mechanism with optional additions, mixed removal/merge operations, workload/lineage/dependency safety and provenance. |
| src/services/meetingReconciliationService.ts | Extract the existing canonical content union for reuse by reconciliation and alignment. |
| src/services/storageV5.ts | Read-only adapter over existing capacity/dependencies; approval revalidation and atomic plan/schedule/document save. |
| src/services/unitMeetingAllocationService.ts | Complete coverage may leave spare capacity unused. |
| src/services/diagnosticService.ts | Display actual requested additions from the same allocator. |
| src/services/learningMeetingScheduleService.ts | Compare the existing mapping/plan revision fields for stale schedules. |
| src/services/scheduledLearningMeetingProjectionService.ts | Reject known stale live schedules; preserve metadata-free legacy structural checks. |
| src/components/UnitExecutionPlanManager.tsx | Existing review button, optional additions, detailed operations/content/impact preview and explicit approval/cancel. |
| src/components/AnnualPlanningManager.tsx, src/App.tsx | Pass the approval through the existing save callback. |
| src/types/index.ts | Optional backward-compatible merged-source provenance. |
| server.ts | Accept requested generation targets below the capacity ceiling; no provider call for zero-work requests. |
| scripts/testMeetingAlignment.ts | Service, actual component handler, backend handler, persistence, dependency and failure regression coverage. |
| scripts/ci/test-groups.json | Include alignment regression in existing planning CI group. |
| docs/meeting-alignment.md | Audit, implementation, test and remaining manual-action report. |

## Validation

- PASS: 16 alignment scenario groups, including the original S1 42/42 unchanged and S2 [15,12,9,12] -> [13,10,8,10] when empty-slot reductions are safe; under-capacity/no-op and optional growth; mixed operations; unknown/null/excess JP; incompatible/assessment/legacy content; accumulated merge workload; journal/attendance/legacy and learning-plan protection; protected unsaved edits; single Bab; stale calendar/source; actual UI cancel/approve/failure; actual backend zero-work and capacity ceiling; one-write invalidation and persistence/reload; injected storage failure; unchanged sources and historical snapshots.
- PASS: Step 08 JP integration, journal regression (including real DOCX/PDF and ZIP output), calendar, workflow, 17 canonical PROMES cases, Modul Ajar meeting projection (real DOCX/PDF), and 47-meeting AI coverage repair.
- Known baseline failure: test:assessment-meeting-linkage has 21 passing and 3 failing assertions because its old fixture omits mandatory learningSteps.opening. The same 3 failures were reproduced at untouched fa9cbc8 in a separate temporary worktree. No validation was relaxed to satisfy these assertions; the temporary worktree was removed.
- PASS: final `npm run lint` (typecheck), `npm run build`, and `npm run ci:tests -- planning` (7/7 suites including the 16 alignment scenario groups). Build retains the existing large-chunk warning; no dependency or bundling redesign was introduced.
- NOT RUN: browser visual/manual interaction and live Gemini generation. Actual React event handlers and the backend route handler are executed by the regression harness; zero-work never reaches Gemini.

## Teacher actions that can remain necessary

Review the proposed merged activities and their conservative JP bound before approval. When workload is unknown/too large, ATP/TP scope differs, an assessment is involved, or journal/attendance/manual learning-plan references protect meetings, resolve the specific planning conflict manually. Never remove factual records merely to unlock alignment. After approval, review/save both semester schedules at Langkah 5 and regenerate affected current documents; preserved historical snapshots remain historical. Additional blank slots require manual content/coverage completion.

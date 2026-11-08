# Step 07 — pedagogical alignment and report UX

Repository: lkpbudibakti-netizen/v22, branch main. Audit baseline: `67f6c00c2bba8bcf541dea7ac386defd7bed1011`.

## Findings from the code

- The prompt prohibited editing Bab titles and described minor edits through retained words. The existing apply engine also used lexical overlap for edits. Neither establishes semantic equivalence.
- Bab-first fallback inferred TP from keyword support. Stored links could be reported as supported without reviewed pedagogical evidence. Canonical ID validity and semantic support were conflated.
- The canonical validator already checked global coverage and per-Bab material coverage separately. Its `materialCoverageGaps` correctly blocks the PJOK Bab 3/E3-GHA-01 case even when global coverage is complete. This validator and the existing Step 08 readiness resolver were retained.
- The mapping editor/draft builders rebuilt objects and would drop additional history metadata. Every saved edit previously changed the shared dependency timestamp, including spelling-only edits.
- Prota and Promes already project current mapping titles. The module projection used current material titles but did not expose the current Bab title. Historical snapshots remain historical; they are not rewritten.
- The existing report was verbose and repeated metrics/actions without a single prominent VALID/COMPLETE/READY summary. The apply control was present with zero selected actions.

## Implementation and owning functions

| Files | Changes |
|---|---|
| `server/mappingAnalysis.ts` | Correct authority/classification prompt; canonical TP/ATP immutable; structured findings contract. |
| `server/mappingMinimalAnalysis.ts` — `attachMinimalAlignment` | Deterministic spelling suggestions, recomputed approval classification, preview through existing apply engine, structured report. |
| `server/mappingBabFirstAnalysis.ts` — `analyzeBabFirstMapping` | No keyword-created relations. Exact source quotations and reason required for actionable AI proposals. Unproven stored/manual links remain visible and NEEDS_REVIEW. |
| `src/services/mappingAlignmentService.ts` | Extend existing engine with EDIT_UNIT_TITLE; `classifyMappingTitle`, conservative closed equivalence rules, `applyMinimalAlignment`, original titles/history, `undoMappingTitle`, `recordMappingBatch`, `buildMappingPedagogicalReport`, teacher-support source fingerprints and `versionMappingUpdate`. No parallel alignment/readiness engine. |
| `src/services/atpUnitMappingValidationService.ts` — `validateATPUnitMappingCanonical` | Explicit semantic/domain conflicts use existing semantic checker and block shared readiness. Unknown evidence is reported separately, without deleting links. |
| `src/services/atpMappingActionApplyService.ts` | Preserve metadata in draft builder; include canonical identities in async fingerprint; record teacher-approved legacy batches; reuse existing action priority. |
| `src/services/atpApplyActionEligibilityService.ts` | Automatic proposals cannot enter the teacher approval selection. |
| `src/components/ATPUnitMappingManager.tsx` | Guarded automatic redaction applies to draft, with history/undo; preserve metadata; generation and legacy application recorded; live shared readiness; expandable old details; no empty apply button; persistent title history/undo. |
| `src/components/AlignmentProposalReview.tsx` | Readiness, coverage, location/priority, problem/evidence/recommendation/impact/approval/status; progressive disclosure and distinct automatic/teacher changes. |
| `src/services/storageV5.ts` — `saveATPUnitMappingV5` | Separate structure/substance/presentation revisions. Preserve substantive dependency timestamp for proven presentation-only changes; substantive/structure changes invalidate scoped derived document status and existing plan/schedule timestamps. |
| `src/types/index.ts`, `src/services/aiService.ts` | Optional backward-compatible audit/version/report metadata. |
| `src/services/documentEngine/modulAjarProjection.ts`, `generators/modulAjarGenerator.ts`, `renderers/pdf/pdfDocGenerators.ts` | Shared current Bab title appears in module DOCX/PDF; manually authored topic and curriculum unchanged. |
| Regression scripts, `package.json`, `scripts/ci/test-groups.json` | New Step 07 suite runs in planning CI; old fixtures now distinguish evidence-backed proposals from lexical fallback. |

## Authority, lineage and compatibility decisions

COPYEDIT uses controlled spelling/case/spacing/punctuation normalization. RENAME automation is deliberately narrow: equivalent gerakan/gerak in explicit locomotor/nonlocomotor/manipulative labels. Other wording changes default to CONTENT_CHANGE and teacher review. AI assertions or word-count overlap cannot authorize automatic changes. The automatic path changes only the draft; existing Save persists it. Repeated equivalent automatic edits and reapplication of an explicitly undone title are prevented.

REALIGN and CONTENT_CHANGE remain explicit teacher actions, atomically applied by the existing engine after source-evidence and canonical checks. No canonical TP/ATP is modified. History records original/result titles, before/after, reason, approval, location and time. Undo refuses a title changed since its recorded action. A batch snapshot remains available until draft/context changes; persisted title history remains available after reload. Structural batch history is retained for inspection; it is not a persistent arbitrary-state restore feature.

The union of material TP is authoritative **for support validation**, and ATP parents are derived from canonical TP relationships. Legacy/manual Bab claims are retained as explicit declarations. Automatically replacing them with material union would silently delete unsupported manual claims, hiding the diagnostic. Therefore a discrepancy is a visible blocker, not automatic normalization. The report offers teacher alternatives: substantively supported link, correction of Bab claim, or explicit reviewed content proposal. A TP may recur in multiple Bab.

Optional metadata requires no migration. XLSX import, old object initialization, save/load and backup restore remain supported. No mass rewrite of existing records occurs. Structure changes increment structure revision; relation/scope changes increment substance revision; title presentation changes increment presentation revision. Proven equivalent redaction preserves the legacy dependency timestamp, avoiding substantive stale flags. Real changes continue to invalidate dependent execution plans/schedules through their existing source timestamp checks. Historical document snapshots are preserved; newly generated documents use current titles.

VALID means canonical validity; COMPLETE includes coverage/material support; READY also includes upstream identity, status and stale checks. All three are projected from the existing validator/readiness resolver used for Step 08. Semantic NEEDS_REVIEW is distinct from structural readiness: the report never treats structural READY as proof of pedagogical alignment.

## Verification

`npm run test:step07-pedagogical`: **PASS 13/13**.

| Required scenario | Result / evidence |
|---|---|
| 1. Spelling/capitalization | PASS: automatic COPYEDIT, immutable canonical input, original/history retained; numeric punctuation changing scope is not equivalent. |
| 2. Equivalent RENAME | PASS: Bab title updated without changing lineage/materials. |
| 3. Title changes scope | PASS: bola kecil/besar is CONTENT_CHANGE requiring teacher approval despite one-word difference. |
| 4. Unsupported Bab TP | PASS: Bab 3/E3-GHA-01 blocks readiness despite complete global coverage; no forced repair. |
| 5. Reused TP | PASS: multiple Bab/materials with separate IDs accepted. |
| 6. Irrelevant TP | PASS: explicit math/PJOK conflict rejected; lexical-only fallback creates no relations. |
| 7. Duplicate titles/different focus | PASS: NEEDS_REVIEW with differing TP evidence, no deletion/merge. |
| 8. Manual edit after analysis | PASS: stale apply and unsafe title undo rejected. |
| 9. Identical reanalysis | PASS: no repeated mutations/reversal; teacher undo respected. |
| 10. Substantive edit after validation | PASS: substance/structure revisions and dependent plan staleness; presentation edit does not stale substance. |
| 11. Legacy import | PASS: XLSX, initialization/draft metadata, real storage and serialized backup/restore; manual mapping retained. |
| 12. Downstream titles | PASS: actual generated DOCX XML and extracted PDF text for Prota, Promes, module contain current Bab/material titles; input objects unchanged. This is an export content check, not visual rendering approval. |
| Additional report contract | PASS: shared READY summary, expandable details, zero proposal checkboxes when no proposals. |

Related regression scripts: **PASS 17/17** — mapping persistence/import/action apply/multi-Bab/empty materials; P0-D mapping and async safety; P1-D3 semantic evidence and P1-D4 readiness; Step7 Bab-first, Gemini fixture authority, eligibility, imported readiness, minimal alignment, structure generation, Step7→8 lineage and proposal selection.

Full configured CI: **PASS 43/43 scripts** — storage 22, planning 8, documents 8, transport 5. TypeScript (`npm run lint`): **PASS**. Production build: **PASS**, with existing large-bundle warning. `git diff --check`: **PASS**.

P0-D initially failed at scenario 1 on both this branch and a detached checkout of the baseline: replacing the only supporting material left a declared Bab TP unsupported. The fixture now supplies a separate supporting material, retaining the intended replace-not-union assertion without weakening the production validator. Recovery fixtures now carry explicit quotations; active lineage checks exclude audit snapshots, which intentionally preserve old IDs in before/after history.

## Limits and remaining risks

- Live Gemini and authenticated browser visual/interaction QA: **NOT VERIFIED**. Provider-shaped fixtures, React report contracts, async guards and deterministic checks passed; they do not establish actual provider quality or visual usability on every viewport.
- Semantic equivalence cannot be established generally by string matching. Unrecognized renames require teacher review. Exact quotations establish source traceability, not educational truth; teacher review remains required for substantive/relational proposals. Manual existing mappings are retained, with unproven support reported NEEDS_REVIEW.
- Whole-document visual print/render approval is outside this Step 07 test; DOCX/PDF checks above prove current exported content, not every page layout.
- Temporary detached comparison worktree at `D:\Repository Github\percobaan 1\v22-step07-baseline` remains outside main. Automatic approval review rejected cleanup of its node_modules junction. No comparison files are staged or committed to main.

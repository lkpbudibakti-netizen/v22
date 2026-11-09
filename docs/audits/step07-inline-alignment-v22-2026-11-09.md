# Step 07 — inline alignment UI

Baseline main: `3aa6b02e60c1b5f3bc32a002cb7550ff15bd5a34`.

## Audit before implementation

`ATPUnitMappingManager` already owns the Bab/material draft, save, manual editing, guarded AI analysis, automatic application, proposal selection, atomic application, rollback and shared Step08 readiness. Its analysis output was displayed again in `AlignmentProposalReview`, a material-resolution list, a findings list, minimal proposal cards and a legacy findings panel. The primary editor appeared below these repeated lists. Selecting one action cleared the analysis panel, making the other pending actions disappear from view.

The existing minimal engine action types are EDIT_UNIT_TITLE, LINK_TP, EDIT_MATERIAL, ADD_MATERIAL, MOVE_MATERIAL and RESTRUCTURE_UNIT. Legacy ASSIGN_ATP_TO_UNIT, ALIGN_EXISTING_MATERIAL, ADD_MATERIAL_TO_UNIT and RECOVER_ATP_LINEAGE continue through the existing apply pipeline. There is no AI DELETE action in this baseline. This UI change does not invent one or weaken rejection of unsupported action types.

## UI changes and files

- `src/components/ATPUnitMappingManager.tsx`: removes the long duplicated report; keeps Diperbaiki / Perlu ACC / Belum selesai plus closed Detail Analisis. Mounts the existing review component at each actual Bab/material row. Keeps the material ACC/origin callbacks, automatic handler, save, history, rollback and Step08 navigation. The existing apply handler accepts the clicked row's explicit IDs (or a teacher-edited proposed title/reason) and still calls the same eligibility, atomic apply and validator functions. Remaining proposals refresh rather than disappear after one approval. Related selections can be approved together within their Bab. Existing manual deletion requires confirmation; removed draft items have an actual-deletion marker.
- `src/components/AlignmentProposalReview.tsx`: adds an inline rendering mode and a UI-only diff projection. Reuses the original material review form. Renders Setujui / Ubah / Tolak next to a pending proposal, with a short pedagogical reason and expandable impact/evidence. Action names are presented in Indonesian. Existing standalone rendering remains compatible with regression consumers; it is not mounted as another report by the Step07 page.
- `scripts/testStep07InlineAlignment.tsx`: PJOK Kelas6 fixture and inline UI/handler regressions, plus ignored static visual fixtures.
- `package.json`, `scripts/ci/test-groups.json`: expose `test:step07-inline` and include it in planning CI.

No server, prompt, semantic engine, canonical validator, action-classification service, storage service, canonical type/schema or curriculum data was changed. This was checked with `git diff --exit-code -- server.ts server src/services src/types` before committing. No dependencies were added.

## Behavior and boundaries

Changes are grouped by their actual Bab/material location. An unapproved ADD is a proposal on its target Bab, not a real added material. Moves remain on the source material until approved and become actual relocation differences after approval. Unit-title and material-order proposals stay with their Bab. Invalid proposals remain disabled with their validation explanation. Legacy bundles still require all necessary, explicitly selected actions; a partial bundle remains rejected.

Badges compare the current draft with the persisted mapping: Diedit has an expandable before/after diff; Ditambahkan requires an actual new material ID; Diselaraskan reflects actual relation, location or order differences; Dihapus requires actual absence from the draft, excluding materials moved to another Bab. Recommendations alone never create an applied-change badge. An unchanged item has no change badge. Once saved, the clean draft has no pending delta against the new persisted baseline; the existing history remains available.

Ubah on an editable title proposal keeps the edited text in the form until the teacher explicitly approves it. The same engine validates the amended candidate. ADD evidence for its newly proposed title follows the existing new-material source contract; canonical TP evidence/IDs are not rewritten. MOVE/LINK/order adjustments retain the existing row editor and manual review controls. No substantive action is silently applied by this UI.

Tolak is a presentation decision for the active analysis. It removes that proposal from selection and changes no mapping data. An explicit new analysis may propose it again; no persisted rejection model was added. Save, original titles, action history, title undo, persistent relation undo, last-batch rollback and unsaved notices remain intact. Existing manual-edit invalidation and async/source fingerprint protections are retained.

## Verification

The inline suite covers 9 Bab and the 12 missing-lineage materials from the existing PJOK Kelas6 fixture (27 listed materials in total), one inline review per affected row, no invented badges on unchanged data, all six minimal action types through the actual manager callback, approval/validation/undo, amended ADD, rejection without mutation, repeated analysis after amendment, confirmation/cancellation of manual removal, unsupported DELETE rejection and complete/partial legacy bundles.

Existing Step07–08 suites additionally cover semantic evidence, canonical lineage, readiness, stale analysis, manual edits, persistence, import, backup/restore, title revision behavior, actual document-title export and latest saved data consumed by Step08.

| Check | Result |
|---|---|
| Related Step07–08 scripts | PASS 20/20, including the inline suite and all six minimal action types. |
| Storage/navigation CI | PASS 22/22, including semester navigation and canonical workflow. |
| Typecheck | PASS `npm run lint`. |
| Production build | PASS `npm run build`; existing large-bundle warning remains. |
| Diff / engine boundary | PASS `git diff --check`; no changes under server, services or canonical types. |
| Static visual fixture | Inspected at desktop 1365px and narrow 500px: inline placement, wrapping and controls are visible. |

Execution evidence is in ignored `artifacts/ci/step07-inline-checked-related.json`, `artifacts/ci/storage-results.json`, `artifacts/ci/step07-inline/` and `tmp/step07-inline-*.log`.

Static desktop/narrow fixture rendering is a visual check of representative inline markup. It is not a live authenticated application session, an actual phone viewport test or a live Gemini test. No production browser storage was modified. Historical authorization questions from the previous audit remain governed by the unchanged engine and teacher ACC flow.

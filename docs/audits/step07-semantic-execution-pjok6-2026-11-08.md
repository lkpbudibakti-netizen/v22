# Step 07 semantic alignment execution — PJOK Kelas 6

Baseline: `8d30d199de96a52028833078e9ef42bc11ebe3d2`, main. Input: user diagnostic build ID ending `6aebea2a-8842-4960-8feb-8b4524b55a3e`. This build identifier is not a Git SHA. The supplied UNITS section actually enumerates **9 Bab and 27 materials**, including four `alignment-prop-*` materials, not 28. The fixture retains that count and the canonical statements/IDs.

## End-to-end audit and actual causes

1. `server.ts` calls the existing AI prompt, sanitizes the response through `mappingAnalysis.ts` → `mappingBabFirstAnalysis.ts` / `mappingMinimalAnalysis.ts`, and falls back when AI is unavailable. The prompt primarily requested executable minimal proposals; it did not provide a structured conditional-candidate channel for uncertain pedagogical cases.
2. The Bab-first analyzer emits MANUAL_REVIEW when no TP is stored or proposed. Its old explanation incorrectly attributed that absence to insufficient keywords. Short titles such as hand-walking, rhythmic movement or gliding do not establish irrelevance to broad movement TP; they also do not prove the investigative/transfer competence demanded by those TP.
3. `buildMappingPedagogicalReport` reported support for existing links and gaps in Bab declarations, but omitted individual empty material/Bab lineage from its structured findings. The UI offered proposal selection only where an executable AI action existed; unresolved findings had no inline resolution form. Existing-material findings now also carry an explicit `REVIEW_AND_APPROVE` action descriptor, so a missing verified LINK proposal does not mean a dead end.
4. `buildATPUnitMappingDiagnosticReport` printed linked IDs from `finding.action`, not the mapping. A SUPPORTED material ordinarily has no action, so it was falsely displayed with empty IDs. Minimal proposals, rejection reasons, gap findings, source revision and material authorization history were not exported.
5. The existing engine already supports source-bound, atomic cloned-draft application and canonical validation. LINK_TP was additive, protecting manual links, but that meant an explicit correction needed a separate controlled replace path. Persistent relation history lacked sufficient before/after snapshots for undo after reload.
6. `applyMinimalAlignment` creates ADD IDs as `alignment-${action.id}`; action IDs `prop-11`, `prop-47`, `prop-50`, `prop-51` explain the four observed prefixes. This identifies a possible generating path, not proof of actual historical consent. The supplied APPLIED ACTION IDS is only the last recorded selection and does not establish the origin of all existing materials. The current UI already requires teacher selection for ADD; automatic authority now also rejects ADD at the engine boundary.
7. `saveATPUnitMappingV5` persists the whole validated mapping in one storage update, with separated presentation/substance/structure revisions from the preceding change. App Save refreshes V5; Step 08 uses the shared readiness resolver against saved data. This storage architecture and canonical curriculum remain unchanged.

## Changes, bounded to the existing path

| Files / functions | Behavior |
|---|---|
| `server/mappingAnalysis.ts` / `buildMappingAnalysisPrompt` | Explicitly evaluates every material independent of global coverage; reasons about competence, activity, scope and Bab context. Adds structured `materialReviews.candidates` with exact source quotations and `missingEvidence`, without inventing activities. |
| `server/mappingMinimalAnalysis.ts` / `attachMinimalAlignment` | Normalizes conditional candidates through the same minimal action engine. Missing evidence remains visible with pedagogical reason and a route for teacher evidence/ACC. Automatic authority is recomputed, never taken from AI confidence. Generates safe canonical-parent repair proposals from independently verified existing TP. |
| `server/mappingBabFirstAnalysis.ts` | Explains absent TP proposals accurately; adds mapping-derived current linked IDs to every finding. ATP ALIGNED requires independently supported or teacher-reviewed material support, not an unapproved AI proposal. |
| `server.ts`, `src/services/aiService.ts` | Accept candidate-shaped AI responses and preserve explicit fallback notices. Failed/unconfigured AI leaves review options and teacher actions, without fabricated semantic recommendations. |
| `mappingAlignmentService.ts` | Extends the existing engine with material resolution projection, canonical comparison options, independently checked automatic authority, original-material authorization audit, display-only Bab prefix normalization and persisted relation undo. Adds missing lineage to the existing structured report. |
| `atpMappingActionApplyService.ts`, `types/index.ts` | Carries explicit replacement and optional before/after relation metadata. Default LINK remains additive; replacement/clearing requires explicit teacher action. |
| `ATPUnitMappingManager.tsx`, `AlignmentProposalReview.tsx` | Every structured finding has a clickable execution path. Every material has TP/ATP/source evidence, candidate reasons, impact and a concrete ACC form. Teacher can approve links, approve a title correction, explicitly replace/clear incorrect links, or confirm current existence of an unverified added material. Automatic completion, pending approval and evidence-needed status are separate. Existing manual decisions are recorded and protected. No new page. |
| `diagnosticService.ts` | Current linked IDs come from the same mapping as UNITS; proposed IDs are separately labeled. Exports source SHA/dirty status, current Step08 blockers, proposals, gap reasons, resolutions and material authorization history. Current data and last-analysis data are explicitly distinguished. |
| `scripts/testStep07SemanticExecution.ts`, fixture JSON, CI config and package script | Portable reproduction of all 12 actual missing materials, executable UI callbacks, real storage roundtrip and regressions. Existing empty-material test now expects the correct absent-proposal explanation. |

## Execution and safeguards

- **AUTO_APPLY**: proven cosmetic/equivalent redaction; a single unambiguous complete TP proposition expressed by the material itself (ignoring only subject prefix and closed cosmetic equivalences); or repair of canonical ATP parents for previously verified TP. This is full-proposition equivalence, not keyword overlap. Canonical IDs, exact quotes, conflicts and the complete candidate still pass the existing validator. Prior manual relation decisions and undo prevent automatic reversal.
- **NEEDS_APPROVAL**: new semantic inferences, conditional candidates, relation corrections, title scope changes, material addition/movement and substantive changes. AI's STRONG claim alone is insufficient. A teacher can provide the missing pedagogical explanation directly in the form and ACC; that decision and source evidence are recorded.
- If AI supplies no usable candidate, the UI supplies **canonical comparison options**, explicitly not relevance recommendations. Each shows the TP statement, competence, actual material quote, derived ATP, missing proof and impact. An explicit conflict is disabled. The teacher can resolve a supported case without waiting for another AI response; an unsupported case can remain incomplete or have an incorrect link explicitly cleared.
- Actions update a cloned draft atomically, preserve unrelated manual links by default, and are persisted together through existing **Simpan Pemetaan**. Continuing to Step 08 invokes existing save/readiness behavior. The UI explicitly identifies draft versus saved state.
- Explicit teacher replacement may reduce coverage while correcting an incorrect link. Such a draft is not granted readiness: canonical validation and completeness still govern Step 08. No automatic coverage-loss exception exists.
- Persisted LINK history includes material and Bab relation snapshots. Undo checks the current title/relations, preserves support still needed by sibling materials and validates the resulting draft. Fresh ACC after undo creates a fresh record; repeated identical application remains idempotent.
- Four legacy AI-material IDs are **UNVERIFIED** until matching teacher history is available or the teacher confirms their current existence. This records current adoption, not invented historical consent. No material is deleted or added to force validation.
- Bab labels are normalized for display only, avoiding `Bab 1: Bab 1:` without changing curriculum or stored titles. Existing presentation-only version behavior remains unchanged.

## Verification

| Check | Result |
|---|---|
| All 12 actual missing materials | PASS: each has canonical options/evidence/impact and executable ACC; local 4-Bab/12-material blockers remain despite global 5/5. |
| AI failure / absent candidates | PASS: conservative fallback, no invented link, all material review forms available. |
| Conditional semantic candidate / missing evidence | PASS: source/reason retained, no automatic action; teacher evidence and ACC route available. |
| New automatic relation | PASS: complete unique proposition accepted; ambiguous equivalent TP and prior manual decisions block automatic application. |
| Strong AI claim without independent authority | PASS: new inferred TP links cannot auto-apply; all 12 illustrative proposed links require ACC. |
| SUPPORTED with no action | PASS: finding and diagnostic linked IDs match UNITS. |
| Legitimate reused/multiple relations, manual edits, minor-title stale behavior | PASS in related mapping and pedagogical regression suites. |
| Four legacy additions / new ADD authority | PASS: historical unknown preserved; recorded current confirmation is idempotent; automatic ADD rejected, explicit teacher ADD records authorization. |
| Atomic application / save / Step08 | PASS: actual manager ACC handler processes all 12; real storage contains the full saved mapping; shared Step08 resolver reads latest saved data; failed batch cannot persist partial data. |
| Persistent undo / reanalysis | PASS: undo after JSON roundtrip, sibling support preserved, manual-change rejection, renewed ACC after undo and idempotent reapplication. |
| Clickable action for every finding | PASS: report contract verifies one action per finding, opening the corresponding executable form; actual manager callback exercised. |
| TypeScript | PASS (`npm run lint`). |
| Related regression scripts | PASS 19/19, including the 13-scenario pedagogical suite and the new actual diagnostic execution suite. Latest focused rerun covers action logging, undo, full-proposition automatic authority, conditional candidates and clickable review handlers. |
| Configured CI | PASS 44/44 scripts: storage 22, planning 9, documents 8, transport 5. Broad CI passed before the final focused action-history/descriptor refinements; those refinements were checked with the related suite and TypeScript. |
| Production build / diff | PASS (`npm run build`) on the final source, with existing large-bundle warning. `git diff --check` PASS. Logs are in ignored `tmp/` and `artifacts/ci/`. |

These are provider-shaped fixtures and UI handler/DOM contracts, not a claim of live Gemini pedagogical quality or visual browser approval. The synthetic ACC fixture demonstrates the execution path; it is not an instruction to assign the same TP to all 12 real materials. Actual teacher data has not been changed by the tests. Definitive historical authorization of the four uploaded additions remains **BLOCKED** by missing history in the supplied diagnostic. A new diagnostic now includes that evidence when present.

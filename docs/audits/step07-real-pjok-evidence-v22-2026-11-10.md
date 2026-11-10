# Step 07: actual PJOK Class 6 import and saved-project evidence

Baseline: `56af6f1f76b3cee3c010029ddd0bb20716f7e0d7`, main.

## Actual inputs and reproduction

- User Excel `Kelas_6_Fase_C_PJOK.xlsx`: **9 Bab, 23 materials**, not 27. The production import parser and the actual browser import preview agree. All imported TP/ATP relationships are empty.
- User project ZIP: 9 Bab, 27 materials, including four earlier additions. Existing independent Gemini verdicts and their quoted evidence are retained in the archive.
- The unmodified baseline readiness resolver reports **4/9 complete, 11 issues** on that archive. Three additional semantic issues affect two Senam materials and one Gerak Berirama material. The baseline output is retained at `tmp/step07-real-pjok-baseline.log`.

Those three genuine Gemini checks each have two evidence entries for the **same TP**, one quoting `menyesuaikan`, the other quoting `mentransfer`. Both source quotations are valid, both competence phrases occur in the canonical TP and edited material, and the original material context remains present.

`hasStep07StoredSemanticSupport` and `validateStep07AutoExecution` required exactly one evidence entry per TP. That cardinality rule rejects valid compound-competence evidence. It explains why the archive's two previously repaired Bab fail revalidation; the saved data itself is still present. The earlier stale-snapshot fix addresses another real path but does not fix this archive's cause.

## Minimal changes

- `src/services/step07AutoExecutionPolicy.ts`: require at least one proof per selected TP and validate **every** matching entry. A valid first entry cannot mask a forged source, invented competence, lost context or otherwise failing second entry. Independent verdict and action identity checks, canonical fingerprints, hard-conflict guards, EDIT competence/context checks and LINK rationale requirements remain unchanged. Negative proof authorizing relation removal is unchanged.
- `src/components/ATPUnitMappingManager.tsx`: derive the displayed remaining count from current readiness and resolved original IDs. The archive's stale `remaining=11` is not replayed after three false issues disappear.
- `server.ts`: expose the already-redacted, bounded provider exception in the existing scoped Step 07 `analysisNotice`. The same explanation flows to the UI, Detail proses and diagnostic report. Credentials/HTML are redacted; approval, model selection, retry policy, HTTP/fallback contract and other AI endpoints are unchanged.
- `scripts/testStep07RealProjectEvidence.ts` and `scripts/fixtures/pjokClass6RealProjectEvidence.json`: curriculum-only replay from the user's actual Excel rows and saved project, including the three real compound checks. No profile, school, credentials or student data is included.
- `scripts/testStep07Observability.ts`: actual route-handler regression for a redacted, actionable provider failure. `package.json` and planning CI register the new replay.

## Live browser test — not a simulated provider

Visited the supplied AI Studio app `85301095-8770-4f3a-abae-1662cb4c35cc`, then its observed direct preview URL. Live build badge: `4ea3cf5fdb4b`; it supplies no Git commit SHA. No remote app code or deployment was changed.

Used an isolated browser session, anonymous profile/school and curriculum-equivalent project copy. Imported the actual Excel through **Pilih Excel Bab & Materi → Terapkan ke Draf → Analisis & Selaraskan**. The preview confirms 9/23. The button enters INITIAL_MAPPING with 42 genuine readiness issues.

Both live attempts fail at the first Bab before any Gemini proposal or verification:

| Request ID | HTTP | Duration | Engine | Fallback | Progress |
| --- | --- | --- | --- | --- | --- |
| step07-694f4634-2eed-4793-99c3-d51733a0794e | 200 JSON | 15,553 ms | pedagogical_engine | AI_PROVIDER_ERROR | 0/9; 42 remaining |
| step07-40f9b00c-fbbb-4f7d-b11f-eb2ae09abebb | 200 JSON | 10,073 ms | pedagogical_engine | AI_PROVIDER_ERROR | 0/9; 42 remaining |

Resume makes a new request rather than treating the fallback as an approved semantic result. Reload and reopening Step 07 retain the 23-material draft, 42 issues and checkpoint. Step 08 remains disabled. Evidence: `artifacts/ci/step07-real-pjok/live-diagnostic.log` and `live-step07.jpg` (ignored local artifacts).

**Live completion is BLOCKED.** The deployed endpoint does not return the underlying exception. Its catch also surrounds prompt/sanitization work, so the response alone cannot prove whether quota, credentials, access, model availability or an internal pipeline exception caused it. No guess is presented as a proven cause. This test session does not inherit a private BYOK key from the user's own browser. The returned safe cause must be inspected on an updated deployment, and a new successful end-to-end run is required before claiming 9/9.

## Verification

- Actual saved evidence replay: **6/9 complete, 8 genuine remaining lineage issues**, preserving all original titles, material count and canonical items. The remaining gaps are in Bab 1, 4 and 7; they are not silently filled.
- All three real compound actions pass policy → APPLY → saved support. Bad secondary source/material/competence/context, CONFLICT, NEEDS_REVIEW and missing evidence remain rejected.
- UI replay displays 8 current issues instead of stale 11; backup/reload replay retains six supported Bab; Step 08 remains locked.
- Complete final regression results: `artifacts/ci/step07-real-pjok/regression-results.json` (nine Step 07 scripts); related Step 08 lineage, persistence and semantic-authority results: `related-results.json`.
- TypeScript/lint: `npm run lint` (`tsc --noEmit`), `tmp/step07-real-types.log`.
- Production build: `tmp/step07-real-build.log`; existing large-bundle warning remains.

Final result: **PASS 9/9 Step 07 scripts**, including auto-repair 29/29, checkpoint 20/20, progress persistence, actual-project replay, observability and timeout resilience. **PASS 3/3 related scripts**, TypeScript/lint, build and diff checks. These results do not convert the separately recorded live provider failure into a successful Gemini test.

The replay uses actual archived model output, not a new successful Gemini response. New provider generation has **not** passed live. Original user files were read only. No canonical TP/ATP, curriculum scope, manual material, engine architecture, approval policy or Step 08 gate was rewritten to force success.

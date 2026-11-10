# Step 07 — LINK_TP semantic validation (2026-11-10)

Baseline: a8c863ad62dca4158a1df70ab18178503ae8dd41, main.

## Proven cause and execution path

The scoped policy required `contains(after, competenceQuote, 4)` for every action. LINK_TP retains the existing title, so an implicit activity title could not pass even with independent semantic support. The VERIFY prompt repeated this literal-title requirement. Additionally, exact-proposition LINK_TP proposals could bypass scoped VERIFY through the existing deterministic automatic-action shortcut. The scope now requires independent VERIFY for every LINK_TP before FILTER/APPLY; legacy/manual automatic policy is unchanged.

PROPOSE still uses canonical IDs and existing source-citation normalization. FILTER and APPLY both use validateStep07AutoExecution. Only LINK_TP is exempt from literal competence-in-title matching. Its competenceQuote must still quote a canonical competence, material/context quotes must match original material, and independent verdict must be SUPPORTED with a nonempty reason, no missing evidence, and exactly one evidence entry per TP. For implicit competence titles, a per-TP relationshipReason explaining activity, competence and scope is mandatory. The prompt forbids keyword-only support and requests NEEDS_REVIEW when activity cannot be established. This is structured semantic verifier evidence, not a deterministic semantic proof.

EDIT_MATERIAL and other actions retain existing literal competence, source-context preservation and hard-conflict checks. No automatic wording edit is introduced by this fix. Independent CONFLICT/NEEDS_REVIEW always blocks the relation.

Persisted scoped history now rechecks evidence against original/current material and canonical TP before contributing pedagogical support to readiness. A stored SUPPORTED label or linkedTpIds alone is insufficient. The readiness resolver and Step 08 gate themselves are unchanged. Undo, canonical fingerprints, checkpoint dependency matching and selective cache reuse remain in place. Old checkpoints remain readable; incomplete proof requires re-verification rather than a fabricated pass.

Existing repair of inaccurate source citations by valid canonical IDs remains intentionally available. It changes source pointers only, never independent verdict, competence/context claim or pedagogical rationale. Direct forged-source proof fails policy; source repair cannot authorize an unsupported relation.

## Files

- src/services/step07AutoExecutionPolicy.ts: action-specific evidence checks; stored-proof validation.
- src/services/step07AutoRepairService.ts: include all scoped LINK_TP in independent VERIFY.
- src/services/mappingAlignmentService.ts: check stored proof before granting scoped pedagogical support; prevent invalid scoped proof falling through to legacy automatic shortcut.
- src/types/index.ts: optional relationshipReason on existing evidence object (backward-compatible shape).
- server/mappingAnalysis.ts: matching action-specific verifier contract.
- scripts/testStep07AutoRepair.ts: short-title success, mismatch/keyword-only rejection, forged/incomplete evidence, preserved EDIT safeguards, saved proof corruption, independent verification of full-proposition relation.

## Validation

Results are recorded below after final runs. All AI tests use simulated structured proposer/verifier responses, not live Gemini. No claim of actual pedagogical completion by Gemini is made.

The existing PJOK fixture contains 9 Bab/27 materials, 4 Bab and 12 materials without lineage (16 structural gaps), although global 5/5 TP/ATP coverage is already full. Its existing verified EDIT provider repairs the fixture while retaining all 27 materials. The separate stagnation fixture deliberately withholds semantic evidence for remaining gaps and must retain 8 unresolved issues with Step 08 locked.

The new isolated short-title case has 4 readiness issues before repair and 0 after independently supported LINK_TP; title remains exactly Sikap kuda-kuda. Denied irrelevant/keyword-only cases retain unchanged draft and blocked readiness. Corrupting saved evidence blocks readiness again.

## Limits

Independent model review can be mistaken. Deterministic checks establish source provenance, contract completeness, explicit conflict checks and readiness consistency; they cannot prove pedagogical truth from free text. Live Gemini, deployed authenticated transport and browser interactions were not exercised in this change. Production bundle retains its existing large-chunk warning.

### Final observed results

- PASS: all six Step 07 regression scripts. Auto-repair: 29/29 scenarios (tmp/link-auto-verified.log); pedagogical: 13/13; observability: 8/8; semantic execution and inline UI scripts pass. Checkpoint: 20/20 scenarios (tmp/link-hybrid-final.log).
- PASS: 17 additional mapping/Step 07–08 scripts (artifacts/ci/step07-link-related-results.json).
- PASS: TypeScript, npm run lint (tmp/link-types-final.log).
- PASS: production build (tmp/link-build-final.log), existing bundle-size warning only.
- PASS: git diff --check.
- PJOK raw fixture: 31 full readiness issues before, 0 after the existing simulated verified-repair provider; 16 of the initial problems are structural missing-lineage gaps (4 Bab + 12 materials). All 27 materials and canonical data retained.
- Deliberately incomplete PJOK checkpoint fixture: 16 initial issues -> 8 remaining; progress persists and Step 08 stays locked.
- Short-title fixture: 4 -> 0 readiness issues, exact title unchanged. Unsupported and keyword-only cases remain blocked; fake/incomplete proof and unsafe EDIT fail.

An initial planning run exposed an obsolete test expectation that full-proposition LINK_TP never invokes VERIFY. The test now provides independent VERIFY, matching the stricter scoped contract; the corrected auto-repair suite passes 29/29. Initial failing logs are preserved; final per-script results above supersede that intermediate run. No production validator was relaxed to satisfy the test.


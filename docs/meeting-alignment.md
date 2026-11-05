# Calendar-driven meeting alignment

Limited audit (v22 working tree, origin lkpbudibakti-netizen/v22):
- Builder: createEmptyUnitExecutionPlanData, unitExecutionPlanService.ts.
- Allocator: allocateUnitMeetings, unitMeetingAllocationService.ts; previously rejected existing > capacity without a review path.
- Structural/coverage validation: validateUnitExecutionPlan; capacity gate: allocator and UnitExecutionPlanManager.handleGenerateWithAI.
- UI and approval: UnitExecutionPlanManager; receives the existing planned capacity contract from AnnualPlanningManager.
- Persistence: onSave -> App.handleSaveUnitExecutionPlan -> saveUnitExecutionPlanV5; reload via getUnitExecutionPlanV5.

The new proposal uses the existing semester boundary, per-unit minimum of one slot, and protected-content count as a stronger lower bound. Deterministic proportional largest-remainder allocation only removes empty slots. Any title, curriculum reference, or unknown nonempty field protects a meeting. No content-bearing meeting can be removed through this feature. Conflicts require manual review through existing editing controls; no destructive approval is offered.

Preview is pure. Approval recomputes against current plan, mapping, and the full received capacity object; stale fingerprints are refused. Only successful validation and the existing save callback commit the result. Blank slots are valid draft structure, with existing coverage completeness gates retained. Invalid partial-content meetings remain invalid. AI still uses allocateUnitMeetings and its exact target counts; zero remaining slots never requests new meetings. Capacity errors return before the AI API and are shown separately.

Example with empty removable slots: S1 42 -> 42; S2 Bab 5..8 [15,12,9,12] -> [13,10,8,10] (41). If all 48 slots contain content, the proposal is blocked and lists per-unit protected minima instead.

Verification commands:
- npm run test:meeting-alignment
- npm run test:calendar
- npm run test:workflow
- npm run test:step08-jp
- npm run lint
- npm run build

No calendar source, resolver, holiday rules, semester mapping, AI model, or prompt was changed. Browser interaction and live Gemini execution are separate manual checks; no live provider request is needed for the zero-work case.

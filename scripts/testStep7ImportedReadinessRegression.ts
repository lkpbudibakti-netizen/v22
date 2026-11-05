import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ATPUnitMappingManager } from '../src/components/ATPUnitMappingManager';
import { applyATPMappingActions, computeMappingFingerprint, type MappingActionItem } from '../src/services/atpMappingActionApplyService';
import { proceedWithATPUnitMapping, resolveATPUnitMappingReadiness } from '../src/services/atpMappingReadinessService';
import type { ATPData, TPData, ATPUnitMappingData } from '../src/types';

const tp: TPData = { id: 'tp', academicSettingId: 'year', workflowStatus: 'SIAP', updatedAt: '2026-01-01',
  items: ['Melempar bola', 'Menangkap bola'].map((scope, i) => ({ id: `t${i}`, code: `E1-GER-0${i + 1}`,
    statement: `Mempraktikkan ${scope}`, competence: 'Mempraktikkan', contentScope: scope, order: i + 1 })) };
const atp: ATPData = { id: 'atp', tpDataId: tp.id, academicSettingId: 'year', workflowStatus: 'SIAP', updatedAt: '2026-01-01',
  items: tp.items.map((t, i) => ({ id: `a${i}`, stepNumber: i + 1, focus: t.statement, linkedTpIds: [t.id] })) };
const mapping: ATPUnitMappingData = { id: 'map', academicSettingId: 'year', atpId: atp.id, tpDataId: tp.id, updatedAt: '2026-01-01',
  units: tp.items.map((t, i) => ({ id: `u${i}`, title: `Bab ${i + 1}`, order: i + 1,
    linkedTpIds: [t.id], linkedAtpItemIds: [`a${i}`], materials: [{ id: `m${i}`, title: t.contentScope!, order: 1,
      linkedTpIds: [t.id], linkedAtpItemIds: [`a${i}`] }] })) };
const before = JSON.stringify(mapping);
const fp = computeMappingFingerprint(mapping.units, atp, tp);
const apply = (actions: MappingActionItem[]) => applyATPMappingActions({ units: mapping.units, atp, tp,
  mappingId: mapping.id, academicSettingId: 'year', expectedFingerprint: fp, currentFingerprint: fp, selectedActions: actions });
const assign: MappingActionItem = { id: 'assign', type: 'ASSIGN_ATP_TO_UNIT', targetUnitId: 'u0', atpItemId: 'a1', linkedTpIds: ['t1'] };
assert.equal(resolveATPUnitMappingReadiness(mapping, atp, tp).canProceed, true);
const unsupported = apply([assign]);
assert.equal(unsupported.success, false);
assert.ok(unsupported.issues.some(i => i.includes('SOURCE_LINEAGE_MISSING')));
assert.equal(JSON.stringify(mapping), before);
const add: MappingActionItem = { id: 'add', type: 'ADD_MATERIAL_TO_UNIT', targetUnitId: 'u0',
  title: 'Praktik menangkap bola', linkedAtpItemIds: ['a1'], linkedTpIds: ['t1'] };
const valid = apply([assign, add]);
assert.equal(valid.success, true, valid.issues.join('; '));
assert.equal(resolveATPUnitMappingReadiness({ ...mapping, units: valid.nextUnits! }, atp, tp).canProceed, true);
assert.deepEqual(valid.nextUnits!.map(u => [u.id, u.title, u.order]), mapping.units.map(u => [u.id, u.title, u.order]));
assert.deepEqual(valid.nextUnits![0].materials[0], mapping.units[0].materials[0]);
const irrelevant = apply([assign, { ...add, title: 'Pembagian pecahan' }]);
assert.equal(irrelevant.success, false);
assert.ok(irrelevant.issues.some(i => i.includes('kesesuaian')));
const destructiveAlign = apply([{ id: 'align', type: 'ALIGN_EXISTING_MATERIAL', targetUnitId: 'u0', targetMaterialId: 'm0',
  linkedTpIds: [], linkedAtpItemIds: [] }]);
assert.equal(destructiveAlign.success, false);
const partialAtp = { ...atp, items: [{ ...atp.items[0], linkedTpIds: ['t0', 't1'] }] };
const empty = [{ ...mapping.units[0], linkedTpIds: [], linkedAtpItemIds: [], materials: [] }];
const emptyFp = computeMappingFingerprint(empty, partialAtp, tp);
const subset = applyATPMappingActions({ units: empty, atp: partialAtp, tp, expectedFingerprint: emptyFp,
  currentFingerprint: emptyFp, selectedActions: [{ ...add, linkedTpIds: ['t0'], linkedAtpItemIds: ['a0'], title: 'Melempar bola' }] });
assert.equal(subset.success, true, subset.issues.join('; '));
assert.deepEqual(subset.nextUnits![0].linkedTpIds, ['t0'], 'Do not append unselected canonical TPs to Bab');
const partial = { ...mapping, units: mapping.units.map((u, i) => i ? { ...u, materials: [] } : u) };
const blocked = resolveATPUnitMappingReadiness(partial, atp, tp);
assert.equal(blocked.canSaveDraft, true);
let saves = 0; let navigations = 0;
const denied = proceedWithATPUnitMapping(blocked, () => { saves++; return true; }, () => { navigations++; });
assert.equal(denied.proceeded, false);
assert.ok(denied.issues.some(i => i.includes('SOURCE_LINEAGE_MISSING')));
assert.equal(saves, 0); assert.equal(navigations, 0);
const ready = resolveATPUnitMappingReadiness(mapping, atp, tp);
assert.equal(proceedWithATPUnitMapping(ready, () => false, () => { navigations++; }).proceeded, false);
assert.equal(navigations, 0);
assert.equal(proceedWithATPUnitMapping(ready, undefined, () => { navigations++; }).proceeded, true);
assert.equal(navigations, 1);
assert.equal(JSON.stringify(mapping), before);
const render = (value: ATPUnitMappingData) => renderToStaticMarkup(createElement(ATPUnitMappingManager, {
  atp, tp, mapping: value, onSaveMapping: () => true, onNextStep: () => {}, onBackToATP: () => {},
}));
const blockedMarkup = render(partial);
const navMarkup = blockedMarkup.slice(blockedMarkup.indexOf('id="btn-back-to-atp"'));
assert.ok(navMarkup.includes('SOURCE_LINEAGE_MISSING'), 'Specific blocker must be adjacent to the proceed button');
assert.ok(navMarkup.includes('Tinjau Bab dan Lingkup Materi'));
assert.ok(navMarkup.includes('aria-describedby="mapping-proceed-blockers"'));
assert.ok(!render(mapping).includes('id="mapping-proceed-blockers"'), 'Complete saved mapping requires no re-analysis');
console.log('PASS: assignments require relevant material support; gaps cannot regress; subset TP, draft, and navigation safety preserved.');

import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import * as XLSX from 'xlsx';
import type {ATPData,TPData,ATPUnitMappingData,Step07SemanticCheck} from '../src/types';
import {parseBabMateriXlsx} from '../src/services/atpUnitMappingImportService';
import {countStep07CompletedUnits,resolveATPUnitMappingReadiness} from '../src/services/atpMappingReadinessService';
import {applyMinimalAlignment,hasTeacherMaterialSupport,type AlignmentAction} from '../src/services/mappingAlignmentService';
import {step07SourceKey,validateStep07AutoExecution} from '../src/services/step07AutoExecutionPolicy';
import {serializeBackupV5,parseBackupV5} from '../src/services/storageV5';
import {createReadyV21WorkflowFixture} from './fixtures/v21ReadyWorkflowFixture';
import {ATPUnitMappingManager} from '../src/components/ATPUnitMappingManager';

const memory=new Map<string,string>();
(globalThis as any).localStorage={getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)};
const source=JSON.parse(readFileSync('scripts/fixtures/pjokClass6RealProjectEvidence.json','utf8'));
const mapping:ATPUnitMappingData=source.mapping,tp:TPData=source.tp,atp:ATPData=source.atp;
const canonical=JSON.stringify([tp,atp]),original=JSON.stringify(mapping);
const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(source.importRows),'BAB_MATERI');
const imported=parseBabMateriXlsx(new Uint8Array(XLSX.write(workbook,{type:'array',bookType:'xlsx'})));
assert(imported.success);assert.equal(imported.units!.length,9);assert.equal(imported.units!.flatMap(u=>u.materials).length,23);
assert(imported.units!.every(u=>!u.linkedTpIds.length&&!u.linkedAtpItemIds.length&&u.materials.every(m=>!m.linkedTpIds.length&&!m.linkedAtpItemIds.length)));
console.log('PASS actual Excel snapshot: 9 Bab / 23 materials, empty lineage (not the augmented 27-material fixture)');

const readiness=resolveATPUnitMappingReadiness(mapping,atp,tp,undefined,{evaluateRepair:true});
assert.equal(countStep07CompletedUnits(mapping,atp,tp),6);
assert.equal(readiness.repairIssues!.length,8);assert(!readiness.canProceed);
assert(!readiness.repairIssues!.some(i=>i.id.startsWith('semantic:')));
console.log('PASS actual saved project: recorded baseline 4/9 and 11 issues -> 6/9 and 8 genuine remaining issues; Step08 locked');
const html=renderToStaticMarkup(React.createElement(ATPUnitMappingManager,{mapping,atp,tp,onSaveMapping:()=>true,onNextStep:()=>{},onBackToATP:()=>{}}));
const summary=html.match(/id="step07-repair-progress"[^>]*>([\s\S]*?)<\/p>/)![1];
assert(summary.includes('8'));assert(!summary.includes('11'),'UI must not replay the stale remaining=11 from saved metadata');
assert(html.match(/id="btn-next-to-annual-planning"[^>]*>/)![0].includes('disabled'));
console.log('PASS actual saved stale progress metadata: UI shows 8 current issues, preserves the Step08 lock');

let cases=0;
for(const unit of mapping.units)for(const record of unit.actionHistory || []){
  const verification=record.semanticVerification;
  if(!verification||verification.evidence.length!==2||verification.evidence[0].tpId!==verification.evidence[1].tpId)continue;
  const material=unit.materials.find(m=>m.id===record.materialId)!;
  assert(hasTeacherMaterialSupport(unit,material,tp),material.title);
  const before=structuredClone(mapping),beforeUnit=before.units.find(u=>u.id===unit.id)!,beforeMaterial=beforeUnit.materials.find(m=>m.id===material.id)!;
  beforeMaterial.title=record.before;
  const action:AlignmentAction={id:verification.actionId,type:'EDIT_MATERIAL',targetUnitId:unit.id,targetMaterialId:material.id,before:record.before,after:material.title,linkedTpIds:[...record.reviewedTpIds!],reason:record.reason,evidence:verification.evidence.map(e=>({tpId:e.tpId,tpQuote:e.tpQuote,materialQuote:e.materialQuote}))};
  const check=(proof:Step07SemanticCheck)=>validateStep07AutoExecution(before.units,[action],atp,tp,{scope:'STEP07_AUTO_REPAIR',sourceKey:step07SourceKey(before.units,atp,tp),checks:[proof]});
  assert.deepEqual(check(verification),[]);
  const applied=applyMinimalAlignment(before.units,[action],atp,tp,{scope:'STEP07_AUTO_REPAIR',sourceKey:step07SourceKey(before.units,atp,tp),checks:[verification]});
  assert(applied.success,applied.issues.join('; '));
  assert.deepEqual(applied.nextUnits!.find(u=>u.id===unit.id)!.materials.find(m=>m.id===material.id)!.linkedTpIds,action.linkedTpIds);
  for(const mutate of [
    (c:Step07SemanticCheck)=>c.evidence[1].tpQuote='Kutipan palsu',
    (c:Step07SemanticCheck)=>c.evidence[1].materialQuote='Materi berbeda',
    (c:Step07SemanticCheck)=>c.evidence[1].competenceQuote='Kompetensi rekaan',
    (c:Step07SemanticCheck)=>c.evidence[1].contextQuote='Substansi hilang',
    (c:Step07SemanticCheck)=>c.verdict='CONFLICT',
    (c:Step07SemanticCheck)=>c.verdict='NEEDS_REVIEW',
    (c:Step07SemanticCheck)=>c.evidence=[],
  ]){
    const invalid=structuredClone(verification);mutate(invalid);assert.deepEqual(check(invalid),[],'Legacy evidence is history, not an execution gate');
    const corrupted=structuredClone(mapping),u=corrupted.units.find(u=>u.id===unit.id)!,m=u.materials.find(m=>m.id===material.id)!;
    for(const h of [...(u.actionHistory || []),...(m.titleHistory || [])])if(h.materialId===material.id&&h.semanticVerification)h.semanticVerification=structuredClone(invalid);
    assert(!hasTeacherMaterialSupport(u,m,tp),'Corrupt persisted proof must not pass after reload');
  }
  cases++;
}
assert.equal(cases,3);
console.log('PASS 3 real compound-competence actions through policy -> APPLY -> saved support; legacy proof validity no longer controls execution');

const state=createReadyV21WorkflowFixture();state.annualData.tp=[{yearPlanId:'y',value:tp}];state.annualData.atp=[{yearPlanId:'y',value:atp}];state.annualData.atpUnitMappings=[{yearPlanId:'y',value:mapping}];
const restored=parseBackupV5(serializeBackupV5(state));
assert.equal(countStep07CompletedUnits(restored.annualData.atpUnitMappings![0].value,atp,tp),6);
assert.equal(JSON.stringify(mapping),original);assert.equal(JSON.stringify([tp,atp]),canonical);
console.log('PASS reload/backup replay retains six valid Bab and all original titles/canonical items; does not fabricate the remaining lineage');

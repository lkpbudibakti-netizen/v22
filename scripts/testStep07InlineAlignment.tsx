import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import React from 'react';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlignmentProposalReview, inlineMappingChanges } from '../src/components/AlignmentProposalReview';
import { sanitizeMappingAnalysisResult } from '../server/mappingAnalysis';
import { ALIGNMENT_PRIORITY, refreshAlignmentProposals, type AlignmentAction } from '../src/services/mappingAlignmentService';
import { applyATPMappingActions, computeMappingFingerprint, rollbackATPMappingActions } from '../src/services/atpMappingActionApplyService';
import { extractSelectedMappingActions, resolveApplyActionsEligibility } from '../src/services/atpApplyActionEligibilityService';
import { validateATPUnitMappingCanonical } from '../src/services/atpUnitMappingValidationService';
import { evaluateExpression, initializer, nodes, nodeText } from './helpers/uiContractHarness';
import type { ATPData, TPData, ATPUnitMappingData } from '../src/types';
import type { MappingAnalysisResult } from '../src/services/aiService';
const source=JSON.parse(readFileSync('scripts/fixtures/pjokClass6MappingDiagnostic.json','utf8'));
const tp:TPData={id:'tp',academicSettingId:'y',updatedAt:'2026-11-09',workflowStatus:'SIAP',items:source.tp};
const atp:ATPData={id:'atp',academicSettingId:'y',tpDataId:'tp',updatedAt:tp.updatedAt,workflowStatus:'SIAP',items:source.atp};
const mapping:ATPUnitMappingData={id:'mapping',academicSettingId:'y',atpId:'atp',tpDataId:'tp',updatedAt:tp.updatedAt,units:source.units};
const params={currentMapping:mapping,atpData:atp,tpData:tp};
const noop=()=>{};const before=JSON.stringify(params);const validation=validateATPUnitMappingCanonical(mapping,atp,tp);
assert.equal(mapping.units.length,9);assert.equal(validation.materialsWithoutLineage.length,12);
const fallback=sanitizeMappingAnalysisResult({},params);
function row(analysis:MappingAnalysisResult,unitId:string,materialId?:string,extra:any={}) {return AlignmentProposalReview({proposals:analysis.alignmentProposals || [],analysis,selectedIds:new Set(),onSelectionChange:noop,units:mapping.units,baselineUnits:mapping.units,atp,tp,inlineScope:{unitId,materialId},...extra});}
for(const ref of validation.materialsWithoutLineage){const tree=row(fallback,ref.unitId,ref.materialId,{onReviewMaterial:noop});assert.equal(nodes(tree,n=>n.type==='form').length,1);assert.equal(nodes(tree,n=>n.props?.['data-change-badge']).length,0);}
assert.equal(nodes(row(fallback,mapping.units[0].id,mapping.units[0].materials[1].id),n=>n.props?.['data-change-badge']).length,0,'Unchanged material must not receive an applied-change badge');
console.log('PASS PJOK 9 Bab / 12 unresolved materials: one inline review per row, no invented change badges');
const unit=mapping.units[0],material=unit.materials[0],objective=tp.items[0],unitObjective=tp.items.find(t=>t.id===unit.linkedTpIds[0])!;
function action(type:AlignmentAction['type']):AlignmentAction {
 const editUnit=type==='EDIT_UNIT_TITLE',reorder=type==='RESTRUCTURE_UNIT';
 const m=type==='EDIT_MATERIAL'?unit.materials[1]:material;
 const targetObjective=editUnit||reorder||type==='EDIT_MATERIAL'?unitObjective:objective;
 const title=editUnit?unit.title:m.title;
 const after=type==='ADD_MATERIAL'?'Latihan strategi gerak dalam permainan':title+' dengan variasi dan strategi';
 return {id:'ui-'+type,type,targetUnitId:type==='MOVE_MATERIAL'?mapping.units[1].id:unit.id,sourceUnitId:type==='MOVE_MATERIAL'?unit.id:undefined,targetMaterialId:editUnit||reorder||type==='ADD_MATERIAL'?undefined:m.id,
  before:reorder?JSON.stringify(unit.materials.map(m=>m.id)):type==='ADD_MATERIAL'?undefined:title,after:type==='ADD_MATERIAL'||type==='EDIT_MATERIAL'||editUnit?after:undefined,
  materialOrder:reorder?unit.materials.map(m=>m.id).reverse():undefined,linkedTpIds:[targetObjective.id],reason:'Guru meninjau kompetensi, aktivitas dan cakupan usulan sebelum menyetujui perubahan ini.',
  evidence:[{tpId:targetObjective.id,tpQuote:targetObjective.statement,materialQuote:type==='ADD_MATERIAL'?after:title}]};
}
function application(initial:MappingAnalysisResult){let units=structuredClone(mapping.units),analysis=initial,fp=computeMappingFingerprint(units,atp,tp),rollback:any;const issues:string[][]=[];
 const apply=(ids:Set<string>,amendment?:any)=>{
 const callback=evaluateExpression(initializer('src/components/ATPUnitMappingManager.tsx','handleApplySelectedActions'),{units,analysisResult:analysis,analysisFingerprint:fp,currentFingerprint:computeMappingFingerprint(units,atp,tp),mapping,academicSetting:{id:'y'},atp,tp,
 selectedAnalysisActionIds:new Set(),selectedActions:[],actionEligibility:{},extractSelectedMappingActions,resolveApplyActionsEligibility,applyATPMappingActions,computeMappingFingerprint,refreshAlignmentProposals,
 setUnits:(value:typeof units)=>{units=value;},setAnalysisResult:(value:MappingAnalysisResult)=>{analysis=value;},setAnalysisFingerprint:(value:string)=>{fp=value;},setAlignmentRollback:(value:any)=>{rollback=value;},setApplyIssues:(value:string[])=>issues.push(value),setAppliedNotice:noop,setAnalysisError:noop,setHasChanges:noop,setLastAppliedActionIds:noop,setSelectedAnalysisActionIds:noop,setSaveSuccessNotice:noop,mappingCoverage:validateCoverage});callback(ids,amendment);
 };
 function validateCoverage(value:typeof units){return validateATPUnitMappingCanonical({...mapping,units:value},atp,tp);}
 return {apply,get units(){return units;},get analysis(){return analysis;},get rollback(){return rollback;},issues};
}
for(const type of ALIGNMENT_PRIORITY){const a=action(type),analysis=sanitizeMappingAnalysisResult({alignmentProposals:[a]},params),proposal=analysis.alignmentProposals!.find(p=>p.action?.id===a.id);assert(proposal,JSON.stringify(analysis.alignmentProposals));
 const state=application(analysis),owner= a.targetMaterialId?mapping.units.find(u=>u.materials.some(m=>m.id===a.targetMaterialId))!:unit;
 const tree=row(analysis,owner.id,a.targetMaterialId,{onApproveProposal:state.apply});
 const cards=nodes(tree,n=>n.props?.['data-inline-proposal']===proposal.id);assert.equal(cards.length,1);
 const approve=nodes(cards[0],n=>n.type==='button'&&nodeText(n)==='Setujui')[0];assert(approve&&!approve.props.disabled);assert.equal(JSON.stringify(state.units),JSON.stringify(mapping.units));
 assert.equal(nodes(tree,n=>n.props?.['data-change-badge']).length,0,'A pending proposal must never be marked as applied');
 approve.props.onClick();assert(state.issues.every(v=>v.length===0),state.issues.flat().join(';'));assert.notEqual(JSON.stringify(state.units),JSON.stringify(mapping.units));assert(validateATPUnitMappingCanonical({...mapping,units:state.units},atp,tp).isValid);
 assert(state.analysis.alignmentProposals!.find(p=>p.id===proposal.id)?.validationStatus==='ALREADY_APPLIED');
 const undo=rollbackATPMappingActions(state.units,state.rollback.units,state.rollback.fingerprint,atp,tp);assert(undo.success);assert.deepEqual(undo.nextUnits,mapping.units);
 if(type==='MOVE_MATERIAL'){const moved=inlineMappingChanges(state.units,mapping.units,a.targetUnitId,a.targetMaterialId);assert(moved.some(c=>c.label==='Diselaraskan'));assert(!moved.some(c=>c.label==='Ditambahkan'));}
 console.log('PASS inline ACC → existing handler → validation → undo:',type);
}
const addAction=action('ADD_MATERIAL'),addAnalysis=sanitizeMappingAnalysisResult({alignmentProposals:[addAction]},params),addProposal=addAnalysis.alignmentProposals!.find(p=>p.action?.id===addAction.id)!,edited=application(addAnalysis);
const amended='Latihan variasi strategi gerak dalam permainan';edited.apply(new Set([addProposal.id]),{id:addProposal.id,after:amended,reason:addAction.reason});assert(edited.issues.every(v=>!v.length),edited.issues.flat().join(';'));assert(edited.units[0].materials.some(m=>m.title===amended));assert(!edited.units[0].materials.some(m=>m.title===addAction.after));assert.equal(edited.units.flatMap(u=>u.materials).length,28);
assert(inlineMappingChanges(edited.units,mapping.units,unit.id,'alignment-'+addAction.id).some(c=>c.label==='Ditambahkan'));
assert(!sanitizeMappingAnalysisResult({alignmentProposals:[addAction]},{...params,currentMapping:{...mapping,units:edited.units}}).alignmentProposals!.some(p=>p.action?.id===addAction.id),'Reanalysis cannot recreate the original ADD after teacher amendment');
const declined=new Set<string>();const rejectTree=row(addAnalysis,unit.id,undefined,{onRejectProposal:(id:string)=>declined.add(id)});nodes(rejectTree,n=>n.type==='button'&&nodeText(n)==='Tolak')[0].props.onClick();const rejectedTree=row(addAnalysis,unit.id,undefined,{rejectedIds:declined});assert.equal(nodes(rejectedTree,n=>n.type==='button'&&nodeText(n)==='Setujui').length,0);assert.equal(JSON.stringify(params),before);
console.log('PASS Ubah/ACC ADD uses existing validation; rejection is UI-only and never mutates draft');
const changed=structuredClone(mapping.units);changed[0].materials[0].title='MELEMPAR DAN MENANGKAP BOLA';const diffs=inlineMappingChanges(changed,mapping.units,unit.id,material.id);assert.deepEqual(diffs.map(d=>d.label),['Diedit']);assert.equal(diffs[0].before,material.title);assert.equal(diffs[0].after,changed[0].materials[0].title);
const manager=readFileSync('src/components/ATPUnitMappingManager.tsx','utf8');assert(!manager.includes('mapping-legacy-analysis-details'));assert(manager.includes('renderInlineAlignment(unit,mat.id)'));assert(manager.includes('renderInlineAlignment(unit)'));assert(manager.includes('window.confirm('));assert(manager.includes('data-change-badge="Dihapus"'));assert(!manager.includes('<details id="mapping-analysis-details" open'));
const ast=ts.createSourceFile('manager.tsx',manager,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let removeExpression='';
function findRemoval(node:ts.Node){if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='onClick'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression?.getText(ast).includes('window.confirm(`Hapus lingkup'))removeExpression=node.initializer.expression.getText(ast);ts.forEachChild(node,findRemoval);}findRemoval(ast);assert(removeExpression);
let removeCalls=0;evaluateExpression(removeExpression,{window:{confirm:()=>false},unit,mat:material,handleRemoveMaterial:()=>{removeCalls++;}})();assert.equal(removeCalls,0);evaluateExpression(removeExpression,{window:{confirm:()=>true},unit,mat:material,handleRemoveMaterial:()=>{removeCalls++;}})();assert.equal(removeCalls,1);
const unsupported=sanitizeMappingAnalysisResult({alignmentProposals:[{...action('LINK_TP'),id:'unsupported-delete',type:'DELETE_MATERIAL'}]},params);const blocked=row(unsupported,unit.id,material.id,{onApproveProposal:()=>{throw Error('Invalid action must not execute');}});assert(nodes(blocked,n=>n.type==='button'&&nodeText(n)==='Setujui').every(n=>n.props.disabled));
const legacy:MappingAnalysisResult={summary:fallback.summary,atpFindings:[{id:'legacy-assign',atpItemId:atp.items[1].id,status:'REVIEW',supportingTpIds:[objective.id],reason:'Bundle Bab/Materi',action:{type:'ASSIGN_ATP_TO_UNIT',atpItemId:atp.items[1].id,targetUnitId:unit.id,linkedTpIds:[objective.id]}}],materialFindings:[{id:'legacy-material',unitId:unit.id,materialId:material.id,status:'ALIGNABLE',supportingTpIds:[objective.id],supportingAtpItemIds:[atp.items[1].id],reason:'Persetujuan guru untuk materi existing.',action:{type:'ALIGN_EXISTING_MATERIAL',targetUnitId:unit.id,targetMaterialId:material.id,linkedTpIds:[objective.id],linkedAtpItemIds:[atp.items[1].id]}}]};
legacy.materialFindings.push({...legacy.materialFindings[0],id:'legacy-material-3',materialId:unit.materials[2].id,action:{...legacy.materialFindings[0].action!,type:'ALIGN_EXISTING_MATERIAL',targetUnitId:unit.id,targetMaterialId:unit.materials[2].id,linkedTpIds:[objective.id],linkedAtpItemIds:[atp.items[1].id]}});
assert.equal(nodes(row(legacy,unit.id),n=>n.props?.['data-inline-proposal']).length,1);assert.equal(nodes(row(legacy,unit.id,material.id),n=>n.props?.['data-inline-proposal']).length,1);const bundle=application(legacy);bundle.apply(new Set(['legacy-assign','legacy-material']));assert(bundle.issues.some(v=>v.length),'Partial legacy bundle must remain rejected');const wholeBundle=application(legacy);wholeBundle.apply(new Set(['legacy-assign','legacy-material','legacy-material-3']));assert(wholeBundle.issues.every(v=>!v.length),wholeBundle.issues.flat().join(';'));
console.log('PASS actual before/after badges, single primary editor, closed technical details and explicit manual deletion confirmation');
// Static visual fixture: UI only, no browser storage or production data touched.
mkdirSync('artifacts/ci/step07-inline',{recursive:true});let html='<h1>Step 07 · Bab dan Lingkup Materi</h1><p>Diperbaiki: 0 · Perlu ACC: 1 · Belum selesai: 12</p>';
for(const u of mapping.units){html+=`<section class="rounded-xl border p-4 my-4 bg-white"><h2>${u.title}</h2>`+renderToStaticMarkup(row(addAnalysis,u.id));for(const m of u.materials){html+=`<article class="rounded border p-3 my-2"><h3>${m.title}</h3>`+renderToStaticMarkup(row(addAnalysis,u.id,m.id,{onReviewMaterial:noop,onApproveProposal:noop,onRejectProposal:noop}))+'</article>';}html+='</section>';}
let css:string|undefined;try{css=readdirSync('dist/assets').find(name=>name.startsWith('index-')&&name.endsWith('.css'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
writeFileSync('artifacts/ci/step07-inline/preview.html',`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${css?`<link rel="stylesheet" href="../../../dist/assets/${css}">`:''}<body class="bg-slate-50 text-slate-800 p-6"><main style="max-width:1100px;margin:auto">${html}</main></body></html>`);
console.log('PASS Step07 inline UI regression. Static visual fixture written; live Gemini not exercised.');

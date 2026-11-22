import type { CPElem, CPAnalysisItem, CPData } from '../types';
import { reviewCPAnalysisSemantic } from './cpAnalysisSemanticReviewService';
import { cp4IssueCategory, isCP4Placeholder, CP4_FIELDS, type CP4Field, type CP4RepairTarget, understandingIssue, type AnalysisIssue, type AnalysisAIValidation } from './cpAnalysisAIContract';
export { CP4_FIELDS, type CP4Field, type CP4RepairTarget } from './cpAnalysisAIContract';
export type CP4Issue=AnalysisIssue & {category?:'technical'|'structure'|'quality';rowIndex?:number;clauseIndex?:number};
export interface CP4Suggestion {itemId:string;elementId:string;field:CP4Field;before:string;after:string}
export interface CP4Proposal {base:string;items:CPAnalysisItem[];suggestions:CP4Suggestion[];issues:CP4Issue[];summary:string;mode:'full'|'repair'}
export function validateCP4Input(elements:unknown):CP4Issue[] {
  if(!Array.isArray(elements)||!elements.length)return [{elementId:'',field:'elements',code:'CP_ELEMENTS_REQUIRED',category:'structure'}];
  const seen=new Set<string>();const issues:CP4Issue[]=[];
  for(const e of elements) {
    if(!e||typeof e.id!=='string'||!e.id.trim()||seen.has(e.id)||typeof e.name!=='string'||!e.name.trim()||typeof e.content!=='string'||!e.content.trim())issues.push({elementId:typeof e?.id==='string'?e.id:'',field:'elements',code:'CP_INPUT_INVALID',category:'structure'});
    if(typeof e?.id==='string')seen.add(e.id);
  }
  return issues;
}
export function classifyCP4Issue(issue:AnalysisIssue):CP4Issue {
  return {...issue,category:cp4IssueCategory(issue.code)};
}
export function cp4Clauses(element:CPElem):string[] {return element.content.split(/;\s*|[.!?]\s+(?=[A-ZÀ-Ž])/).map(s=>s.replace(/[.;]\s*$/,'').trim()).filter(Boolean);}
const tokens=(s:string)=>s.toLowerCase().match(/[a-zà-ž]{4,}/g)?.filter(w=>!['peserta','didik','murid','mampu','untuk','dengan','yang','dalam','serta','pada','secara'].includes(w)) || [];
const competenceVerbs=new Set(['memahami','membandingkan','menjelaskan','mempraktikkan','menerapkan','menganalisis','mengevaluasi','mencipta','menciptakan','mengidentifikasi','menggunakan','membaca','menulis','menyimak','berbicara','mengomunikasikan','mempresentasikan','melakukan','mendemonstrasikan','menunjukkan','menyajikan','mengukur','menghitung','menentukan','menafsirkan','menyimpulkan','merancang','menyusun','mengamati','merefleksikan','menghubungkan','memecahkan','mengenali','mengklasifikasi','menanggapi']);
export function cp4Coverage(items:Pick<CPAnalysisItem,'elementId'|'cpCompetence'|'materialScope'|'meaningfulUnderstanding'|'suggestedTp'>[],elements:CPElem[]):CP4Issue[] {
  return elements.flatMap(e=>{
    const pool=new Set(tokens(items.filter(i=>i.elementId===e.id).map(i=>CP4_FIELDS.map(f=>i[f] || '').join(' ')).join(' ')));
    return cp4Clauses(e).flatMap((clause,clauseIndex)=>{
      const words=[...new Set(tokens(clause))];const covered=words.filter(w=>pool.has(w)).length;
      const missingCompetence=words.some(word=>competenceVerbs.has(word)&&!pool.has(word));
      return words.length&&(missingCompetence||covered<(words.length<=5?words.length:Math.ceil(words.length*.7)))?[{elementId:e.id,field:'coverage',code:'CP_COVERAGE_REVIEW',category:'quality' as const,clauseIndex}]:[];
    });
  });
}
export function inspectCP4Draft(items:CPAnalysisItem[],elements:CPElem[],cp?:CPData):CP4Issue[] {
  const issues:CP4Issue[]=[];const ids=new Set<string>();
  for(const item of items) {
    const e=elements.find(e=>e.id===item.elementId);
    if(!e||!item.id?.trim()||ids.has(item.id.trim())){issues.push({elementId:item.elementId || '',itemId:item.id,field:'elementId',code:'CANONICAL_REFERENCE_INVALID',category:'structure'});continue;}
    ids.add(item.id.trim());
    for(const field of CP4_FIELDS)if(isCP4Placeholder(item[field]))issues.push({elementId:e.id,itemId:item.id,field,code:field==='meaningfulUnderstanding'?'MU_EMPTY':'FIELD_EMPTY',category:'structure'});
    if(item.meaningfulUnderstanding?.trim()) {const code=understandingIssue(item.meaningfulUnderstanding,e);if(code)issues.push(classifyCP4Issue({elementId:e.id,itemId:item.id,field:'meaningfulUnderstanding',code}));}
  }
  for(const e of elements)if(!items.some(i=>i.elementId===e.id))issues.push({elementId:e.id,field:'items',code:'ELEMENT_MISSING',category:'structure'});
  if(cp)for(const finding of reviewCPAnalysisSemantic(items,cp).findings.filter(f=>f.severity==='WARNING')) {
    const field=({COMPETENCE_MISMATCH:'cpCompetence',UNSUPPORTED_ADDITION:'materialScope',SUGGESTED_TP_INCONSISTENT:'suggestedTp',MATERIAL_MISSING:'coverage'} as const)[finding.type];
    issues.push({elementId:finding.elementId || '',itemId:items.some(i=>i.id===finding.itemId)?finding.itemId:undefined,field,code:field==='coverage'?'CP_COVERAGE_REVIEW':'PEDAGOGY_REVIEW',category:'quality'});
  }
  return [...issues,...cp4Coverage(items,elements)];
}
export function validateCP4Targets(targets:unknown,elements:CPElem[]):boolean {
  if(!Array.isArray(targets)||!targets.length)return false;const ids=new Set<string>();
  return targets.every(t=>{
    const e=elements.find(e=>e.id===t?.elementId);
    if(!e||typeof t.itemId!=='string'||!t.itemId.trim()||ids.has(t.itemId)||!Array.isArray(t.fields)||!t.fields.length||new Set(t.fields).size!==t.fields.length||t.fields.some((f:unknown)=>!CP4_FIELDS.includes(f as CP4Field)))return false;
    ids.add(t.itemId);
    return CP4_FIELDS.every(f=>typeof t[f]==='string')&&(!t.clauseText||typeof t.clauseText==='string'&&cp4Clauses(e).includes(t.clauseText));
  });
}
const targetFor=(item:CPAnalysisItem,fields:CP4Field[],clauseText?:string):CP4RepairTarget=>({itemId:item.id,elementId:item.elementId!,fields,clauseText,...Object.fromEntries(CP4_FIELDS.map(f=>[f,item[f] || '']))} as CP4RepairTarget);
// New rows are local draft rows for uncovered CP clauses, never a change to canonical CP IDs.
export function planCP4Repair(items:CPAnalysisItem[],elements:CPElem[],mode:'full'|'repair',onlyElementId?:string,cp?:CPData):{items:CPAnalysisItem[];targets:CP4RepairTarget[]} {
  const next=items.map(i=>({...i}));const issues=inspectCP4Draft(items,elements,cp);const targets:CP4RepairTarget[]=[];
  for(const item of items) {
    if(!elements.some(e=>e.id===item.elementId)||onlyElementId&&item.elementId!==onlyElementId)continue;
    const fields=mode==='full'?[...CP4_FIELDS]:CP4_FIELDS.filter(f=>issues.some(i=>i.itemId===item.id&&i.field===f));
    if(fields.length)targets.push(targetFor(item,fields));
  }
  for(const e of elements) {
    if(onlyElementId&&e.id!==onlyElementId)continue;
    const existing=items.filter(i=>i.elementId===e.id);
    const missing=issues.filter(i=>i.elementId===e.id&&i.code==='CP_COVERAGE_REVIEW');
    // Coverage uses lexical hints; paraphrases must repair existing rows, not add rows.
    if(existing.length && missing.length) {
      for(const item of existing) {
        const target=targets.find(t=>t.itemId===item.id);
        if(!target)targets.push(targetFor(item,[...CP4_FIELDS],cp4Clauses(e)[missing.find(issue=>issue.clauseIndex!==undefined)?.clauseIndex || 0]));
      }
    }
    if(!existing.length) {
      for(const issue of missing.length?missing:[{clauseIndex:0}]) {
        const clause=cp4Clauses(e)[issue.clauseIndex || 0];
        const blank=targets.find(t=>t.elementId===e.id&&!t.clauseText&&CP4_FIELDS.every(f=>!t[f].trim()));
        if(blank){blank.clauseText=clause;continue;}
        let id=`ana-cp4-${e.id}-clause-${(issue.clauseIndex || 0)+1}`;while(next.some(i=>i.id===id))id+='-new';
        const row:CPAnalysisItem={id,elementId:e.id,elementName:e.name,cpText:e.content,cpCompetence:'',materialScope:'',meaningfulUnderstanding:'',suggestedTp:'',order:Math.max(0,...next.map(i=>i.order))+1};
        next.push(row);targets.push(targetFor(row,[...CP4_FIELDS],clause));
      }
    }
  }
  return {items:next,targets};
}
export function stageCP4Proposal(base:CPAnalysisItem[],working:CPAnalysisItem[],result:AnalysisAIValidation,elements:CPElem[],mode:'full'|'repair',summary:string,targets:CP4RepairTarget[]=[],cp?:CPData):CP4Proposal {
  let rows=working.map(i=>({...i}));const suggestions:CP4Suggestion[]=[];
  const issues=(result.issues as CP4Issue[]).map(classifyCP4Issue);
  if(!working.length) {
    rows=result.items.map((r,index)=>({id:`ana-cp4-${r.elementId}-${index+1}`,elementId:r.elementId,elementName:r.elementName,cpText:r.cpText,cpCompetence:r.cpCompetence,materialScope:r.materialScope,scopeCode:r.scopeCode,meaningfulUnderstanding:r.meaningfulUnderstanding,suggestedTp:r.suggestedTp,order:index+1}));
    for(const e of elements)if(!rows.some(i=>i.elementId===e.id))rows.push({id:`ana-cp4-${e.id}-missing`,elementId:e.id,elementName:e.name,cpText:e.content,cpCompetence:'',materialScope:'',meaningfulUnderstanding:'',suggestedTp:'',order:rows.length+1});
  } else {
    for(const r of result.items) {
      const row=rows.find(i=>i.id===r.itemId&&i.elementId===r.elementId),target=targets.find(t=>t.itemId===r.itemId&&t.elementId===r.elementId);
      if(!row||!target)continue;
      for(const field of target.fields) {
        if(!r[field]?.trim()||issues.some(i=>i.itemId===r.itemId&&i.field===field&&i.category!=='quality'))continue;
        const before=row[field] || '',after=r[field];if(before===after)continue;
        if(before.trim())suggestions.push({itemId:row.id,elementId:r.elementId,field,before,after});
        else row[field]=after; // Proposal only; editor and storage remain untouched.
      }
    }
  }
  const combined=[...issues,...inspectCP4Draft(rows,elements,cp)].map(issue=>({...issue,itemId:issue.itemId || (issue.rowIndex!==undefined&&rows[issue.rowIndex]?.elementId===issue.elementId?rows[issue.rowIndex].id:undefined)}));
  const keys=new Set<string>();const unique=combined.filter(i=>{const key=JSON.stringify([i.elementId,i.itemId,i.field,i.code,i.clauseIndex]);if(keys.has(key))return false;keys.add(key);return true;});
  return {base:JSON.stringify(base),items:rows,suggestions,issues:unique,mode,summary};
}
export function applyCP4Proposal(current:CPAnalysisItem[],proposal:CP4Proposal,approved:Set<string>=new Set()):CPAnalysisItem[]|null {
  if(JSON.stringify(current)!==proposal.base)return null;
  const rows=proposal.items.map(i=>({...i}));
  for(const s of proposal.suggestions)if(approved.has(`${s.itemId}:${s.field}`)) {
    const row=rows.find(i=>i.id===s.itemId&&i.elementId===s.elementId);
    if(row&&(row[s.field] || '')===s.before)row[s.field]=s.after;
  }
  return rows;
}
export function mergeCP4Structure(items:CPAnalysisItem[],elements:CPElem[]):CPAnalysisItem[] {
  const next=items.map(i=>({...i}));
  for(const e of elements)if(!items.some(i=>i.elementId===e.id)) {
    let id=`ana-structure-${e.id}`;while(next.some(i=>i.id===id))id+='-new';
    next.push({id,elementId:e.id,elementName:e.name,cpText:e.content,cpCompetence:'',materialScope:'',meaningfulUnderstanding:'',suggestedTp:'',order:Math.max(0,...next.map(i=>i.order))+1});
  }
  return next;
}
export function cp4ElementStatuses(items:CPAnalysisItem[],elements:CPElem[],failedIds:string[]=[],cp?:CPData) {
  const issues=inspectCP4Draft(items,elements,cp);
  return elements.map(e=>{
    const rows=items.filter(i=>i.elementId===e.id),own=issues.filter(i=>i.elementId===e.id);
    const status=!rows.length?(failedIds.includes(e.id)?'Gagal':'Perlu ditinjau'):own.some(i=>i.category==='structure')?'Gagal':own.length?'Perlu ditinjau':'Siap';
    return {id:e.id,name:e.name,status,rowCount:rows.length,structure:own.filter(i=>i.category==='structure').length,quality:own.filter(i=>i.category==='quality').length,failedRequest:failedIds.includes(e.id)};
  });
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ALL_MASTER_CP_ENTRIES, resolveCPContext } from '../src/data/curriculum/cp';
import { validateCPEntry } from '../src/data/curriculum/validators';
import { PAI_2026_CP_ENTRIES } from '../src/data/curriculum/cp/pai2026';
import manifest from '../src/data/curriculum/cp/sources/pai-bkpdm-020-2026-manifest.json';
import baseline from '../docs/pai-cp-2026-baseline.json';
import { cpSourceRepository } from '../src/services/cpSourceRepository';
import { getSubjectChoices, getSubjectCPAvailability } from '../src/services/subjectSelection';
import { validateCPDataWorkflow } from '../src/services/cpWorkflowService';
import { createInitialStorageV5, saveStorageV5, loadStorageV5 } from '../src/services/storageV5';
import type { CPData, ActiveContext, AcademicSetting } from '../src/types';

const hash = (v:string) => createHash('sha256').update(v).digest('hex');
const unchanged = ALL_MASTER_CP_ENTRIES.filter(e => !(e.subjectCode==='PAI' && e.regulationSourceId==='DEC-BKPDM-020-2026'));
assert.equal(hash(JSON.stringify(unchanged)), baseline.unchangedRegistryHash, 'Historical PAI and every other subject remain byte-identical');
assert.equal(PAI_2026_CP_ENTRIES.length, 6);
assert.equal(new Set(ALL_MASTER_CP_ENTRIES.map(e=>e.id)).size, ALL_MASTER_CP_ENTRIES.length);

// Execute the actual Step 03 selection handler with controlled UI callbacks.
// This is a handler contract test, not a live browser/Gemini test.
const component = readFileSync('src/components/CPManager.tsx','utf8');
const ast = ts.createSourceFile('CPManager.tsx',component,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let initializer = '';
function visit(n:ts.Node) {
  if(ts.isVariableDeclaration(n) && n.name.getText(ast)==='handleApplySelectedSource') initializer=n.initializer!.getText(ast);
  ts.forEachChild(n,visit);
}
visit(ast); assert(initializer);
const js = ts.transpileModule(`exports.run = ${initializer}`, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function apply(item:ReturnType<typeof cpSourceRepository.search>[number], setting:AcademicSetting, cp:CPData, approved:boolean) {
  const saves:CPData[] = [], draft:Record<string,unknown> = {};
  const bindings:Record<string,unknown> = {cp,academicSetting:setting,generalDescription:cp.generalDescription,
    sourceSearch:{status:'RESOLVED'},confirm:()=>approved,validateCPDataWorkflow,onSaveCP:(v:CPData)=>saves.push(v)};
  for(const name of ['GeneralDescription','Elements','Source','IsSourceModalOpen','PendingReviewedSource']) bindings['set'+name]=(v:unknown)=>{draft[name]=v;};
  const exports:any={};new Function('exports',...Object.keys(bindings),js)(exports,...Object.values(bindings));exports.run(item);
  return {saves,draft};
}
assert(component.includes("const isVerified = itemVerStatus === 'VERIFIED'"), 'Badge uses verification status, not RESOLVED');
assert(component.includes('Sumber Belum Terverifikasi (UNVERIFIED)'));

const memory=new Map<string,string>();
Object.assign(globalThis,{localStorage:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
const state=createInitialStorageV5(), stamp='2026-11-12T00:00:00Z';
state.schools=[{id:'s',name:'School',npsn:'',address:'',village:'',district:'',regency:'',province:'',principalName:'',principalNip:'',createdAt:stamp,updatedAt:stamp}];
state.profiles=[{id:'p',schoolId:'s',name:'Teacher',nip:'',status:'PNS',defaultSubject:'PAI',defaultLevel:'SD',createdAt:stamp,updatedAt:stamp}];
for(const [i,entry] of PAI_2026_CP_ENTRIES.entries()) {
  const evidence=manifest.phases[i];
  assert.equal(validateCPEntry(entry).isValid, true, entry.id);
  assert.equal(entry.id,evidence.entryId);assert.equal(entry.verificationStatus,'VERIFIED');
  assert.equal(entry.elements.length,5);assert.equal(entry.implementationFromAcademicYear,'2026/2027');
  assert.equal(entry.evidence![0].locator!.page,evidence.sourcePages.pdf[0]);
  assert(entry.evidence![0].locator!.note!.includes(manifest.primarySource.sha256));
  entry.elements.forEach((e,j)=>{assert.equal(e.number,evidence.elements[j].number);assert.equal(e.name,evidence.elements[j].name);assert.equal(hash(e.content),evidence.elements[j].contentSha256);});
  for(const academicYear of ['2026/2027','2027/2028']) for(const subject of ['PAI','Pendidikan Agama Islam','Pendidikan Agama Islam dan Budi Pekerti']) {
    const context={level:entry.level,phase:`Fase ${entry.phase}`,grade:`Kelas ${[1,3,5,7,10,11][i]}`,academicYear,subject};
    const report=cpSourceRepository.searchSourceChoices(context);
    assert.equal(report.status,'RESOLVED',entry.id+report.reason);assert.equal(report.results.length,1);
    const result=report.results[0];assert.equal(result.id,entry.id);assert.equal(result.verificationStatus,'VERIFIED');
    assert.equal(result.sourceMeta.regulationId,'DEC-BKPDM-020-2026');assert.equal(result.isSelectable,true);
    assert(result.page!.includes(`Hal. ${evidence.sourcePages.pdf[0]}`));
    assert.deepEqual(result.elements.map(e=>e.content),entry.elements.map(e=>e.content));
    assert(getSubjectChoices(context).some(s=>s.code==='PAI'));
    assert.equal(getSubjectCPAvailability(subject,context).status,'RESOLVED');
  }
  const old=resolveCPContext({subjectCode:'PAI',phase:entry.phase,level:entry.level,academicYear:'2025/2026'});
  assert.notEqual(old.status,'AMBIGUOUS');assert.notEqual(old.cp?.regulationSourceId,'DEC-BKPDM-020-2026');
  const context:Partial<ActiveContext>={subject:'PAI',level:entry.level,phase:entry.phase,academicYear:'2026/2027'};
  assert.equal(resolveCPContext({subjectCode:'PAI',phase:entry.phase,level:entry.level,academicYear:'2026/2027',entriesPool:[entry,{...entry,id:'duplicate'}]}).status,'AMBIGUOUS');
  const setting={...context,id:entry.id} as AcademicSetting;
  const selected=cpSourceRepository.search(context)[0];
  const manual={id:'teacher-'+entry.id,academicSettingId:entry.id,generalDescription:'CP manual guru jangan diganti otomatis',elements:[{id:'manual',name:'Manual',content:'Konten CP manual guru'}],source:{title:'Manual',institution:'Guru',retrievedAt:stamp,verificationStatus:'LOCAL_REFERENCE'},updatedAt:stamp} as CPData;
  const before=JSON.stringify(manual);
  assert.deepEqual(apply(selected,setting,manual,false),{saves:[],draft:{}},'Declined replacement must preserve teacher CP');
  const applied=apply(selected,setting,manual,true).saves[0];
  assert.equal(applied.id,manual.id);assert.equal(validateCPDataWorkflow(applied,setting).isSiap,true);
  assert.equal(JSON.stringify(manual),before);
  state.yearPlans.push({id:entry.id,profileId:'p',schoolId:'s',academicYear:'2026/2027',curriculumType:'KURIKULUM_MERDEKA',subject:'PAI',grade:`Kelas ${[1,3,5,7,10,11][i]}`,phase:entry.phase,level:entry.level,createdAt:stamp,updatedAt:stamp});
  state.workspaces.push({id:'w-'+entry.id,yearPlanId:entry.id,profileId:'p',schoolId:'s',name:'Teacher',createdAt:stamp,updatedAt:stamp});
  state.semesterPlans.push(...[1,2].map(semester=>({id:entry.id+'-'+semester,yearPlanId:entry.id,semester:semester as 1|2,createdAt:stamp,updatedAt:stamp})));
  state.annualData.cp.push({yearPlanId:entry.id,value:i===0?manual:applied});
  console.log('PASS',entry.id,'5 exact-content fingerprints; source/year/alias resolution; Step 03 selection and teacher confirmation');
}
saveStorageV5(state);
const saved=JSON.stringify(loadStorageV5());
for(const entry of PAI_2026_CP_ENTRIES) cpSourceRepository.searchSourceChoices({subject:'PAI',level:entry.level,phase:entry.phase,academicYear:'2026/2027'});
assert.equal(JSON.stringify(loadStorageV5()),saved,'Source browsing does not migrate or overwrite persisted projects');
assert.deepEqual(loadStorageV5().annualData.cp,state.annualData.cp,'V5 save/reload retains manual CP and selected canonical CP');
// RESOLVED is independent of verification: unreviewed other-religion text must not be promoted.
const unverified=cpSourceRepository.search({subject:'PAK',phase:'A',level:'SD',academicYear:'2026/2027'})[0];
assert.equal(unverified.verificationStatus,'UNVERIFIED');
console.log('PASS 6 phases / 30 source-content fingerprints; 36 year+alias searches; historical/other-subject hash; ambiguity; actual Step 03 handler; V5 persistence. No Gemini call.');

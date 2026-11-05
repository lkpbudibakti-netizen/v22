import {createReadyV21WorkflowFixture,v21DocumentContext} from './fixtures/v21ReadyWorkflowFixture';
import {getAnnualDataV5} from '../src/services/storageV5';
import {Type} from '@google/genai';
import {checkATPSemanticFidelity,validateATPGeneratedItemsSemanticFidelity} from '../src/services/atpSemanticFidelity';
import {routeCallback} from './helpers/uiContractHarness';
import ts from 'typescript';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveATPItemTPReference,
  validateATPReferences,
  validateATPDataWorkflow,
  normalizeATPReferences,
  resolveATPItemTPReferences,
} from '../src/services/cpWorkflowService';
import { ATPData, ATPItem, TPData, TPItem, AcademicSetting } from '../src/types';

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exit(1);
  }
}

async function main(){
console.log('--- RUNNING MERDEKA ATP ANNUALIZATION INTEGRITY REGRESSION ---\n');

const atpManagerPath = path.resolve(process.cwd(), 'src/components/ATPManager.tsx');
const atpManagerSource = fs.readFileSync(atpManagerPath, 'utf-8').replace(/\r\n/g,'\n');

const serverPath = path.resolve(process.cwd(), 'server.ts');
const serverSource = fs.readFileSync(serverPath, 'utf-8').replace(/\r\n/g,'\n');

const workflowServicePath = path.resolve(process.cwd(), 'src/services/cpWorkflowService.ts');
const workflowServiceSource = fs.readFileSync(workflowServicePath, 'utf-8').replace(/\r\n/g,'\n');

const typesPath = path.resolve(process.cwd(), 'src/types/index.ts');
const typesSource = fs.readFileSync(typesPath, 'utf-8');

const appPath = path.resolve(process.cwd(), 'src/App.tsx');
const appSource = fs.readFileSync(appPath, 'utf-8');

// 1. Annual ATP generation source does not require context.semester
await runTest('1. Annual ATP generation source does not require context.semester', () => {
  assert.ok(
    !atpManagerSource.includes('generateATPWithAI({\n        tps: tp.items,\n        cpGeneral: cp.generalDescription,\n        subject: context.subject,\n        grade: context.grade,\n        phase: context.phase,\n        semester: context.semester,'),
    'generateATPWithAI must not be called with semester: context.semester'
  );
});

// 2. ATPManager AI request does not send semester
await runTest('2. ATPManager AI request does not send semester or totalHoursPerWeek', () => {
  // Check the generateATPWithAI call block in ATPManager
  const genCallMatch = atpManagerSource.match(/const generated = await generateATPWithAI\(\{([\s\S]*?)\}\);/);
  assert.ok(genCallMatch, 'generateATPWithAI call must exist in ATPManager');
  const genCallBody = genCallMatch[1];
  assert.ok(!genCallBody.includes('semester'), 'generateATPWithAI payload must not include semester');
  assert.ok(!genCallBody.includes('totalHoursPerWeek'), 'generateATPWithAI payload must not include totalHoursPerWeek');
});

// 3. Manual new ATP item does not populate semester
await runTest('3. Manual new ATP item does not populate semester in handleOpenAdd', () => {
  const handleAddMatch = atpManagerSource.match(/const handleOpenAdd = \(\) => \{([\s\S]*?)\};/);
  assert.ok(handleAddMatch, 'handleOpenAdd must exist in ATPManager');
  const handleAddBody = handleAddMatch[1];
  assert.ok(!handleAddBody.includes('semester:'), 'handleOpenAdd must not assign semester');
});

// 4. Generated ATP item does not populate semester
await runTest('4. Generated ATP item candidateItem does not assign semester', () => {
  const candidateItemMatch = atpManagerSource.match(/const candidateItem: ATPItem = \{([\s\S]*?)\};/);
  assert.ok(candidateItemMatch, 'candidateItem must exist in handleGenerateAI');
  const candidateBody = candidateItemMatch[1];
  assert.ok(!candidateBody.includes('semester:'), 'candidateItem must not assign semester');
});

// 5. ATP edit UI has no Semester selector for Merdeka annual flow
await runTest('5. ATP edit modal has no Semester selector for Merdeka annual flow', () => {
  assert.ok(
    !atpManagerSource.includes('<label className="block text-xs font-bold text-slate-700 uppercase mb-1">\n                    Semester'),
    'Edit modal must not render a Semester label or selector'
  );
  assert.ok(
    !atpManagerSource.includes('<option value={1}>Semester 1</option>'),
    'Edit modal must not include Semester 1 option'
  );
});

// 6. ATP table does not display Sem 1 / Sem 2
await runTest('6. ATP table does not display Sem 1 / Sem 2 or "Sem / JP" column', () => {
  assert.ok(!atpManagerSource.includes('Sem / JP'), 'Table header must not say "Sem / JP"');
  const ast=ts.createSourceFile('ATPManager.tsx',atpManagerSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const headers:string[]=[];
  function visit(n:ts.Node){if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='th')headers.push(n.children.filter(ts.isJsxText).map(c=>c.text.trim()).join(' '));ts.forEachChild(n,visit);}visit(ast);
  for(const label of ['No / Langkah','Fokus Langkah','TP Tertaut','Aksi'])assert.ok(headers.includes(label),'ATP pedagogical column: '+label);
  assert.ok(!headers.some(h=>/JP|Semester|Sem \//.test(h)),'JP and semester allocation belong to planning after ATP');
  assert.ok(!atpManagerSource.includes('`Sem ${item.semester}`'), 'Table rows must not render `Sem ${item.semester}`');
});

// 7. Page copy does not describe ATP as semester-scoped
await runTest('7. Page copy describes ATP as annual context without semester', () => {
  assert.ok(
    !atpManagerSource.includes('Semester {context.semester}'),
    'Step description must not mention "Semester {context.semester}"'
  );
  assert.ok(
    atpManagerSource.includes('Tahun Ajaran {context.academicYear || \'-\'}'),
    'Step description must reference annual "Tahun Ajaran"'
  );
});

// 8. Total label is annual-neutral, not "Total Alokasi Waktu Semester"
await runTest('8. ATP does not display legacy JP allocation totals', () => {
  assert.ok(!atpManagerSource.includes('Total Alokasi Waktu Semester:'), 'Footer must not say "Total Alokasi Waktu Semester:"');
  assert.ok(!atpManagerSource.includes('Total Alokasi Waktu:'), 'Step 06 must not total legacy ATP JP; actual meeting allocation is planned downstream');
});

// 9. Server /api/ai/generate-atp accepts valid Merdeka annual request without semester
await runTest('9. Real ATP route accepts Merdeka annual context without semester; K13 still requires it',async()=>{
  const callback=routeCallback('server.ts','/api/ai/generate-atp',{resolveApiKey:()=>null});
  const body={tps:[{id:'tp-1',statement:'Memahami bilangan'}],subject:'Matematika',grade:'Kelas 4',phase:'B',academicYear:'2026/2027',curriculum:'Kurikulum Merdeka'};
  for(const [curriculum,semester,status] of [['Kurikulum Merdeka',undefined,503],['Kurikulum 2013',undefined,400],['Kurikulum 2013','1',503]] as const){
    let actual=200,payload:any;const res={status:(code:number)=>{actual=code;return res;},json:(value:unknown)=>{payload=value;return res;}};
    await callback({body:{...body,curriculum,semester}},res);
    assert.equal(actual,status);if(status===503)assert.equal(payload.code,'AI_NOT_CONFIGURED');else assert.match(payload.error,/Semester/);
  }
});

// 10. Server Merdeka prompt does not require semester placement
await runTest('10. Server Merdeka prompt uses annual context without semester', () => {
  assert.ok(
    serverSource.includes('${isK13 ? `- Tahun Ajaran / Semester: ${academicYear || \'-\'} / ${semester || \'-\'}` : `- Tahun Ajaran: ${academicYear || \'-\'}`}'),
    'server.ts prompt must format annual context for Kurikulum Merdeka'
  );
  assert.ok(
    !serverSource.includes('place items into Semester 1 or Semester 2'),
    'server.ts prompt must not ask for semester placement'
  );
});

// 11. Server does not fabricate JP when weekly JP is unresolved
await runTest('11. Real ATP endpoint whitelists pedagogical fields and strips model JP/semester even with known weekly JP',async()=>{
  let providerCalls=0;
  const response={rationale:'Alur fixture',items:[{stepNumber:99,linkedTpIds:['tp-1'],focus:'Memahami bilangan',jp:99,allocatedJP:100,semester:2}]};
  const callback=routeCallback('server.ts','/api/ai/generate-atp',{
    resolveApiKey:()=> 'fixture-key',createAIClient:()=>({}),Type,
    generateContentWithRetry:async()=>{providerCalls++;return {text:JSON.stringify(response)};},
    cleanAndParseJSON:(text:string)=>JSON.parse(text),checkATPSemanticFidelity,validateATPGeneratedItemsSemanticFidelity,
  });
  for(const weekly of [undefined,7]){
    let status=200,payload:any;const res={status:(code:number)=>{status=code;return res;},json:(value:unknown)=>{payload=value;return res;}};
    await callback({body:{tps:[{id:'tp-1',code:'TP 1',statement:'Memahami bilangan',competence:'Memahami',contentScope:'Bilangan'}],subject:'Matematika',grade:'Kelas 4',phase:'B',academicYear:'2026/2027',curriculum:'Kurikulum Merdeka',totalHoursPerWeek:weekly}},res);
    assert.equal(status,200,JSON.stringify(payload));assert.equal(payload.success,true);assert.equal(payload.engine,'gemini');
    assert.deepEqual(payload.data.items,[{stepNumber:1,linkedTpIds:['tp-1'],focus:'Memahami bilangan'}]);
  }
  assert.equal(providerCalls,2);
});

// 12. pedagogicalATPFingerprint does not include ATPItem.semester
await runTest('12. pedagogicalATPFingerprint does not include ATPItem.semester', () => {
  const atpFingerprintMatch = workflowServiceSource.match(/function pedagogicalATPFingerprint\([\s\S]*?return stableStringify\(\{([\s\S]*?)\}\);\n\}/);
  assert.ok(atpFingerprintMatch, 'pedagogicalATPFingerprint must exist');
  const atpFingerprintBody = atpFingerprintMatch[1];
  assert.ok(!atpFingerprintBody.includes('semester:'), 'pedagogicalATPFingerprint must not include semester');
});

// 13. Existing strict TP reference behavior remains intact
await runTest('13. Strict TP reference resolution and validation contracts remain intact', () => {
  const tps: TPItem[] = [
    { id: 'tp-1', code: 'TP 1.1', statement: 'Memahami teks deskripsi', competence: 'Memahami', contentScope: 'Teks deskripsi', order: 1 },
    { id: 'tp-2', code: 'TP 1.2', statement: 'Menulis teks deskripsi', competence: 'Menulis', contentScope: 'Teks deskripsi', order: 2 },
  ];

  // 13.1 Exact ID
  const exactRes = resolveATPItemTPReference({ id: 'atp-1', stepNumber: 1, tpId: 'tp-1', tpCode: '', tpStatement: '', p3Dimensions: [] }, tps);
  assert.strictEqual(exactRes.status, 'RESOLVED_REFERENCE');

  // 13.2 Ambiguous TP
  const dupTPs: TPItem[] = [
    { id: 'tp-1a', code: 'TP 1.1', statement: 'Memahami teks deskripsi A', competence: 'Memahami', contentScope: 'Teks deskripsi A', order: 1 },
    { id: 'tp-1b', code: 'TP 1.1', statement: 'Memahami teks deskripsi B', competence: 'Memahami', contentScope: 'Teks deskripsi B', order: 2 },
  ];
  const ambRes = resolveATPItemTPReference({ id: 'atp-1', stepNumber: 1, tpId: '', tpCode: 'TP 1.1', tpStatement: '', p3Dimensions: [] }, dupTPs);
  assert.strictEqual(ambRes.status, 'AMBIGUOUS_REFERENCE');

  // 13.3 Dangling TP
  const dangRes = resolveATPItemTPReference({ id: 'atp-1', stepNumber: 1, tpId: 'tp-deleted', tpCode: 'TP 9', tpStatement: 'Non-existent', p3Dimensions: [] }, tps);
  assert.strictEqual(dangRes.status, 'DANGLING_REFERENCE');

  // Canonical duplicate-in-step rejection remains strict. A TP can recur in
  // different pedagogical steps, with full coverage checked by workflow tests.
  const duplicated=resolveATPItemTPReferences({id:'duplicate',stepNumber:1,linkedTpIds:['tp-1','tp-1']},tps);
  assert.equal(duplicated.isValid,false);assert(duplicated.issues.some(issue=>/duplikasi/.test(issue)));
  for(const stepNumber of [1,2])assert.equal(resolveATPItemTPReferences({id:'step-'+stepNumber,stepNumber,linkedTpIds:['tp-1']},tps).isValid,true);
});

await runTest('14. Real canonical annual ATP can be SIAP with no JP allocation; TP/CP prerequisites stay strict',()=>{
  const memory=new Map<string,string>();Object.assign(globalThis,{localStorage:{getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
  const state=createReadyV21WorkflowFixture(),ctx=v21DocumentContext(state),annual=getAnnualDataV5('y');
  const atp=structuredClone(annual.atp!);for(const item of atp.items){delete item.jp;delete item.allocatedJP;delete item.semester;}
  const setting={...ctx.academicSetting,id:'y',semester:'' as const};
  const result=validateATPDataWorkflow(atp,annual.tp,setting,annual.cp,annual.cpAnalysis);
  assert.equal(result.isSiap,true,result.issues.join('; '));assert.equal(result.status,'SIAP');assert.equal(result.issues.length,0);
  assert.equal(validateATPDataWorkflow(atp,undefined,setting,annual.cp,annual.cpAnalysis).isSiap,false);
});

// 15. ATPItem.semester remains only as deprecated compatibility field in type definition
await runTest('15. ATPItem.semester remains as optional compatibility field in types', () => {
  assert.ok(
    typesSource.includes('semester?: 1 | 2 | null;'),
    'ATPItem in types/index.ts must retain optional semester field for compatibility'
  );
});

// 16. App.tsx connects handleSaveATP to Storage V5 annual persistence
await runTest('16. App.tsx connects handleSaveATP to Storage V5 annual persistence', () => {
  assert.ok(
    appSource.includes('saveATPV5(activeYearPlan.id, canonicalATP)'),
    'App.tsx handleSaveATP must persist to Storage V5 via saveATPV5'
  );
});

console.log('\nAll 16 Merdeka ATP Annualization Integrity contract tests PASSED successfully!\n');

}
main().catch(error=>{console.error(error);process.exitCode=1;});

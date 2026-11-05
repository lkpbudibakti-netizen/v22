import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as current from '../src/data/curriculum/cp';
import * as subjects from '../src/data/curriculum/subjects';
import { SUBJECT_OPTIONS } from '../src/data/curriculumDefaults';
import { cpSourceRepository } from '../src/services/cpSourceRepository';
import { getRegulationSource } from '../src/data/curriculum/regulations';
import { validateCPDataWorkflow } from '../src/services/cpWorkflowService';
import { createInitialStorageV5, saveStorageV5, loadStorageV5 } from '../src/services/storageV5';

// Execute the actual main modules, rather than a manually maintained expected snapshot.
const base = execFileSync('git', ['rev-parse', process.env.CP_COMPAT_BASE || 'origin/main'], {encoding:'utf8'}).trim();
const gitSource = (file:string) => execFileSync('git', ['show', `${base}:${file}`], {encoding:'utf8', maxBuffer: 8e6});
const cache = new Map<string, any>();
function execute(source:string, requireModule:(name:string)=>any, bindings:Record<string,unknown> = {}) {
  const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true}}).outputText;
  const module = {exports:{} as any};
  new Function('require','module','exports',...Object.keys(bindings),js)(requireModule,module,module.exports,...Object.values(bindings));
  return module.exports;
}
function baseline(file:string):any {
  if(file.endsWith('.json')) return JSON.parse(gitSource(file));
  if(file === 'src/types/index.ts') {
    const source=gitSource(file);
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
    const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='normalizeCPVerificationStatus')!;
    return execute(fn.getText(ast),()=>{throw Error('Unexpected import')});
  }
  if(cache.has(file)) return cache.get(file);
  const value = execute(gitSource(file), name => {
    assert(name.startsWith('.'), `Unexpected baseline dependency: ${name}`);
    const stem = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
    return baseline(stem.endsWith('.json') ? stem : ['src/types','src/data/curriculum/cp'].includes(stem) ? `${stem}/index.ts` : `${stem}.ts`);
  });
  cache.set(file,value); return value;
}
function initializer(source:string, name:string):string {
  const ast = ts.createSourceFile('source.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let result = '';
  function visit(node:ts.Node) {
    if(ts.isVariableDeclaration(node) && node.name.getText(ast)===name) result=node.initializer!.getText(ast);
    ts.forEachChild(node,visit);
  }
  visit(ast); assert(result, name); return result;
}
const old = baseline('src/data/curriculum/cp/index.ts');
const oldSubjects = baseline('src/data/curriculum/subjects.ts');
const oldRepository = baseline('src/services/cpSourceRepository.ts').cpSourceRepository;
assert.deepEqual(current.ALL_MASTER_CP_ENTRIES, old.ALL_MASTER_CP_ENTRIES);
assert.deepEqual(subjects.CURRICULUM_SUBJECTS, oldSubjects.CURRICULUM_SUBJECTS);
const oldOptions = execute(`exports.options = ${initializer(gitSource('src/data/curriculumDefaults.ts'),'SUBJECT_OPTIONS')}`,()=>{throw Error('Unexpected import')}).options;
for(const level of Object.keys(oldOptions)) assert.deepEqual(SUBJECT_OPTIONS[level].slice(0,oldOptions[level].length),oldOptions[level]);
for(const subject of oldSubjects.CURRICULUM_SUBJECTS) {
  for(const name of [subject.code,subject.name,...(subject.aliases||[])]) {
    for(const input of [name,` ${name.toUpperCase()} `,`${name} tambahan`]) {
      assert.deepEqual(subjects.findSubjectByNameOrAlias(input),oldSubjects.findSubjectByNameOrAlias(input),input);
      assert.deepEqual(subjects.findSubjectByCode(input),oldSubjects.findSubjectByCode(input),input);
    }
  }
}
const NativeDate = Date;
globalThis.Date = new Proxy(NativeDate, {construct(target,args) {return Reflect.construct(target,args.length?args:['2026-10-29T00:00:00Z']);}});
try {
  let contexts = 0;
  for(const entry of old.ALL_MASTER_CP_ENTRIES) {
    const subject = oldSubjects.findSubjectByCode(entry.subjectCode);
    for(const name of [entry.subjectCode,subject?.name,...(subject?.aliases||[])].filter(Boolean)) {
      for(const academicYear of ['2024/2025','2025/2026','2026/2027','invalid','']) {
        const context = {subject:name,phase:entry.phase,level:entry.level,academicYear};
        const actual=current.resolveCPContext({...context,subjectInput:name});
        const previous=old.resolveCPContext({...context,subjectInput:name});
        if(entry.id==='cp-sd-fase-b-coding-ai') {
          assert.equal(actual.status,'UNRESOLVED');
          assert.equal(cpSourceRepository.searchWithDiagnostics(context).status,'UNRESOLVED');
        } else {
          assert.deepEqual(actual,previous);
          const expected=oldRepository.searchWithDiagnostics(context);
          // Only the proven title, issuer and official document URL for 020/2026
          // change. Historical CP wording/status/identity remains byte-equivalent.
          for(const result of expected.results)if(result.sourceMeta.regulationId==='DEC-BKPDM-020-2026') {
            const regulation=getRegulationSource('DEC-BKPDM-020-2026')!;
            result.title=regulation.title;result.institution=regulation.authority;result.url=regulation.sourceUrl;
            result.sourceMeta.title=regulation.title;result.sourceMeta.institution=regulation.authority;result.sourceMeta.url=regulation.sourceUrl;
          }
          assert.deepEqual(cpSourceRepository.searchWithDiagnostics(context),expected);
        }
        contexts++;
      }
    }
  }
  console.log(`PASS: baseline ${base}: historical registry/subjects/options and ${contexts} contexts; only audited Coding B exclusion and proven 020 metadata differ.`);

  const mainManager = gitSource('src/components/CPManager.tsx');
  const manager = readFileSync('src/components/CPManager.tsx','utf8');
  const context = {subject:'MAT',level:'SMP',phase:'D',academicYear:'2025/2026'};
  const academicSetting = {...context,id:'year'};
  const historical = cpSourceRepository.search(context)[0];
  const reviewed = cpSourceRepository.searchWithDiagnostics(context,{sourceSet:'review046'}).results[0];
  assert(reviewed?.isSelectable);
  const cp = {id:'teacher-cp',cpId:'original-source',cpVersion:'original-version',regulationIds:['teacher-regulation'],academicSettingId:'year',generalDescription:'Teacher text',elements:[],updatedAt:'original'};
  function apply(source:string,item:any,description:string,approved:boolean) {
    const calls:any[] = []; const draft:Record<string,unknown> = {};
    const bindings:any = {cp,academicSetting,generalDescription:description,sourceSearch:{status:'RESOLVED'},validateCPDataWorkflow,
      confirm:(message:string)=>{calls.push(['confirm',message]);return approved;},
      onSaveCP:(value:any)=>calls.push(['save',value])};
    for(const name of ['GeneralDescription','Elements','Source','IsSourceModalOpen','PendingReviewedSource']) bindings[`set${name}`]=(value:unknown)=>{draft[name]=value;};
    execute(`exports.run = ${initializer(source,'handleApplySelectedSource')}`,()=>{throw Error('Unexpected import')},bindings).run(item);
    return {calls,draft};
  }
  for(const description of ['Teacher text','']) for(const approved of [true,false]) {
    const before=apply(mainManager,historical,description,approved), after=apply(manager,historical,description,approved);
    assert.deepEqual(after.calls,before.calls,'Legacy confirmation, saved identity and metadata must match main');
    assert.deepEqual(after.draft,before.draft);
  }
  const state = createInitialStorageV5();
  const stamp='2026-10-29T00:00:00Z';
  state.schools=[{id:'s',name:'School',npsn:'',address:'',village:'',district:'',regency:'',province:'',principalName:'',principalNip:'',createdAt:stamp,updatedAt:stamp}];
  state.profiles=[{id:'p',name:'Teacher',nip:'',status:'PNS',defaultSubject:'MAT',defaultLevel:'SMP',schoolId:'s',createdAt:stamp,updatedAt:stamp}];
  state.yearPlans=[{id:'year',profileId:'p',schoolId:'s',academicYear:'2025/2026',curriculumType:'KURIKULUM_MERDEKA',subject:'MAT',grade:'Kelas 7',phase:'D',level:'SMP',createdAt:stamp,updatedAt:stamp}];
  state.workspaces=[{id:'w',yearPlanId:'year',profileId:'p',schoolId:'s',name:'Teacher workspace',createdAt:stamp,updatedAt:stamp}];
  state.semesterPlans=[1,2].map(semester=>({id:`sp${semester}`,yearPlanId:'year',semester:semester as 1|2,createdAt:stamp,updatedAt:stamp}));
  // Opaque existing annual content must survive source browsing/selection byte for byte.
  state.annualData.cp=[{yearPlanId:'year',value:cp as any}];
  state.annualData.tp=[{yearPlanId:'year',value:{id:'teacher-tp',items:[{id:'tp1',text:'Teacher TP'}]} as any}];
  state.annualData.atp=[{yearPlanId:'year',value:{id:'teacher-atp',items:[{id:'atp1',tpId:'tp1'}]} as any}];
  const data = new Map<string,string>(); let writes=0;
  const originalStorage=globalThis.localStorage;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{writes++;data.set(k,v);}}});
  try {
    saveStorageV5(state);
    const raw=JSON.stringify([...data]), loaded=loadStorageV5(); writes=0;
    for(const entry of current.REVIEW_CP046_ENTRIES) {
      const report=cpSourceRepository.searchSourceChoices({subject:entry.subjectCode,phase:entry.phase,level:entry.level,academicYear:'2025/2026'});
      const choice=report.results.find(result=>result.id===entry.id);
      assert(choice?.isSelectable,entry.id);
      let automaticallySelected:unknown='not-called';
      execute(`exports.run = ${initializer(manager,'handleOpenSourceSearch')}`,()=>{throw Error('Unexpected import')},{
        cpSourceRepository:{searchSourceChoices:()=>report},context,academicSetting,
        setSourceSearch:()=>{},setSelectedResult:(value:unknown)=>{automaticallySelected=value;},setIsSourceModalOpen:()=>{},
      }).run();
      assert.equal(automaticallySelected,null,'REVIEW must require an explicit source choice');
      const result=apply(manager,choice,'Teacher text',true);
      assert.equal(result.calls.filter(call=>call[0]==='save').length,0);
      assert.equal(result.draft.PendingReviewedSource,true);
      assert.deepEqual(result.draft.Source,choice.sourceMeta);
    }
    assert.deepEqual(apply(manager,reviewed,'Teacher text',false).draft,{});
    assert.equal(writes,0);
    assert.equal(JSON.stringify([...data]),raw);
    assert.deepEqual(loadStorageV5(),loaded);
  } finally {Object.defineProperty(globalThis,'localStorage',{configurable:true,value:originalStorage});}
  console.log('PASS: main/current legacy confirmation and CP identity match; all 84 explicit choices only stage drafts, persisted CP/TP/ATP remain identical.');
} finally {globalThis.Date=NativeDate;}

// The consumers/persistence pipeline must not have changed as part of adding sources.
for(const file of ['src/App.tsx','src/services/storageV5.ts','src/services/cpWorkflowService.ts','src/services/administrationProjectImportService.ts','src/services/completeProjectZipService.ts']) {
  assert.equal(readFileSync(file,'utf8').replace(/\r\n/g,'\n'),gitSource(file).replace(/\r\n/g,'\n'),file);
}
console.log('PASS: main consumers, workflow, storage and COPY/ZIP implementations unchanged.');

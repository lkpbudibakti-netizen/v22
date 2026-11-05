import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Execute the real App callback; formatting and explicit return annotations are irrelevant. */
export function assertAppCPAnalysisSaveContract() {
  const source=readFileSync('src/App.tsx','utf8');
  const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let initializer='';
  function visit(node:ts.Node) {
    if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleSaveCPAnalysis') initializer=node.initializer!.getText(ast);
    ts.forEachChild(node,visit);
  }
  visit(ast);assert(initializer,'App must define handleSaveCPAnalysis');
  const compiled=ts.transpileModule(`return (${initializer});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const cp={id:'persisted-cp',updatedAt:'2026-11-01T00:00:00Z'};
  const input={id:'',academicSettingId:'untrusted-year',cpId:'untrusted-cp',items:[],updatedAt:cp.updatedAt};
  const before=JSON.stringify(input);
  for(const missing of ['year','cp','none','error'] as const) {
    const writes:Array<{year:string;value:any}>=[],notices:any[]=[];let refreshed=0;
    const save=(year:string,value:any)=>{if(missing==='error')throw Error('fixture save failure');writes.push({year,value});};
    const callback=new Function('runtimeContext','activeYearPlan','saveCPAnalysisV5','refreshV5','setAppNotice','loadStorageV5',compiled)(
      {annualData:{cp:missing==='cp'?undefined:cp}},missing==='year'?undefined:{id:'active-year'},save,()=>refreshed++,(notice:any)=>notices.push(notice),()=>({annualData:{cpAnalysis:writes.map(write=>({yearPlanId:write.year,value:write.value})).slice(-1)}}));
    const result=callback(input);
    assert.equal(result,missing==='none','boolean save outcome: '+missing);
    assert.equal(refreshed,missing==='none'?1:0);assert.equal(writes.length,missing==='none'?1:0);
    if(missing==='none') {
      assert.deepEqual(writes[0],{year:'active-year',value:{...input,id:'cpanalysis-active-year',academicSettingId:'active-year',cpId:cp.id,basedOnCpUpdatedAt:cp.updatedAt}});
      const explicit={...input,id:'teacher-analysis',basedOnCpUpdatedAt:'2026-10-31T00:00:00Z'};
      assert.equal(callback(explicit),true);
      assert.equal(writes[1].value.id,explicit.id);assert.equal(writes[1].value.basedOnCpUpdatedAt,explicit.basedOnCpUpdatedAt);
    } else {assert.equal(notices.length,1);assert.equal(notices[0].type,'error');}
    assert.equal(JSON.stringify(input),before,'App callback must not mutate the editor input');
  }
}

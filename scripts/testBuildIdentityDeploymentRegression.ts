import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { DEPLOYMENT_SHA_ENV_KEYS, resolveBuildIdentity, type BuildIdentity } from './buildIdentity';
import { createRuntimeUpdateMonitor } from '../src/services/runtimeUpdateService';

const cwd=process.cwd();
const env={...process.env};
for(const key of DEPLOYMENT_SHA_ENV_KEYS) delete env[key];
for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR']) delete env[key];
const git=(args:string[])=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const sha=git(['rev-parse','HEAD']);
const deploymentSha=git(['rev-parse','HEAD^']);
assert.notEqual(sha,deploymentSha);
const normal=resolveBuildIdentity(cwd,env);
assert.equal(normal.buildSha,sha);
assert.equal(normal.buildDirty,Boolean(git(['status','--porcelain'])));
assert(normal.buildId);
assert.equal(resolveBuildIdentity(cwd,{...env,GITHUB_SHA:deploymentSha}).buildSha,deploymentSha,'CI takes priority over Git');

const tempParent=realpathSync(tmpdir());
const archive=mkdtempSync(path.join(tempParent,'alco-build-identity-'));
try {
  assert.throws(()=>execFileSync('git',['rev-parse','HEAD'],{cwd:archive,env,stdio:'ignore'}));
  const noMetadata=resolveBuildIdentity(archive,env);
  assert.equal(noMetadata.buildSha,null);assert.equal(noMetadata.buildDirty,null);assert(noMetadata.buildId);
  const ciArchive=resolveBuildIdentity(archive,{...env,VERCEL_GIT_COMMIT_SHA:deploymentSha});
  assert.equal(ciArchive.buildSha,deploymentSha);assert.equal(ciArchive.buildDirty,null);
  const unavailableGit={...env};
  for(const key of Object.keys(unavailableGit)) if(key.toUpperCase()==='PATH') delete unavailableGit[key];
  unavailableGit.PATH='';
  assert.throws(()=>execFileSync('git',['--version'],{cwd:archive,env:unavailableGit,stdio:'ignore'}));
  const noGit=resolveBuildIdentity(archive,unavailableGit);
  assert.equal(noGit.buildSha,null);assert.equal(noGit.buildDirty,null);assert(noGit.buildId);
  const ciNoGit=resolveBuildIdentity(archive,{...unavailableGit,CI_COMMIT_SHA:deploymentSha});
  assert.equal(ciNoGit.buildSha,deploymentSha);assert.equal(ciNoGit.buildDirty,null);
  const invalidSha=resolveBuildIdentity(archive,{...unavailableGit,BUILD_SHA:'not-a-sha'});
  assert.equal(invalidSha.buildSha,null);assert(invalidSha.buildId);
  const ids=Array.from({length:20},()=>resolveBuildIdentity(archive,unavailableGit).buildId);
  assert.equal(new Set(ids).size,ids.length,'Every evaluation has a unique identity even without Git/SHA');

  // Evaluate the actual config and emission hooks without running a Vite build.
  const configSource=readFileSync('vite.config.ts','utf8');
  const compiled=ts.transpileModule(configSource.slice(configSource.indexOf('export default defineConfig')),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  for(const buildEnv of [env,unavailableGit,{...unavailableGit,GITHUB_SHA:deploymentSha}]) {
    let resolutions=0;let identity:BuildIdentity;const configExports:any={};let pwa:any;
    runInNewContext(compiled,{exports:configExports,__dirname:archive,
      defineConfig:(factory:any)=>factory(),resolveBuildIdentity:(directory:string)=>{resolutions++;identity=resolveBuildIdentity(directory,buildEnv);return identity;},
      react:()=>({}),tailwindcss:()=>({}),VitePWA:(options:any)=>{pwa=options;return {};},path:{resolve:()=>archive},process:{env:{}},
    });
    const config=configExports.default;assert.equal(resolutions,1);
    const plugin=config.plugins.find((p:any)=>p.name==='runtime-build-identity');
    let asset:any;plugin.generateBundle.call({emitFile:(value:any)=>{asset=value;}});
    const metadata=JSON.parse(asset.source);
    assert.equal(asset.fileName,'build-info.json');
    assert.equal(metadata.buildId,JSON.parse(config.define.__APP_BUILD_ID__));
    assert.equal(metadata.buildSha,JSON.parse(config.define.__APP_BUILD_SHA__));
    assert.equal(metadata.buildDirty,JSON.parse(config.define.__APP_BUILD_DIRTY__));
    assert.deepEqual(metadata,identity!);
    let handler:any;plugin.configureServer({middlewares:{use:(_url:any,callback:any)=>handler=callback}});
    const headers:any={};let body='';handler({}, {setHeader:(key:string,value:string)=>headers[key]=value,end:(value:string)=>body=value});
    assert.equal(headers['Cache-Control'],'no-store');assert.equal(JSON.parse(body).buildId,metadata.buildId);
    assert.equal(resolutions,1,'Emission and HTTP metadata reuse the same evaluation');
    const runtime:any={};
    runInNewContext(ts.transpileModule(readFileSync('src/config/buildInfo.ts','utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText,{exports:runtime,__APP_BUILD_ID__:metadata.buildId,__APP_BUILD_SHA__:metadata.buildSha,__APP_BUILD_DIRTY__:metadata.buildDirty});
    assert.equal(runtime.APP_BUILD_ID,metadata.buildId);assert.equal(runtime.APP_BUILD_SHA,metadata.buildSha);assert.equal(runtime.APP_BUILD_DIRTY,metadata.buildDirty);
    assert.equal(pwa.registerType,'prompt');assert.equal(pwa.injectRegister,false);assert.equal(pwa.workbox.skipWaiting,false);
    assert(pwa.workbox.globIgnores.includes('**/build-info.json'));
  }
  let state:any,reloads=0,busy=false,messages=0;
  const monitor=createRuntimeUpdateMonitor({runtimeBuildId:noGit.buildId,notify:next=>state=next,reload:()=>reloads++,isBusy:()=>busy});
  monitor.compare({buildId:ciNoGit.buildId,buildSha:null});assert.equal(state.newerBuildId,ciNoGit.buildId);assert.equal(reloads,0);
  monitor.compare({buildId:noGit.buildId,buildSha:deploymentSha});assert.equal(state.newerBuildId,undefined,'SHA differences do not define versions');
  monitor.compare({buildId:invalidSha.buildId});assert.equal(state.newerBuildId,invalidSha.buildId,'SHA may be absent');
  monitor.compare({buildId:ciNoGit.buildId,buildSha:'diagnostic-only'});assert.equal(state.newerBuildId,ciNoGit.buildId);
  const unchanged=state;monitor.compare({buildId:' ',buildSha:sha});assert.equal(state,unchanged);
  monitor.waiting();busy=true;await monitor.apply(async()=>{messages++;},true);assert.equal(messages,0);assert.equal(reloads,0);
  busy=false;await monitor.apply(async()=>{messages++;},true);assert.equal(messages,1);assert.equal(reloads,0);
  monitor.controllerChanged();monitor.controllerChanged();assert.equal(reloads,1);
  // A valid buildId without SHA must not show the "runtime identity unavailable" notice.
  const noticeSource=readFileSync('src/components/PwaUpdateNotice.tsx','utf8');
  const noticeCode=noticeSource.slice(noticeSource.indexOf('export function PwaUpdateNotice()'))
    .replaceAll('import.meta.env.PROD','true').replaceAll('import.meta.env.BASE_URL',"'/'");
  const notice:any={};runInNewContext(ts.transpileModule(noticeCode,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{
    exports:notice,APP_BUILD_ID:noGit.buildId,APP_BUILD_SHA:null,
    useState:(initial:any)=>[initial,()=>{}],useRef:(initial:any)=>({current:initial}),useEffect:()=>{},
    React:{createElement:()=>{throw new Error('A valid buildId needs no missing-SHA warning');}},
  });
  assert.equal(notice.PwaUpdateNotice(),null);
  console.log('PASS: Git checkout, no .git, missing Git binary, CI SHA precedence, no-SHA config evaluation, unique build IDs, runtime/manifest parity, no-store and buildId-only PWA update with safe reload.');
} finally {
  // Only remove this test-created, verified temporary directory.
  const resolved=realpathSync(archive);
  assert.equal(path.dirname(resolved),tempParent);
  assert(path.basename(resolved).startsWith('alco-build-identity-'));
  rmSync(resolved,{recursive:true,force:true});
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createRuntimeUpdateMonitor } from '../src/services/runtimeUpdateService';

const source = readFileSync('src/components/PwaUpdateNotice.tsx','utf8');
assert(!source.includes('onNeedReload'));
assert(!source.includes('virtual:pwa-register'), 'No helper-owned implicit reload handler');
assert(source.includes("addEventListener('controllerchange'"));
const componentCode = source.slice(source.indexOf('export function PwaUpdateNotice()'))
  .replaceAll('import.meta.env.PROD','true').replaceAll('import.meta.env.BASE_URL',"'/'");
const compiled = ts.transpileModule(componentCode,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function events() {
  const handlers = new Map<string,Set<Function>>();
  return {
    addEventListener:(type:string,fn:Function)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type)!.add(fn);},
    removeEventListener:(type:string,fn:Function)=>{handlers.get(type)?.delete(fn);},
    emit:(type:string)=>{for(const fn of handlers.get(type)||[])fn();},
    count:()=>[...handlers.values()].reduce((sum,group)=>sum+group.size,0),
  };
}
const flush = () => new Promise<void>(resolve=>setImmediate(resolve));
async function mount(controlled=true,waiting=true) {
  let busy=false,reloads=0,messages=0,registerCalls=0,state:any;
  const worker={...events(),state:'installed',postMessage:(message:any)=>{assert.equal(message.type,'SKIP_WAITING');messages++;}};
  const registration={...events(),installing:null as any,waiting:waiting?worker:null,update:async()=>{}};
  const sw={...events(),controller:controlled?{}:null as any,register:async(url:string,options:any)=>{
    registerCalls++;assert.equal(url,'/sw.js');assert.equal(options.scope,'/');assert.equal(options.updateViaCache,'none');return registration;
  }};
  const doc={...events(),visibilityState:'visible',querySelector:()=>busy?{}:null};
  const win={...events(),location:{reload:()=>reloads++},setInterval:()=>1,clearInterval:()=>{}};
  const effects:Array<()=>()=>void>=[],refs:any[]=[],exports:any={};
  runInNewContext(compiled,{
    exports,APP_BUILD_ID:'current-build',APP_BUILD_SHA:'a'.repeat(40),createRuntimeUpdateMonitor,
    React:{createElement:()=>null},useState:(initial:any)=>{state=initial;return[initial,(next:any)=>{state=next;}];},
    useRef:(initial:any)=>{const ref={current:initial};refs.push(ref);return ref;},useEffect:(effect:any)=>effects.push(effect),
    navigator:{serviceWorker:sw},document:doc,window:win,
    fetch:async()=>({ok:true,json:async()=>({buildId:'current-build',buildSha:'a'.repeat(40)})}),
  });
  exports.PwaUpdateNotice();const cleanup=effects[0]();await flush();
  assert.equal(registerCalls,1);
  return {sw,doc,win,worker,registration,cleanup,apply:()=>refs[0].current(),setBusy:(value:boolean)=>{busy=value;},
    get state(){return state;},get reloads(){return reloads;},get messages(){return messages;}};
}
const regular=await mount();
assert(regular.state.waiting);assert.equal(regular.reloads,0);
regular.setBusy(true);await regular.apply();assert.equal(regular.messages,0);assert.equal(regular.reloads,0);
regular.setBusy(false);await regular.apply();assert.equal(regular.messages,1);assert.equal(regular.reloads,0);
regular.registration.waiting=null;regular.sw.emit('controllerchange');assert.equal(regular.reloads,1);
regular.sw.emit('controllerchange');assert.equal(regular.reloads,1);
regular.cleanup();assert.equal(regular.sw.count(),0);assert.equal(regular.doc.count(),0);assert.equal(regular.win.count(),0);assert.equal(regular.registration.count(),0);
const external=await mount();
external.registration.waiting=null;external.sw.emit('controllerchange');assert.equal(external.reloads,0);assert(external.state.needsReload);
external.setBusy(true);await external.apply();assert.equal(external.reloads,0);
external.setBusy(false);await external.apply();assert.equal(external.reloads,1);external.cleanup();
const becomesBusy=await mount();
await becomesBusy.apply();becomesBusy.setBusy(true);becomesBusy.registration.waiting=null;
becomesBusy.sw.emit('controllerchange');assert.equal(becomesBusy.reloads,0);assert(becomesBusy.state.needsReload);
becomesBusy.setBusy(false);await becomesBusy.apply();assert.equal(becomesBusy.reloads,1);becomesBusy.cleanup();
const firstInstall=await mount(false,false);
firstInstall.sw.controller={};firstInstall.sw.emit('controllerchange');assert.equal(firstInstall.reloads,0);assert(!firstInstall.state.needsReload);
firstInstall.registration.installing=firstInstall.worker;firstInstall.worker.state='installing';firstInstall.registration.emit('updatefound');
firstInstall.registration.waiting=firstInstall.worker;firstInstall.worker.state='installed';firstInstall.worker.emit('statechange');assert(firstInstall.state.waiting);
firstInstall.cleanup();assert.equal(firstInstall.worker.count(),0);
console.log('PASS: native service-worker registration/controllerchange, no non-standard callbacks or hidden reload handlers, consent, busy-safe activation, reload once, first install and cleanup.');

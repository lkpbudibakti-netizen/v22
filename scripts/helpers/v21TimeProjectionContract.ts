import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createReadyV21WorkflowFixture, v21DocumentContext } from '../fixtures/v21ReadyWorkflowFixture';
import { buildPromesProjection } from '../../src/services/documentEngine/promesProjection';
import { buildProtaProjection } from '../../src/services/documentEngine/protaProjection';
import { generateDocument, validateDocumentRequirements } from '../../src/services/documentEngine';
import { generatePdfDocument } from '../../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { loadStorageV5 } from '../../src/services/storageV5';
import type { DocumentGenerationContext } from '../../src/services/documentEngine/types';

export async function assertV21TimeProjectionContract(type:'PROTA'|'PROMES'|'ALOKASI_WAKTU') {
  const memory=new Map<string,string>();Object.assign(globalThis,{localStorage:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
  const make=(semester:1|2=1)=>v21DocumentContext(createReadyV21WorkflowFixture(),semester);
  const project=(c:DocumentGenerationContext)=>type==='PROTA'?buildProtaProjection(c):buildPromesProjection(c);
  let count=0;async function test(name:string,fn:()=>unknown){await fn();console.log('PASS '+type+': '+name);count++;}
  const base=make(),initial=project(base);
  await test('canonical Unit → Meeting → actual schedule is ready, with exact JP and unit identities',()=>{
    assert(initial.isReady,initial.unreadyReason);assert.equal(initial.totalAllocatedJP,type==='PROTA'?6:3);
    assert.deepEqual(initial.rows.map(r=>r.unitId),type==='PROTA'?['u','u-s2']:['u']);
    assert(initial.rows.every(r=>r.sourceType==='UNIT'&&r.allocatedJP===3));
  });
  await test('active-semester filtering / annual independence',()=>{
    const second=make(2),p2=project(second);assert(p2.isReady,p2.unreadyReason);
    if(type==='PROTA')assert.deepEqual(p2,initial);else {assert.deepEqual(p2.rows.map(r=>r.unitId),['u-s2']);assert.equal(p2.totalAllocatedJP,3);}
  });
  await test('legacy ATP.jp/semester and TimeAllocation do not override canonical meetings or fabricate 4 JP',()=>{
    const changed=structuredClone(base);changed.atp!.items.forEach(item=>{item.jp=999;item.semester=2;});
    changed.timeAllocations=[{id:'fake',academicSettingId:'foreign',sourceType:'ATP_ITEM',sourceId:'a',allocatedJP:99,jp:999}];
    assert.deepEqual(project(changed),initial);
    changed.learningMeetingSchedules=[];assert.equal(project(changed).isReady,false);assert.equal(project(changed).rows.length,0);
  });
  await test('assessment/reserve legacy allocations cannot inflate actual meeting totals',()=>{
    const c=structuredClone(base);c.timeAllocations=[{id:'asm',academicSettingId:'sp1',sourceType:'ASSESSMENT',allocatedJP:99,jp:99},{id:'reserve',academicSettingId:'sp1',sourceType:'RESERVE',allocatedJP:99,jp:99}];
    assert.equal(project(c).totalAllocatedJP,initial.totalAllocatedJP);
  });
  for(const dependency of ['atpUnitMapping','unitExecutionPlan','learningMeetingSchedules'] as const)await test('missing '+dependency+' fails closed in preview, requirements, DOCX and PDF',async()=>{
    const c=structuredClone(base);delete c[dependency];assert.equal(project(c).isReady,false);
    assert.equal(validateDocumentRequirements(type,c).isValid,false);
    await assert.rejects(()=>generateDocument(type,c));
    await assert.rejects(()=>generatePdfDocument(type,c));
  });
  await test('dangling meeting/unit lineage fails closed instead of using cached TP/ATP text',()=>{
    const c=structuredClone(base);c.learningMeetingSchedules![0].schedule.entries[0].meetingId='missing';assert.equal(project(c).isReady,false);
  });
  await test('duplicate actual meeting is rejected rather than counted twice',()=>{
    const c=structuredClone(base),s=c.learningMeetingSchedules![0].schedule;s.entries.push({...s.entries[0]});assert.equal(project(c).isReady,false);
  });
  await test('legacy assessment/ATP fields cannot mutate stored annual or sibling-semester data',()=>{
    const state=createReadyV21WorkflowFixture(),stable=v21DocumentContext(state),sibling=v21DocumentContext(state,2);
    const snapshot=JSON.stringify(loadStorageV5()),inputSnapshot=JSON.stringify([stable,sibling]);
    project(stable);project(sibling);
    assert.equal(JSON.stringify(loadStorageV5()),snapshot);
    assert.equal(JSON.stringify([stable,sibling]),inputSnapshot);
  });
  if(type==='PROTA') {
    await test('S1 and S2 required; missing either schedule is incomplete',()=>{
      for(const semester of [1,2]){const c=structuredClone(base);c.learningMeetingSchedules=c.learningMeetingSchedules!.filter(s=>s.semester!==semester);assert.equal(project(c).isReady,false);}
    });
    await test('official annual JP is independently resolved; stored old reference is preserved transparently',()=>{
      const p=buildProtaProjection(base);assert.equal(p.officialAnnualJP,108);assert.equal(p.storedReferenceJP,144);assert.equal(p.totalAllocatedJP,6);
    });
    for(const [capacity,status] of [[3,'BALANCED'],[4,'UNDER_ALLOCATED'],[2,'OVER_ALLOCATED']] as const)await test('actual annual capacity '+status,()=>{
      const c=structuredClone(base);c.protaSemesterAllocations!.forEach(s=>s.capacityJP=capacity);assert.equal(buildProtaProjection(c).validationStatus,status);
    });
    await test('unverified capacity is explicit, never fabricated from official reference',()=>{
      const c=structuredClone(base);delete c.protaSemesterAllocations;const p=buildProtaProjection(c);assert(p.isReady);assert.equal(p.validationStatus,'UNVERIFIED_CAPACITY');assert.equal(p.availableAnnualJP,null);
    });
  } else {
    await test('one week crossing August/September uses actual meeting dates and preserves exact month/week JP',()=>{
      const c=v21DocumentContext(createReadyV21WorkflowFixture([3,2],['2026-08-31','2027-01-04']));
      const p=buildPromesProjection(c);assert(p.isReady,p.unreadyReason);assert.equal(p.totalAllocatedJP,5);
      assert.equal(p.rows.length,1);assert.deepEqual(Object.values(p.rows[0].monthlyJP).filter(Boolean).sort(),[2,3]);
      assert.equal(Object.values(p.rows[0].weekAllocations).reduce((a,b)=>a+b,0),5);
    });
    await test('month/week totals are rounding-safe and remain semester-specific',()=>{
      const p=buildPromesProjection(base);for(const r of p.rows){assert.equal(Object.values(r.monthlyJP).reduce((a,b)=>a+b,0),r.allocatedJP);assert.equal(Object.values(r.weekAllocations).reduce((a,b)=>a+b,0),r.allocatedJP);}assert.equal(p.availableJP,3);assert.equal(p.validationStatus,'BALANCED');
    });
    for(const broken of (type==='PROMES'?['calendar','jp','wrong-jp-scope']:[]) as Array<'calendar'|'jp'|'wrong-jp-scope'>)await test(broken+' cannot silently use weekly JP or an unconfirmed calendar',async()=>{
      const c=structuredClone(base);if(broken==='calendar')c.calendar!.workflowStatus='UNRESOLVED';else if(broken==='jp'){delete c.semesterJPSetting;delete c.annualJPReference;}else {c.semesterJPSetting!.semesterPlanId='foreign';}
      assert.equal(project(c).isReady,false);await assert.rejects(()=>generateDocument(type,c));await assert.rejects(()=>generatePdfDocument(type,c));
    });
  }
  await test('actual DOCX and PDF exporters consume the valid canonical projection',async()=>{
    const c=make(),doc=await generateDocument(type,c);assert(doc.success);assert(doc.blob);
    const xml=await (await JSZip.loadAsync(await doc.blob.arrayBuffer())).file('word/document.xml')!.async('string');assert(xml.includes('Bermain bola'));
    const pdf=await generatePdfDocument(type,c);assert(pdf.blob.size>0);
  });
  await test('blank-mode templates remain available without canonical schedule prerequisites',async()=>{
    const c=make();c.documentMode='blank';delete c.atpUnitMapping;delete c.unitExecutionPlan;delete c.learningMeetingSchedules;delete c.calendar;delete c.semesterJPSetting;
    assert(project(c).isReady);assert.equal(project(c).rows.length,0);assert((await generateDocument(type,c)).success);assert((await generatePdfDocument(type,c)).blob.size>0);
  });
  console.log(`PASS ${type}: ${count} current-contract cases, including rejection paths and both exporters.`);
}

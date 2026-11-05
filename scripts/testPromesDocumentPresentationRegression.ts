import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {readFileSync} from 'node:fs';
import {buildPromesProjection} from '../src/services/documentEngine/promesProjection';
import {buildPromesPresentation} from '../src/services/documentEngine/promesPresentation';
import {generatePROMES} from '../src/services/documentEngine/generators/promesGenerator';
import {generatePdfDocument} from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
const stamp = '2026-10-17T00:00:00Z';
const tpIds = ['t1', 't2'];
const atpIds = ['a1', 'a2'];
const setting: any = { id: 'sem', curriculumType: 'KURIKULUM_MERDEKA', curriculum: 'Kurikulum Merdeka', semester: '1', subject: 'PJOK', grade: '7' };
const tp: any = { id: 'tp', academicSettingId: 'sem', workflowStatus: 'SIAP', updatedAt: stamp,
  items: tpIds.map((id,i) => ({ id, code: id, statement: 'Kompetensi '+id, order:i+1 })) };
const atp: any = { id: 'atp', academicSettingId: 'sem', workflowStatus: 'SIAP', updatedAt: stamp, basedOnTpUpdatedAt: stamp,
  items: atpIds.map((id,i) => ({ id, tpId: tpIds[i], linkedTpIds:[tpIds[i]], stepNumber:i+1, semester:1, jp:3 })) };
const mapping: any = { id: 'mapping', academicSettingId:'sem', updatedAt:stamp, units:[{
  id:'unit', title:'Unit', order:1, linkedTpIds:tpIds, linkedAtpItemIds:atpIds,
  materials:tpIds.map((id,i)=>({ id:'mat'+i, title:'Materi '+id, order:i+1, linkedTpIds:[id], linkedAtpItemIds:[atpIds[i]] }))
}] };
const meetings = [3,1,2].map(order => ({ id:'m'+order, title:'Judul '+order, unitId:'unit', order, jp:2,
  linkedTpIds:[tpIds[order===2?1:0]], linkedAtpItemIds:[atpIds[order===2?1:0]], materialIds:['mat'+(order===2?1:0)] }));
const execution: any = { id:'execution', academicSettingId:'sem', mappingId:'mapping', basedOnMappingUpdatedAt:stamp, units:[{unitId:'unit', meetings}] };
const schedules: any = [{ semesterPlanId:'sem', semester:1, schedule:{ semesterPlanId:'sem', status:'COMPLETE', entries:meetings.map(m=>({ meetingId:m.id, semesterPlanId:'sem', unitId:'unit', date:'2026-10-'+(18+m.order), jp:2, mode:'MANUAL', dayOfWeek:1, weekIndex:m.order })) } }];

// A second unit is allocated only in semester 2; an unallocated unit must never gain JP.
mapping.units.push({...structuredClone(mapping.units[0]),id:'unit2',title:'Bab Semester Genap',order:2});
mapping.units.push({...structuredClone(mapping.units[0]),id:'unallocated',title:'BAB TANPA JADWAL',order:3});
execution.units.push({unitId:'unit2',meetings:meetings.map(m=>({...m,id:'s2'+m.id,unitId:'unit2',jp:3}))});
execution.units.push({unitId:'unallocated',meetings:meetings.map(m=>({...m,id:'u'+m.id,unitId:'unallocated'}))});
schedules.push({semesterPlanId:'sem2',semester:2,schedule:{semesterPlanId:'sem2',status:'COMPLETE',entries:execution.units[1].meetings.map((m:any)=>({meetingId:m.id,semesterPlanId:'sem2',unitId:'unit2',date:'2027-01-18',jp:3,mode:'MANUAL',dayOfWeek:1,weekIndex:m.order}))}});
const base:any={school:{id:'school',name:'Sekolah PROMES',principalName:'Kepala Sekolah',district:'Kota'},profile:{id:'guru',name:'Guru PROMES'},tp,atp,atpUnitMapping:mapping,unitExecutionPlan:execution,learningMeetingSchedules:schedules,skipDownload:true,documentMode:'data',documentDate:'2026-10-18'};
function makeContext(semester:number){
 const id=semester===1?'sem':'sem2';const year=semester===1?2026:2027;const month=semester===1?'10':'01';
 const calendar={id:'cal'+semester,academicSettingId:id,startDate:year+'-'+month+'-01',endDate:year+'-'+month+'-31',schoolDaysPerWeek:5,workflowStatus:'CONFIRMED'};
 const calendarDays=Array.from({length:31},(_,i)=>({id:'d'+i,academicCalendarId:calendar.id,date:year+'-'+month+'-'+String(i+1).padStart(2,'0'),status:'EFFECTIVE_LEARNING'}));
 return {...base,academicSetting:{...setting,id,semester:String(semester),academicYear:'2026/2027'},calendar,calendarDays,semesterJPSetting:{semesterPlanId:id,actualScheduledWeeklyJP:5,source:'TEACHER_CONFIRMED'}};
}
async function verifyDocuments(context:any,view:ReturnType<typeof buildPromesPresentation>){
 const docx=await generatePROMES(context);const zip=await JSZip.loadAsync(await docx.blob!.arrayBuffer());const xml=await zip.file('word/document.xml')!.async('string');
 const table=xml.match(/<w:tbl>.*?<\/w:tbl>/gs)!.find(t=>t.includes('Alokasi JP'))!;
 const tableRows=table.match(/<w:tr>.*?<\/w:tr>/gs)!;
 for(const [rowIndex,row] of tableRows.entries()){
  const cells=row.match(/<w:tc>.*?<\/w:tc>/gs)!;assert.equal(cells.length,view.headers.length);
  cells.forEach((cell,index)=>assert(cell.includes('w:jc w:val="'+(rowIndex===0?'center':view.alignments[index])+'"'),view.headers[index]));
 }
 assert(xml.includes('w:orient="landscape"'));assert(xml.includes('<w:tblHeader'));assert(xml.includes('w:type="fixed"'));assert(!xml.includes('<w:cantSplit/>'));
 const pdf=await generatePdfDocument('PROMES',context);
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(await pdf.blob.arrayBuffer()),useSystemFonts:true});const parsed=await task.promise;
 let text='';for(let i=1;i<=parsed.numPages;i++){const page=await parsed.getPage(i);assert(page.view[2]>page.view[3]);text+=' '+(await page.getTextContent()).items.map((it:any)=>it.str||'').join(' ');}
 const normalize=(s:string)=>s.replace(/\s+/g,' ').trim();text=normalize(text);
 for(const line of [...view.headers,...view.rows.flat(),...view.summaryRows.flat(),view.notes,'Sekolah PROMES','Guru PROMES','Kepala Sekolah']){
   for(const part of line.split('\n')){assert(xml.includes(part),part);assert(text.replace(/\s/g,'').includes(part.replace(/\s/g,'')),part);}
 }
 await task.destroy();
}
for(const semester of [1,2]){
 const context=makeContext(semester);const before=JSON.stringify(context);
 const projection=buildPromesProjection(context);assert(projection.isReady,projection.unreadyReason);
 assert.equal(projection.rows.length,1);assert.equal(projection.rows[0].unitId,semester===1?'unit':'unit2');
 assert.equal(projection.rows[0].unitTitle,semester===1?'Unit':'Bab Semester Genap');
 const view=buildPromesPresentation(projection);
 assert.equal(view.totalJP,semester===1?6:9);
 assert.equal(view.totalJP,projection.totalAllocatedJP);
 assert.equal(view.remainingJP,projection.remainingJP);assert.equal(view.status,projection.validationStatus);
 assert.equal(view.rows[0][5],'1–3');
 assert(view.rows[0][2].includes('Kompetensi t1'));assert(view.rows[0][2].includes('Kompetensi t2'));
 assert(view.rows[0][3].includes('Materi t1'));assert(view.rows[0][3].includes('Materi t2'));
 assert(!JSON.stringify(view).includes('BAB TANPA JADWAL'));
 assert.deepEqual(view.monthlyTotals,projection.monthHeaders.map(m=>projection.rows.reduce((sum,r)=>sum+(r.monthlyJP[m.monthName]||0),0)));
 assert.equal(view.monthlyTotals.reduce((a,b)=>a+b,0),view.totalJP);
 assert(!view.headers.includes(semester===1?'Januari':'Oktober'));
 await verifyDocuments(context,view);
 assert.equal(JSON.stringify(context),before);
 const missing={...context,learningMeetingSchedules:[]};assert.equal(buildPromesProjection(missing).isReady,false);
 await assert.rejects(()=>generatePROMES(missing));await assert.rejects(()=>generatePdfDocument('PROMES',missing));
}
const projection=buildPromesProjection(makeContext(1));
// Exact sparse weeks ignore the envelope and preserve canonical allocation values.
for(const [keys,expected] of [[[5,1,3],'1, 3, 5'],[[5,3,1,2],'1–3, 5'],[[],'-']] as const){
 const row={...projection.rows[0],startWeek:1,endWeek:99,weekAllocations:Object.fromEntries(keys.map(k=>[k,2]))};
 const view=buildPromesPresentation({...projection,rows:[row]});
 assert.equal(view.rows[0][5],expected);assert.equal(view.totalJP,projection.totalAllocatedJP);
}
for(const [weekAllocations,expected] of [
 [{1:1,2:1,3:0},'1–2'],
 [{1:0,3:2,5:2},'3, 5'],
 [{1:1,2:-1,3:NaN,4:Infinity,5:-Infinity,6:2},'1, 6'],
 [{'invalid':2,'1.5':2,'0':2,'-1':2,'Infinity':2,'NaN':2,3:2},'3'],
 [{1:0,2:-2,3:NaN,4:Infinity},'-'],
 [{1:'2',2:null,3:undefined,4:true,5:2},'5'],
] as const){
 const row={...projection.rows[0],weekAllocations:weekAllocations as Record<number,number>};
 assert.equal(buildPromesPresentation({...projection,rows:[row]}).rows[0][5],expected);
}
const sparse=structuredClone(makeContext(1));
sparse.learningMeetingSchedules[0].schedule.entries.forEach((entry:any,index:number)=>entry.weekIndex=[5,1,3][index]);
const sparseProjection=buildPromesProjection(sparse);assert(sparseProjection.isReady,sparseProjection.unreadyReason);
const sparseView=buildPromesPresentation(sparseProjection);assert.equal(sparseView.rows[0][5],'1, 3, 5');await verifyDocuments(sparse,sparseView);
for(const semester of [1,2]){
 const k13=makeContext(semester);
 k13.academicSetting={...k13.academicSetting,curriculumType:'K13',curriculum:'Kurikulum 2013'};
 k13.k13Analysis={items:[{id:'kd1',kd:'3.1',indikator:'Indikator canonical K13',materi:'Materi canonical K13'}]};
 k13.timeAllocations=[{id:'alloc-k13',academicSettingId:k13.academicSetting.id,sourceType:'KD',sourceId:'kd1',allocatedJP:6,startWeek:1,endWeek:3}];
 const projected=buildPromesProjection(k13);assert(projected.isReady,projected.unreadyReason);
 const view=buildPromesPresentation(projected);
 assert.deepEqual(view.headers.slice(0,5),['No','Kompetensi Dasar (KD)','Indikator/Materi','Alokasi JP','Pekan']);
 assert(!view.headers.includes('Unit/Bab'));assert(!view.headers.includes('TP'));
 assert.equal(view.rows[0][1],'3.1');assert.equal(view.rows[0][2],'Indikator canonical K13\nMateri canonical K13');
 assert.equal(view.rows[0][4],'1–3');assert.equal(view.totalJP,6);
 assert.equal(view.summaryRows[0][3],'6 JP');assert(Math.abs(view.widths.reduce((a,b)=>a+b,0)-100)<1e-9);
 assert.deepEqual(view.alignments.slice(0,5),['center','left','left','center','center']);
 await verifyDocuments(k13,view);
 const blank=buildPromesPresentation(projected,true);assert.equal(blank.rows[0].length,view.headers.length);assert.equal(blank.summaryRows[0][3],'-');
}
assert.deepEqual(buildPromesPresentation(projection).alignments.slice(0,6),['center','left','left','left','center','center']);
const pdfSource=readFileSync('src/services/documentEngine/renderers/pdf/pdfDocGenerators.ts','utf8');assert(pdfSource.includes('align: presentation.alignments[index]'));
const extra={...projection.rows[0],id:'assessment',sourceType:'ASSESSMENT' as const,allocatedJP:4,monthlyJP:{Oktober:4}};
const combined=buildPromesPresentation({...projection,assessmentRows:[extra],reserveRows:[{...extra,id:'reserve',sourceType:'RESERVE',allocatedJP:2,monthlyJP:{Oktober:2}}]});
assert.equal(combined.totalJP,12);assert.equal(combined.monthlyTotals.reduce((a,b)=>a+b,0),12);
assert.equal(combined.summaryRows[0][4],'12 JP');
const noData=buildPromesPresentation({...projection,rows:[],assessmentRows:[],reserveRows:[],availableJP:null});
assert.equal(noData.totalJP,0);assert.equal(noData.rows.length,0);assert.equal(noData.status,'-');
for(const delta of [-2,0,2]){const view=buildPromesPresentation({...projection,availableJP:projection.totalAllocatedJP+delta});assert.equal(view.remainingJP,delta);assert.equal(view.status,delta<0?'OVER_ALLOCATED':delta>0?'UNDER_ALLOCATED':'BALANCED');}
const blank=makeContext(1);blank.documentMode='blank';const view=buildPromesPresentation(buildPromesProjection(blank),true);assert.equal(view.rows.length,15);assert(view.summaryRows.every(row=>row[4]==='-'));await generatePROMES(blank);await generatePdfDocument('PROMES',blank);
console.log('PASS: exact sparse/contiguous weeks, K13 semantics, shared DOCX/PDF alignment/content, semester isolation, canonical totals/status, no fake allocation, landscape/header/splittable DOCX, and blank mode.');

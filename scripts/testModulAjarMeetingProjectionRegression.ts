import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { createDocumentSnapshot } from '../src/services/documentEngine/snapshot';
const stamp = '2026-10-17T00:00:00Z';
const tpIds = ['t1', 't2'];
const atpIds = ['a1', 'a2'];
const setting: any = { id: 'sem', curriculumType: 'KURIKULUM_MERDEKA', curriculum: 'Kurikulum Merdeka', semester: '1', subject: 'PJOK', grade: '7', level: 'SMP' };
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
const criteria: any = [...tpIds,'unrelated'].map(id=>({ id:'c'+id, academicSettingId:'sem', tpId:id, description:'KKTP '+id, approach:'deskripsi', indicators:['Indikator '+id], levels:[{level:'Baik',description:'Mandiri'}], workflowStatus:'SIAP', updatedAt:stamp }));
const assessment = (type:string) => ({ id:type, type, linkedTpIds:['t1'], description:'Asesmen '+type });
const plan: any = { id:'lp', curriculumType:'KURIKULUM_MERDEKA', academicSettingId:'sem', unitId:'unit', learningMeetingIds:['m3','m1','m2'], tpIds, atpItemIds:atpIds,
  kktpCriterionIds:['ct1','ct2'], sourceType:'MANUAL', status:'SIAP', confirmedAt:stamp, createdAt:stamp, updatedAt:stamp,
  objectives:tp.items.map((t:any)=>({ ...t, tpId:t.id })), topic:'Topik', allocatedJP:6,
  initialCompetency:'Kompetensi awal', graduateProfileDimensions:['Kemandirian'], resources:[{id:'r',title:'Buku'}], learningModel:'Praktik',
  learningExperiences:['UNDERSTAND','APPLY','REFLECT'].map((phase,i)=>({id:'e'+i,phase,description:'Kegiatan '+phase})),
  learningSteps: {
    opening: [3,1,2].map(order=>({id:'opening'+order,learningMeetingId:'m'+order,description:'Awal khusus '+order,durationMinutes:10})),
    core: [3,1,2].map(order=>({id:'activity'+order,learningMeetingId:'m'+order,description:'Aktivitas khusus '+order,durationMinutes:60})),
    closing: [3,1,2].map(order=>({id:'closing'+order,learningMeetingId:'m'+order,description:'Akhir khusus '+order,durationMinutes:10})),
  },
  assessmentPlan:{ initial:[assessment('INITIAL')], formative:[{...assessment('FORMATIVE'), learningMeetingId:'m1'}], summative:[assessment('SUMMATIVE')] },
  differentiation:{content:'Konten'}, enrichmentPlan:'Pengayaan', remedialPlan:'Remedial', reflection:{teacherReflection:'Guru',studentReflection:'Murid'} };
const context: any = { school:{name:'Sekolah'},profile:{name:'Guru'}, academicSetting:setting,tp,atp, atpUnitMapping:mapping, unitExecutionPlan:execution, learningMeetingSchedules:schedules, learningPlans:[plan],activeLearningPlanId:'lp',assessmentCriteria:criteria };
const projection = buildModulAjarProjection(context);
assert.equal(projection.isReady,true,projection.error);
assert.deepEqual(projection.meetings?.map(m=>m.id),['m1','m2','m3']);
assert.deepEqual(projection.meetings?.map(m=>m.KKTP.map(c=>c.tpId)),[['t1'],['t2'],['t1']]);
assert.deepEqual(projection.meetings?.map(m=>m.assessments.length),[1,0,0]);
assert.equal(projection.sections?.length,7);
assert.deepEqual(projection.meetings!.map(m => m.activities.filter(a=>a.phase==='core').map(a => a.description)),
  [['Aktivitas khusus 1'], ['Aktivitas khusus 2'], ['Aktivitas khusus 3']]);
assert(projection.meetings!.every(m => m.activitiesStatus === 'COMPLETE'));
assert(projection.meetings!.every(m => m.KKTP.every(c => !('levels' in c))));
const missingActivities = structuredClone(context);
delete missingActivities.learningPlans[0].learningSteps;
const incomplete = buildModulAjarProjection(missingActivities);
assert.equal(incomplete.isReady,false);
assert(incomplete.error?.includes('opening'));
const blankActivity = structuredClone(context);
blankActivity.learningPlans[0].learningSteps.core[0].description = ' ';
assert.equal(buildModulAjarProjection(blankActivity).isReady,false);
const scopedExperience = structuredClone(context);
scopedExperience.learningPlans[0].learningExperiences.push({id:'meeting-exp', phase:'APPLY', description:'Pengalaman khusus m2', learningMeetingId:'m2'});
const withScopedExperience = buildModulAjarProjection(scopedExperience);
assert.equal(withScopedExperience.meetings!.find(m=>m.id==='m2')!.activities.at(-1)!.description, 'Pengalaman khusus m2');
assert(!withScopedExperience.sections!.some(s => s.title.includes('PENGALAMAN BELAJAR')));
assert(!JSON.stringify(projection.sections).includes('unrelated'));
for (const mutation of [
  (c:any)=>c.learningPlans[0].learningMeetingIds.push('dangling'),
  (c:any)=>c.learningMeetingSchedules[0].schedule.entries[0].unitId='other',
  (c:any)=>c.unitExecutionPlan.units[0].meetings[0].linkedTpIds=['missing'],
  (c:any)=>c.learningPlans[0].unitId=undefined,
  (c:any)=>c.learningPlans[0].learningSteps.core[0].learningMeetingId='dangling',
  (c:any)=>c.learningPlans[0].learningSteps.core[0].learningMeetingId=' m3 ',
  (c:any)=>c.learningPlans[0].learningSteps.core[0].learningMeetingId='',
  (c:any)=>c.learningPlans[0].learningExperiences[0].learningMeetingId='other-unit-meeting',
]) {
  const changed=structuredClone(context); mutation(changed);
  assert.equal(buildModulAjarProjection(changed).isReady,false);
}
// Non-LearningPlan documents must not resolve or carry LearningPlan lineage.
for (const type of ['CP','TP','ATP','PROTA','PROMES','KKTP'] as const) {
  const guardedContext = {...context};
  Object.defineProperty(guardedContext, 'learningPlans', { get() { throw new Error('Non-ModulAjar read LearningPlan'); } });
  const nonModul = createDocumentSnapshot(guardedContext, 'docx', 'data', type);
  assert(!('learningPlanId' in nonModul), type);
  assert(!('learningPlanUpdatedAt' in nonModul.sourceVersions!), type);
}
const unspecified = createDocumentSnapshot(context);
assert(!('learningPlanId' in unspecified));
assert(!('learningPlanUpdatedAt' in unspecified.sourceVersions!));
assert(!projection.sections!.some(s => s.title.includes('PENGALAMAN BELAJAR')));
assert.deepEqual(projection.sections!.map(s => s.title), [
  'I. INFORMASI UMUM',
  'II. KOMPONEN INTI',
  'III. RENCANA PERTEMUAN',
  'IV. ASESMEN + KKTP',
  'V. DIFERENSIASI',
  'VI. PENGAYAAN/REMEDIAL',
  'VII. REFLEKSI',
]);
assert(!projection.sections!.some(s => s.title.includes('PENGESAHAN')));
const meetingSection = projection.sections!.find(s => s.title.includes('RENCANA PERTEMUAN'))!;
assert(!meetingSection.lines.some(line => line.includes('Mandiri')));
assert(projection.sections!.find(s=>s.title.includes('ASESMEN + KKTP'))!.lines.some(line=>line.includes('Mandiri')));
for (const label of ['Materi:', 'TP:', 'Kegiatan Pembelajaran:', 'Asesmen:', 'KKTP ringkas:']) {
  assert.equal(meetingSection.lines.filter(line=>label === 'Materi:' ? line.startsWith(label) : line === label).length, 3, label);
}
for (const experience of plan.learningExperiences) {
  assert(!meetingSection.lines.some(line => line.includes(experience.description)));
  assert.equal(projection.sections!.flatMap(s => s.lines).filter(line => line.includes(experience.description)).length, 0);
}
const snap=createDocumentSnapshot(context, 'docx', 'data', 'MODUL_AJAR');
assert.equal(snap.learningPlanId,plan.id);
assert.equal(snap.sourceVersions?.learningPlanUpdatedAt,stamp);
assert.equal(buildModulAjarProjection({...context,snapshot:snap}).isReady,true);
assert.equal(buildModulAjarProjection({...context,snapshot:{...snap,sourceVersions:{...snap.sourceVersions,learningPlanUpdatedAt:'old'}}}).isReady,false);
for(const path of ['src/services/documentEngine/generators/modulAjarGenerator.ts','src/services/documentEngine/renderers/pdf/pdfDocGenerators.ts']) {
  const source=readFileSync(path,'utf8');
  assert(source.includes('buildModulAjarProjection(context)'));
  if (path.includes('modulAjarGenerator')) {
    assert(source.includes('sharedProjection.meetings'));
    assert(source.includes('meeting.activities'));
    assert(source.includes('meeting.kktpSummaryLines'));
  } else {
    assert(source.includes('projection.sections'));
    assert(source.includes('section.lines'));
  }
}
console.log('PASS: ordered 3 meetings, invalid lineage, scoped KKTP, shared DOCX/PDF sections, snapshot LearningPlan lineage.');


// Execute both renderers, then inspect DOCX content in addition to the source wiring check.
const { generateModulAjar } = await import('../src/services/documentEngine/generators/modulAjarGenerator');
const { generatePdfDocument } = await import('../src/services/documentEngine/renderers/pdf/pdfDocGenerators');
const { default: JSZip } = await import('jszip');
const docx = await generateModulAjar({...context,skipDownload:true});
assert(docx.blob);
const zip = await JSZip.loadAsync(await docx.blob!.arrayBuffer());
const xml = await zip.file('word/document.xml')!.async('string');
assert(xml.indexOf('PERTEMUAN 1 — Judul 1 — 2 JP') < xml.indexOf('PERTEMUAN 2 — Judul 2 — 2 JP'));
assert(xml.indexOf('PERTEMUAN 2 — Judul 2 — 2 JP') < xml.indexOf('PERTEMUAN 3 — Judul 3 — 2 JP'));
// Regression Target Assertions:
// 1. DOCX tidak memuat tanggal meeting
assert(!xml.includes('2026-10-19') && !xml.includes('2026-10-20') && !xml.includes('2026-10-21'), 'DOCX tidak memuat tanggal meeting');
// 2. tidak ada undefined
assert(!xml.includes('undefined'), 'tidak ada undefined');
// 3. setiap meeting punya header jelas + Materi + TP + KKTP
assert(xml.includes('Materi') && xml.includes('Tujuan Pembelajaran') && xml.includes('Asesmen') && xml.includes('KKTP'), 'setiap meeting punya header jelas + label tebal');
// 4. KKTP terstruktur per TP
assert(xml.includes('Kriteria') && xml.includes('Indikator') && xml.includes('Perlu Bimbingan') && xml.includes('Cukup') && xml.includes('Baik') && xml.includes('Sangat Baik'), 'KKTP terstruktur per TP');
// 5. narrative paragraph justified
assert(xml.includes('w:jc w:val="both"'), 'narrative paragraph justified');
// 6. identity/signoff tetap rapi
assert(xml.includes('Satuan Pendidikan') && xml.includes('Mengetahui'), 'identity/signoff tetap rapi');
for(const section of projection.sections || []) assert(xml.includes(section.title.replace('&','&amp;')));
// Only the unit assessment section contains full rubric levels.
const wordMeetings = xml.slice(xml.indexOf('III. RENCANA PERTEMUAN'), xml.indexOf('IV. ASESMEN + KKTP'));
assert(wordMeetings.includes('Kegiatan Pembelajaran'));
assert(!wordMeetings.includes('Perlu Bimbingan'));
assert(!wordMeetings.includes('Mandiri'));
for (const order of [1,2,3]) {
  const start=wordMeetings.indexOf('PERTEMUAN '+order+' —');
  const next=wordMeetings.indexOf('PERTEMUAN '+(order+1)+' —');
  const block=wordMeetings.slice(start,next < 0 ? undefined : next);
  assert(block.includes('Aktivitas khusus '+order));
  for(const other of [1,2,3].filter(n=>n!==order)) assert(!block.includes('Aktivitas khusus '+other));
}
const pdf = await generatePdfDocument('MODUL_AJAR',{...context,skipDownload:true});
assert(pdf.blob.size > 0);
assert.equal(pdf.snapshot.learningPlanId,'lp');
assert.equal(xml.split('Kegiatan UNDERSTAND').length - 1, 0);
assert(!xml.includes('PENGALAMAN BELAJAR'));
assert(!xml.includes('VIII. PENGESAHAN'));
console.log('PASS: real DOCX/PDF generation; DOCX ordered meeting text and all 7 sections; PDF snapshot lineage.');
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdfTask = getDocument({ data:new Uint8Array(await pdf.blob.arrayBuffer()), useSystemFonts:true });
const parsedPdf = await pdfTask.promise;
const pdfLines: string[] = [];
for(let i=1;i<=parsedPdf.numPages;i++) {
  const page=await parsedPdf.getPage(i);
  const content=await page.getTextContent();
  pdfLines.push(content.items.map((item:any)=>item.str || '').join(' '));
}
const pdfText=pdfLines.join(' ');
for(const section of projection.sections || []) assert(pdfText.includes(section.title),section.title);
for(const meeting of projection.meetings || []) assert(pdfText.includes('Pertemuan '+meeting.order+': '+meeting.title));
assert(pdfText.indexOf('Pertemuan 1: Judul 1') < pdfText.indexOf('Pertemuan 2: Judul 2'));
assert(pdfText.indexOf('Pertemuan 2: Judul 2') < pdfText.indexOf('Pertemuan 3: Judul 3'));
assert.equal(pdfText.split('Kegiatan UNDERSTAND').length - 1, 0);
assert(!pdfText.includes('PENGALAMAN BELAJAR'));
assert(!pdfText.includes('VIII. PENGESAHAN'));
assert(xml.includes('Kepala Sekolah'));
assert(pdfText.includes('Kepala Sekolah'));
const pdfMeetings=pdfText.slice(pdfText.indexOf('III. RENCANA PERTEMUAN'),pdfText.indexOf('IV. ASESMEN + KKTP'));
assert(!pdfMeetings.includes('Mandiri'));
for(const order of [1,2,3]) {
  const start=pdfMeetings.indexOf('Pertemuan '+order+':');
  const next=pdfMeetings.indexOf('Pertemuan '+(order+1)+':');
  const block=pdfMeetings.slice(start,next<0 ? undefined : next);
  assert(block.includes('Aktivitas khusus '+order));
  for(const other of [1,2,3].filter(n=>n!==order)) assert(!block.includes('Aktivitas khusus '+other));
}
await pdfTask.destroy();
console.log('PASS: extracted PDF text contains all 7 sections and the same 3 ordered meetings.');

// Mandatory Regression:
// 1. Modul dengan learningExperiences meeting-linked -> tidak ada section kosong.
// 2. Semua learningExperiences tetap muncul di pertemuan terkait.
// 3. DOCX dan PDF punya struktur nomor yang sama.
// 4. Tidak ada duplikasi Pengalaman Belajar.
// 5. Modul valid existing tetap lolos.
const meetingLinkedContext = structuredClone(context);
meetingLinkedContext.learningPlans[0].learningExperiences = [
  { id: 'me1', phase: 'UNDERSTAND', description: 'Memahami konsep dasar gerak', learningMeetingId: 'm1', durationMinutes: 20 },
  { id: 'me2', phase: 'APPLY', description: 'Mempraktikkan gerak spesifik', learningMeetingId: 'm2', durationMinutes: 30 },
  { id: 'me3', phase: 'REFLECT', description: 'Refleksi pengalaman gerak', learningMeetingId: 'm3', durationMinutes: 15 },
];
const mlProj = buildModulAjarProjection(meetingLinkedContext);
assert.equal(mlProj.isReady, true);
assert.equal(mlProj.sections!.length, 7);
assert(!mlProj.sections!.some(s => s.title.includes('PENGALAMAN BELAJAR')));
assert.deepEqual(mlProj.sections!.map(s => s.title), [
  'I. INFORMASI UMUM',
  'II. KOMPONEN INTI',
  'III. RENCANA PERTEMUAN',
  'IV. ASESMEN + KKTP',
  'V. DIFERENSIASI',
  'VI. PENGAYAAN/REMEDIAL',
  'VII. REFLEKSI',
]);

// All meeting-linked learningExperiences appear in their respective meetings
assert(mlProj.meetings!.find(m => m.id === 'm1')!.activityLines.some(l => l.includes('Memahami konsep dasar gerak')));
assert(mlProj.meetings!.find(m => m.id === 'm2')!.activityLines.some(l => l.includes('Mempraktikkan gerak spesifik')));
assert(mlProj.meetings!.find(m => m.id === 'm3')!.activityLines.some(l => l.includes('Refleksi pengalaman gerak')));

// Generate DOCX with meeting-linked experiences
const mlDoc = await generateModulAjar({ ...meetingLinkedContext, skipDownload: true });
const mlXml = await (await JSZip.loadAsync(await mlDoc.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
assert(!mlXml.includes('PENGALAMAN BELAJAR'));
assert(mlXml.includes('Memahami: Memahami konsep dasar gerak (pendekatan kegiatan inti)'));
assert(mlXml.includes('Mengaplikasi: Mempraktikkan gerak spesifik (pendekatan kegiatan inti)'));
assert(mlXml.includes('Merefleksi: Refleksi pengalaman gerak (pendekatan kegiatan inti)'));
// No duplication: each description appears exactly once in the entire document
assert.equal(mlXml.split('Memahami konsep dasar gerak').length - 1, 1);
assert.equal(mlXml.split('Mempraktikkan gerak spesifik').length - 1, 1);
assert.equal(mlXml.split('Refleksi pengalaman gerak').length - 1, 1);

// Generate PDF with meeting-linked experiences
const mlPdf = await generatePdfDocument('MODUL_AJAR', { ...meetingLinkedContext, skipDownload: true });
const mlPdfTask = getDocument({ data: new Uint8Array(await mlPdf.blob.arrayBuffer()), useSystemFonts: true });
const parsedMlPdf = await mlPdfTask.promise;
const mlPdfLines: string[] = [];
for (let i = 1; i <= parsedMlPdf.numPages; i++) {
  const page = await parsedMlPdf.getPage(i);
  const content = await page.getTextContent();
  mlPdfLines.push(content.items.map((item: any) => item.str || '').join(' '));
}
const mlPdfText = mlPdfLines.join(' ');
assert(!mlPdfText.includes('PENGALAMAN BELAJAR'));
assert(mlPdfText.includes('Memahami konsep dasar gerak'));
assert(mlPdfText.includes('Mempraktikkan gerak spesifik'));
assert(mlPdfText.includes('Refleksi pengalaman gerak'));
assert.equal(mlPdfText.split('Memahami konsep dasar gerak').length - 1, 1);
assert.equal(mlPdfText.split('Mempraktikkan gerak spesifik').length - 1, 1);
assert.equal(mlPdfText.split('Refleksi pengalaman gerak').length - 1, 1);

// Parity: DOCX and PDF have identical 7 section titles
for (const section of mlProj.sections || []) {
  assert(mlXml.includes(section.title.replace('&', '&amp;')), 'DOCX missing section: ' + section.title);
  assert(mlPdfText.includes(section.title), 'PDF missing section: ' + section.title);
}
await mlPdfTask.destroy();
console.log('PASS: meeting-linked learning experiences render cleanly in meetings without duplicate or empty standalone sections; DOCX and PDF 7-section parity verified.');
console.log('PASS: exact meeting activities, dangling ID rejection, incomplete activities marker, no unit duplication, compact meeting KKTP and DOCX/PDF parity.');

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { Document, Packer, Paragraph } from 'docx';
import { createMockContext } from './fixtures/printContext';
import { generateDocument } from '../src/services/documentEngine';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { PdfDocumentBuilder } from '../src/services/documentEngine/renderers/pdf/pdfRenderer';
import { createPrintSignoff, type PrintSignoff } from '../src/services/documentEngine/signoffLayout';
import { createDocxSectionProperties } from '../src/services/documentEngine/docxStyles';
import { annualJPNotes, promesAnnualJPNotes } from '../src/services/documentEngine/jpPresentation';
import { buildPromesPresentation } from '../src/services/documentEngine/promesPresentation';
import { buildPromesProjection } from '../src/services/documentEngine/promesProjection';
import type { DocumentType } from '../src/types';

const out = 'tmp/print-audit';
mkdirSync(out, { recursive: true });
const types: DocumentType[] = ['CP','TP','ANALISIS_CP_TP','ATP','PEMETAAN_ATP_UNIT','PROTA','PROMES','MODUL_AJAR','KKTP','DAFTAR_HADIR','ASESMEN','DAFTAR_NILAI','JURNAL','REMEDIAL_PENGAYAAN','KALENDER_AKADEMIK','HARI_EFEKTIF','ALOKASI_WAKTU','ANALISIS_SKL_KI_KD','PENETAPAN_KKM'];
const landscape = new Set(['PROMES','PEMETAAN_ATP_UNIT','DAFTAR_HADIR','DAFTAR_NILAI','JURNAL']);
const results: any[] = [];
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
async function checkPdf(blob: Blob, name: string, expectedLandscape: boolean, requireSignoff = true, expectedSignoff: string[] = []) {
  writeFileSync(`${out}/${name}.pdf`, Buffer.from(await blob.arrayBuffer()));
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
  const pdf = await task.promise;
  const violations: string[] = [];
  let signaturePage = 0;
  for (let i=1;i<=pdf.numPages;i++) {
    const page = await pdf.getPage(i);
    const [,,w,h] = page.view;
    assert.equal(w > h, expectedLandscape, name);
    assert(Math.abs(Math.min(w,h)-595.28)<1 && Math.abs(Math.max(w,h)-841.89)<1, `${name}: not A4`);
    const items: any[] = (await page.getTextContent()).items;
    const text = items.map(it=>it.str || '').join(' ');
    if (name === 'PROTA-data' && i === 1) assert(text.includes('Bab 1'), 'Long Prota must start its first data row with the table header');
    if (name.startsWith('PROMES') && items.some(it=>it.str === 'Unit/Bab')) {
      assert(items.some(it=>it.str === 'No'), `${name}: number header wraps into separate letters`);
    }
    assert(text.trim().length, `${name}: blank page ${i}`);
    // PDF text extents are measurable evidence, not a substitute for raster inspection.
    const left = (expectedLandscape ? 25 : 30) * 72 / 25.4;
    const right = w - (expectedLandscape ? 20 : 25) * 72 / 25.4;
    for (const item of items.filter(it=>it.str?.trim())) {
      const x=item.transform[4], y=h-item.transform[5];
      if (x < left-2 || x+item.width > right+2 || y < 15 || y > h-15) violations.push(`page ${i}: ${item.str} [${x.toFixed(1)},${y.toFixed(1)},${item.width.toFixed(1)}]`);
    }
    if (text.includes('Mengetahui,')) {
      signaturePage = i;
      for (const token of ['Kepala Sekolah','Guru Mata Pelajaran','NIP.','Pengesahan']) assert(text.includes(token), `${name} incomplete TTD ${token}`);
      for (const value of expectedSignoff) assert(text.replace(/\s/g,'').includes(value.replace(/\s/g,'')), `${name}: TTD lost identity ${value}`);
    }
  }
  if (requireSignoff) assert(signaturePage, `${name}: no TTD`);
  const pages = pdf.numPages;
  await task.destroy();
  return { pages, signaturePage, violations };
}

for (const type of types) {
  const context = createMockContext(); context.documentMode = 'blank';
  if (type === 'ANALISIS_SKL_KI_KD' || type === 'PENETAPAN_KKM') { context.academicSetting.curriculumType = 'K13'; context.academicSetting.curriculum = 'Kurikulum 2013'; }
  if (type === 'PENETAPAN_KKM') {
    context.documentMode = 'data';
    context.k13KKM = { id:'kkm', academicSettingId:context.academicSetting.id, kkmTotal:75, items:[{id:'kd',kd:'3.1',indikator:'Kompetensi pengujian KKM',kompleksitas:75,dayaDukung:75,intake:75,kkmIndikator:75}] } as any;
  }
  try {
    const doc = await generateDocument(type, context);
    assert(doc.blob);
    writeFileSync(`${out}/${type}.docx`, Buffer.from(await doc.blob.arrayBuffer()));
    const xml = await (await JSZip.loadAsync(await doc.blob.arrayBuffer())).file('word/document.xml')!.async('string');
    const signoff = xml.match(/<w:tr>.*?<\/w:tr>/gs)!.find(row=>row.includes('Mengetahui,'));
    assert(signoff, `${type}: TTD missing`);
    assert(signoff.includes('<w:cantSplit'), `${type}: TTD can split`);
    assert(signoff.includes('<w:keepNext') && signoff.includes('<w:keepLines'), `${type}: no paragraph protection`);
    assert(!signoff.includes('<w:trHeight'), `${type}: fixed row height`);
    assert.equal(xml.includes('w:orient="landscape"'), landscape.has(type), type);
    const pageSize = xml.match(/<w:pgSz\b[^>]*\/>/)![0];
    assert(pageSize.includes(`w:w="${landscape.has(type) ? 16838 : 11906}"`), `${type}: wrong page width`);
    assert(pageSize.includes(`w:h="${landscape.has(type) ? 11906 : 16838}"`), `${type}: wrong page height`);
    const margin = xml.match(/<w:pgMar\b[^>]*\/>/)![0];
    assert(margin.includes(`w:left="${landscape.has(type) ? 1417 : 1701}"`), `${type}: wrong left margin`);
    assert(margin.includes(`w:right="${landscape.has(type) ? 1134 : 1417}"`), `${type}: wrong right margin`);
    const pdf = await generatePdfDocument(type, context);
    results.push({ type, mode:context.documentMode, docx:'STRUCTURE_PASS_RENDER_PENDING', ...await checkPdf(pdf.blob, type, landscape.has(type)) });
  } catch (e) { results.push({type, error: String(e)}); }
}
for (const type of ['ATP','PROTA','PROMES'] as DocumentType[]) {
  const context = createMockContext();
  context.profile.name = 'Dr. Nama Guru Sangat Panjang Untuk Pengujian Pembungkusan Baris M.Pd. Gr.';
  context.school.principalName = 'Dr. Nama Kepala Sekolah Sangat Panjang Untuk Pengujian Pembungkusan Baris M.Pd.';
  context.profile.nip = '198001012000011001 198001012000011001';
  context.school.principalNip = '197001012000011001 197001012000011001';
  context.tp!.items.forEach(tp=>tp.statement = (`${tp.statement} `).repeat(8));
  if (type === 'PROMES') {
    const mapping = context.atpUnitMapping!, execution = context.unitExecutionPlan!;
    const originalUnit = structuredClone(mapping.units[0]);
    const originalExecution = structuredClone(execution.units[0]);
    const schedule = context.learningMeetingSchedules![0].schedule;
    const entries = structuredClone(schedule.entries);
    for (let chapter=2;chapter<=4;chapter++) {
      const unitId=`chapter-${chapter}`;
      mapping.units.push({...structuredClone(originalUnit),id:unitId,title:`Bab ${chapter} Pengujian Promes`,order:chapter+2});
      execution.units.push({...structuredClone(originalExecution),unitId,meetings:originalExecution.meetings.map(m=>({...m,id:`${m.id}-c${chapter}`,unitId}))});
      schedule.entries.push(...entries.map(e=>({...e,meetingId:`${e.meetingId}-c${chapter}`,unitId,sessionId:`${e.sessionId}-c${chapter}`,sourceSlotId:`${e.sourceSlotId}-c${chapter}`})));
    }
  }
  const before = JSON.stringify(context);
  const doc = await generateDocument(type, context);
  writeFileSync(`${out}/${type}-data.docx`, Buffer.from(await doc.blob!.arrayBuffer()));
  const pdf = await generatePdfDocument(type, context);
  results.push({type, mode:'data-long-identity', docx:'STRUCTURE_PASS_RENDER_PENDING', ...await checkPdf(pdf.blob, `${type}-data`, landscape.has(type), true, [context.profile.name, context.profile.nip!, context.school.principalName!, context.school.principalNip!])});
  assert.equal(JSON.stringify(context), before, 'Generator mutated input');
  if (type === 'PROMES') {
    const p=buildPromesProjection(context), view=buildPromesPresentation(p);
    assert.equal(p.rows.length,4, 'Four canonical scheduled chapters');
    assert(view.details.length > 0);
    assert.equal(view.totalJP, p.totalAllocatedJP);
    assert.equal(view.monthlyTotals.reduce((a,b)=>a+b,0), view.totalJP);
    assert(view.rows[0][2].includes('R1'));
    assert(view.details.some(d=>d.includes(context.tp!.items[0].statement)));
    const xml = await (await JSZip.loadAsync(await doc.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
    const docxText = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match=>match[1]).join(' ')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    const task = getDocument({ data: new Uint8Array(await pdf.blob.arrayBuffer()), useSystemFonts: true });
    const parsed = await task.promise;
    let pdfText = '';
    for (let page=1;page<=parsed.numPages;page++) pdfText += (await (await parsed.getPage(page)).getTextContent()).items
      .filter((item:any)=>!/^Halaman \d+ dari \d+$/.test(item.str || '')).map((item:any)=>item.str || '').join(' ');
    for (const value of [...view.details, promesAnnualJPNotes(context)]) {
      const normalize = (text:string) => text.replace(/\s/g,'');
      assert(normalize(docxText).includes(normalize(value)), `PROMES DOCX lost full detail or annual JP note: ${value}`);
      assert(normalize(pdfText).includes(normalize(value)), `PROMES PDF lost full detail or annual JP note: ${value}`);
    }
    await task.destroy();
  }
}
const signoff: PrintSignoff = {locationAndDate:'Kabupaten Pengujian Nama Lokasi Sangat Panjang, 7 November 2026',principalTitle:'Kepala Sekolah',teacherTitle:'Guru Mata Pelajaran',principalName:'Kepala Sekolah '+ 'Nama Panjang '.repeat(6),teacherName:'Guru '+ 'Nama Panjang '.repeat(7),principalNip:'1970'.repeat(15),teacherNip:'1980'.repeat(15),isBlankMode:false};
for (const orientation of ['portrait','landscape'] as const) {
  const builder = new PdfDocumentBuilder(orientation);
  builder.renderHeader('Uji Tabel Panjang dan TTD Dekat Akhir Halaman');
  builder.renderTable({type:'table',columns:['No','Konteks pembelajaran'],rows:Array.from({length:75},(_,i)=>[i+1,'Kegiatan pembelajaran dengan isi tabel panjang untuk uji pergantian halaman.'])});
  // Exercise the exact boundary independently of table row heights.
  (builder as any).currentY = (builder as any).pageHeight - (builder as any).marginBottom - 2;
  builder.renderNormalizedSignatureBlock(signoff);
  results.push({type:`STRESS-${orientation}`, ...await checkPdf(builder.getBlob(), `STRESS-${orientation}`, orientation==='landscape', true, [signoff.locationAndDate, signoff.principalName, signoff.teacherName, signoff.principalNip!, signoff.teacherNip!])});
  const doc=new Document({sections:[{properties:createDocxSectionProperties(orientation),children:[...Array.from({length:55},(_,i)=>new Paragraph(`Konteks pembelajaran baris ${i+1}`)),...createPrintSignoff(signoff)]}]});
  writeFileSync(`${out}/STRESS-${orientation}.docx`, Buffer.from(await Packer.toBuffer(doc)));
}
assert(annualJPNotes({totalAllocatedJP:344,officialAnnualJP:288,availableAnnualJP:350}).includes('melebihi acuan regulasi sebesar 56 JP'));
assert(!annualJPNotes({totalAllocatedJP:288,officialAnnualJP:288,availableAnnualJP:350}).includes('Selisih'));
assert(annualJPNotes({totalAllocatedJP:280,officialAnnualJP:288}).includes('di bawah acuan regulasi sebesar 8 JP'));
// Every active TTD owner must route through the shared helper (including the legacy ATP entry point).
for (const file of ['src/services/docxGenerator.ts','src/services/documentEngine/generators/modulAjarGenerator.ts','src/services/documentEngine/assessmentExportService.ts']) {
  assert(/createSignoffBlock|createPrintSignoff/.test(readFileSync(file,'utf8')), file);
}
writeFileSync(`${out}/results.json`, JSON.stringify(results,null,2));
for (const row of results) console.log(`${row.type} ${row.mode || ''}: ${row.error || `${row.pages} PDF pages; ${row.violations.length} bounds violations`}`);
assert(results.every(row=>!row.error && !row.violations.length), 'Inspect tmp/print-audit/results.json');
console.log('PASS: all document types, signature protection, long identities, multipage tables, JP notes, source immutability and compact Promes fidelity. DOCX visual render remains a separate gate.');

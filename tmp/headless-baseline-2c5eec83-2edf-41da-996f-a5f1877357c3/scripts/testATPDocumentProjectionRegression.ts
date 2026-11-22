import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { ATP_DOCUMENT_COLUMNS, buildATPDocumentProjection, getATPDocumentRowCells } from '../src/services/documentEngine/atpDocumentProjection';
import { generateATP } from '../src/services/documentEngine/generators/atpGenerator';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { validateDocumentRequirements } from '../src/services/documentEngine';
const context:any={
 school:{id:'school',name:'Sekolah Canonical',npsn:'12345678',address:'Jalan Pendidikan',district:'Kota',principalName:'Kepala Sekolah Canonical',principalNip:'123'},
 profile:{id:'teacher',name:'Guru Canonical',nip:'456'},
 academicSetting:{id:'sem',subject:'PJOK',grade:'Kelas 7',phase:'D',semester:'1',academicYear:'2026/2027',curriculum:'Kurikulum Merdeka',curriculumType:'KURIKULUM_MERDEKA'},
 documentDate:'2026-10-18',skipDownload:true,
 cp:{id:'cp',academicSettingId:'sem',generalDescription:'CP canonical untuk kegiatan belajar.',elements:[{id:'e1',name:'Elemen Canonical',content:'Kompetensi elemen canonical.'}],updatedAt:'2026-10-18'},
 tp:{id:'tp',academicSettingId:'sem',items:[{id:'t1',code:'TP-A',statement:'Pernyataan canonical pertama.',order:1},{id:'t2',code:'TP-B',statement:'Pernyataan canonical kedua.',order:2}],updatedAt:'2026-10-18'},
 atp:{id:'atp',academicSettingId:'sem',rationale:'Rasional canonical yang dipertahankan.',updatedAt:'2026-10-18',items:[
  {id:'a2',stepNumber:2,focus:'Fokus praktik lanjutan',linkedTpIds:['t2']},
  {id:'a1',stepNumber:1,focus:'Fokus eksplorasi awal',linkedTpIds:['t2','t1']},
 ]},
};
const original=JSON.stringify(context);
const projection=buildATPDocumentProjection(context);
assert(projection.isReady,projection.error);
assert.deepEqual(projection.rows.map(row=>row.stepNumber),[1,2]);
assert.deepEqual(projection.rows[0].resolvedTPs.map(tp=>tp.id),['t2','t1']);
assert.deepEqual(getATPDocumentRowCells(projection.rows[0])[1],['[TP-B] Pernyataan canonical kedua.','[TP-A] Pernyataan canonical pertama.']);
assert.equal(projection.rows[0].flowLines[0],'Fokus eksplorasi awal');
assert(projection.rows[0].flowLines.some(line=>line.includes('TP-A')) && projection.rows[0].flowLines.some(line=>line.includes('TP-B')));
assert.deepEqual(ATP_DOCUMENT_COLUMNS,['Tahap','Tujuan Pembelajaran','Alur Tujuan Pembelajaran']);
assert.deepEqual(Object.keys(projection.rows[0]).sort(),['stepNumber','focus','resolvedTPs','flowLines'].sort());
assert.deepEqual(getATPDocumentRowCells(projection.rows[0])[0],['Tahap 1']);
assert.deepEqual(projection.rows[0].flowLines,['Fokus eksplorasi awal','TP terkait: [TP-B], [TP-A]']);
assert(validateDocumentRequirements('ATP',context).isValid);
const poisoned=structuredClone(context);
for(const row of poisoned.atp.items) Object.assign(row,{tpId:'wrong',tpCode:'LEGACY_CODE_POISON',tpStatement:'LEGACY_STATEMENT_POISON',materialScope:'LEGACY_MATERIAL_POISON',unitTitle:'LEGACY_UNIT_POISON',p3Dimensions:['LEGACY_PROFILE_POISON']});
assert.deepEqual(buildATPDocumentProjection(poisoned),projection);
for(const mutate of [
 (c:any)=>c.atp.items[0].linkedTpIds=['dangling'],
 (c:any)=>c.atp.items[0].linkedTpIds=['t1','t1'],
 (c:any)=>c.tp.items.push({...c.tp.items[0],statement:'Ambiguous duplicate ID'}),
 (c:any)=>{delete c.atp.items[0].linkedTpIds;c.atp.items[0].tpId='t1';},
 (c:any)=>c.atp.items[0].stepNumber=1,
 (c:any)=>c.atp.items[0].focus=' ',
]) {
 const bad=structuredClone(context);mutate(bad);
 assert.equal(buildATPDocumentProjection(bad).isReady,false);
 assert.equal(validateDocumentRequirements('ATP',bad).isValid,false);
 await assert.rejects(()=>generateATP(bad));
 await assert.rejects(()=>generatePdfDocument('ATP',bad));
}
const docx=await generateATP(poisoned);
const xml=await (await JSZip.loadAsync(await docx.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
for(const header of ATP_DOCUMENT_COLUMNS) assert(xml.includes(header));
for(const row of projection.rows) for(const line of getATPDocumentRowCells(row).flat()) assert(xml.includes(line),line);
assert(xml.includes('w:orient="portrait"'));assert(xml.includes('w:jc w:val="both"'));
const table=xml.match(/<w:tbl>.*?<\/w:tbl>/gs)!.find(table=>table.includes('Alur Tujuan Pembelajaran'))!;
for(const line of projection.cpReferenceLines) {
 assert.equal(xml.split(line).length-1,1,'CP appears once in DOCX');
 assert(!table.includes(line),'CP excluded from matrix');
 assert(xml.indexOf(line)>xml.indexOf('B. Capaian Pembelajaran Rujukan'));
 assert(xml.indexOf(line)<xml.indexOf('C. Matriks Alur Tujuan Pembelajaran'));
}
assert(table.includes('<w:tblHeader'));
assert(table.includes('w:type="fixed"'));
assert(table.includes('<w:cantSplit/>'));
for(const row of table.match(/<w:tr>.*?<\/w:tr>/gs)!) assert.equal((row.match(/<w:tc>/g)||[]).length,3);
assert(xml.includes(context.atp.rationale));assert(xml.includes(context.school.principalName));assert(xml.includes(context.profile.name));
assert(!xml.includes('LEGACY_'));
const pdf=await generatePdfDocument('ATP',poisoned);
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const task=getDocument({data:new Uint8Array(await pdf.blob.arrayBuffer()),useSystemFonts:true});
const parsed=await task.promise;let pdfText='';
for(let index=1;index<=parsed.numPages;index++) {const content=await (await parsed.getPage(index)).getTextContent();pdfText+=' '+content.items.map((item:any)=>item.str||'').join(' ');}
const normalized=pdfText.replace(/\s+/g,' ');
for(const header of ATP_DOCUMENT_COLUMNS) assert(normalized.includes(header),header);
for(const row of projection.rows) for(const line of getATPDocumentRowCells(row).flat()) assert(normalized.includes(line.replace(/\s+/g,' ')),line);
for(const line of projection.cpReferenceLines) {
 assert.equal(normalized.split(line).length-1,1,'CP appears once in PDF');
 assert(normalized.indexOf(line)>normalized.indexOf('B. Capaian Pembelajaran Rujukan'));
 assert(normalized.indexOf(line)<normalized.indexOf('C. Matriks Alur Tujuan Pembelajaran'));
}
assert(normalized.includes(context.atp.rationale));assert(normalized.includes(context.school.principalName));
assert(!normalized.includes('LEGACY_'));
const page=await parsed.getPage(1);assert(page.view[3]>page.view[2]);await task.destroy();
assert.equal(JSON.stringify(context),original);
for(const path of ['src/services/documentEngine/generators/atpGenerator.ts','src/services/documentEngine/renderers/pdf/pdfDocGenerators.ts']) {
 const source=readFileSync(path,'utf8');assert(source.includes('buildATPDocumentProjection(context)'));
}
const blank={...context,documentMode:'blank',cp:undefined,tp:undefined,atp:undefined};
assert(buildATPDocumentProjection(blank).isReady);
assert((await generateATP(blank)).blob!.size>0);assert((await generatePdfDocument('ATP',blank)).blob.size>0);
console.log('PASS: exact 1-to-many TP resolution, canonical focus stages, dangling/duplicate/ambiguous rejection, empty/poisoned legacy fields, 3-column portrait DOCX with non-splitting rows, and shared DOCX/PDF projection content.');

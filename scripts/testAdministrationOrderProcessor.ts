import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { processAdministrationOrder, type AdministrationOrderInput } from '../server/administrationOrderProcessor';
import { prepareCompleteAdministrationProjectImport } from '../src/services/administrationProjectImportService';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { assertProductionDocumentFile } from '../src/services/productionValidation';
import { computeAtpSubstantiveFingerprint } from '../src/services/atpMappingActionApplyService';
import { createInitialStorageV5 } from '../src/services/storageV5';
import { createTwoSemesterAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';

const source = createTwoSemesterAdministrationImportFixture();
const atpSource = source.annualData.atp[0].value;
for (const item of atpSource.items) item.unitTitle = 'Gerak manipulatif';
source.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint = computeAtpSubstantiveFingerprint(atpSource);
const zip = await createCompleteProjectZip(source, 'y');
const archive = await readCompleteProjectZip(zip);
const customer = {
  teacher: { name: 'GURU_PELANGGAN_ALFA', nip: '555555555555555555', status: 'PNS' as const },
  school: {
    name: 'SEKOLAH_PELANGGAN_ALFA', npsn: '55555555', address: 'ALAMAT_PELANGGAN_ALFA',
    village: 'Desa Alfa', district: 'Kecamatan Alfa', regency: 'Kota Alfa', province: 'Provinsi Alfa',
    principalName: 'KEPSEK_PELANGGAN_ALFA', principalNip: '666666666666666666',
  },
  documentDate: '2026-10-28',
} satisfies AdministrationOrderInput['customer'];

test('arsip ZIP V22 dan relasi CP → TP → ATP tetap valid', async () => {
  assert.equal(archive.schemaVersion, '2.0');
  const state = createInitialStorageV5();
  state.profiles.push(source.profiles[1]);
  state.schools.push(source.schools[1]);
  const imported = prepareCompleteAdministrationProjectImport(state, archive, {
    mode: 'IDENTITY_ONLY', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: customer.documentDate,
  });
  const { cp, cpAnalysis, tp, atp } = imported.state.annualData;
  assert.equal(cpAnalysis[0].value.cpId, cp[0].value.id);
  assert.equal(tp[0].value.cpId, cp[0].value.id);
  assert.equal(tp[0].value.cpAnalysisId, cpAnalysis[0].value.id);
  assert.equal(atp[0].value.tpDataId, tp[0].value.id);
  assert.deepEqual(atp[0].value.items[0].linkedTpIds, [tp[0].value.items[0].id]);
  assert.equal(cp[0].value.generalDescription, source.annualData.cp[0].value.generalDescription);
  assert.deepEqual(tp[0].value.items.map(item => item.statement), source.annualData.tp[0].value.items.map(item => item.statement));
  assert.deepEqual(atp[0].value.items.map(item => item.focus), source.annualData.atp[0].value.items.map(item => item.focus));
  assert.deepEqual(imported.state.semesterData.learningMeetingSchedules!.map(e => e.value.entries.map(s => [s.date, s.jp])),
    source.semesterData.learningMeetingSchedules!.map(e => e.value.entries.map(s => [s.date, s.jp])));
  assert.deepEqual(imported.state.semesterData.assessmentPackage.map(e => e.value.flatMap(pkg =>
    pkg.instruments.flatMap(instrument => 'items' in instrument ? instrument.items.map(item => item.prompt) : []))),
  source.semesterData.assessmentPackage.map(e => e.value.flatMap(pkg =>
    pkg.instruments.flatMap(instrument => 'items' in instrument ? instrument.items.map(item => item.prompt) : []))));
});

test('menolak ZIP rusak, schema salah, dan referensi yatim', async () => {
  const wrongSchema = { ...archive, schemaVersion: '1.0' } as unknown as typeof archive;
  const badGraph = structuredClone(archive);
  badGraph.project.annualData.tp[0].value.cpId = 'cp-missing';
  for (const project of [new Uint8Array([1, 2, 3]), wrongSchema, badGraph]) {
    const result = await processAdministrationOrder({ project, customer });
    assert.equal(result.success, false);
    assert(!('zip' in result));
    assert(result.validation.findings.some(finding => finding.stage === 'IMPORT'));
  }
  const extraEntry = await new JSZip().file('project.json', JSON.stringify(archive)).file('extra.txt', 'extra')
    .generateAsync({ type: 'uint8array' });
  const result = await processAdministrationOrder({ project: extraEntry, customer });
  assert(!result.success && result.validation.findings.some(f => f.problem.includes('satu project.json')));
});

function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match=>{try{return inflateSync(Buffer.from(match[1],'latin1')).toString('latin1');}catch{return '';}}).join(' ');
  return [...streams.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map(match=>match[1].replace(/\\([()\\])/g,'$1')).join('');
}

test('dua pelanggan paralel mendapat ZIP PDF/DOCX dengan identitas masing-masing dan tanpa akses storage', async () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof document, 'undefined');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('localStorage diakses'); } });
  const other = {
    ...customer,
    teacher: { ...customer.teacher, name: 'GURU_PELANGGAN_BETA', nip: '777777777777777777' },
    school: { ...customer.school, name: 'SEKOLAH_PELANGGAN_BETA', npsn: '77777777' },
  };
  const before = JSON.stringify(archive);
  try {
    const results = await Promise.all([
      processAdministrationOrder({ project: zip, customer }),
      processAdministrationOrder({ project: archive, customer: other }),
    ]);
    for (const [i, result] of results.entries()) {
      assert(result.success, JSON.stringify(result.validation));
      const expected = i === 0 ? customer : other;
      const unexpected = i === 0 ? other : customer;
      const output = await JSZip.loadAsync(result.zip, { checkCRC32: true });
      const paths = Object.values(output.files).filter(entry => !entry.dir && /[.](pdf|docx)$/.test(entry.name));
      assert.equal(paths.length, 40, '20 dokumen masing-masing dalam PDF dan DOCX');
      for (const format of ['pdf', 'docx'] as const) {
        const entries = paths.filter(entry => entry.name.endsWith('.' + format));
        assert.equal(entries.length, result.validation.documents.length);
        assert(entries.some(entry => entry.name.includes('Semester_1/')));
        assert(entries.some(entry => entry.name.includes('Semester_2/')));
        const bodies: string[] = [];
        for (const entry of entries) {
          const bytes = await entry.async('uint8array');
          await assertProductionDocumentFile(bytes, format);
          const body = format === 'pdf' ? pdfText(bytes)
            : (await Promise.all(Object.values((await JSZip.loadAsync(bytes)).files)
              .filter(part => !part.dir && part.name.endsWith('.xml')).map(part => part.async('string')))).join(' ');
          assert(body.length, entry.name);
          bodies.push(entry.name, body);
        }
        const body = bodies.join(' ');
        for (const identity of [expected.teacher.name, expected.teacher.nip, expected.school.name, expected.school.npsn,
          expected.school.principalName, expected.school.principalNip])
          assert(body.includes(identity), format + ' ' + identity);
        for (const old of ['GURU_ASAL_TEST', 'SEKOLAH_ASAL_TEST', 'ALAMAT_ASAL_TEST', 'KEPSEK_ASAL_TEST', '11111111',
          '222222222222222222', 'MURID_ASAL', 'HASIL_ASAL', unexpected.teacher.name, unexpected.school.name])
          assert(!body.includes(old), format + ' ' + old);
      }
      assert.deepEqual(result.validation.excludedDocumentTypes, ['DAFTAR_HADIR', 'DAFTAR_NILAI', 'REMEDIAL_PENGAYAAN']);
    }
    assert.equal(JSON.stringify(archive), before);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('identitas lama dalam substansi memblokir pesanan', async () => {
  const project = structuredClone(archive);
  project.project.annualData.cp[0].value.generalDescription += ' GURU_ASAL_TEST';
  const result = await processAdministrationOrder({ project, customer });
  assert(!result.success && !('zip' in result));
  assert(result.validation.findings.some(finding => finding.object === 'Identitas sumber'));
});

test('dokumen wajib yang belum lengkap memblokir paket', async () => {
  const project = structuredClone(archive);
  const atp = project.project.annualData.atp[0].value;
  for (const item of atp.items) item.unitTitle = '';
  project.project.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint = computeAtpSubstantiveFingerprint(atp);
  const result = await processAdministrationOrder({ project, customer });
  assert(!result.success && !('zip' in result));
  assert(result.validation.documents.some(item => item.type === 'PEMETAAN_ATP_UNIT' && item.status === 'SKIPPED'));
});

test('gagal menulis satu format menghasilkan PARTIAL dan tanpa ZIP pesanan', async (t) => {
  const read = Blob.prototype.arrayBuffer;
  let fail = true;
  t.mock.method(Blob.prototype, 'arrayBuffer', async function (this: Blob) {
    if (fail && this.type === 'application/pdf') {
      fail = false;
      throw new Error('Simulasi kegagalan serialisasi PDF');
    }
    return read.call(this);
  });
  const result = await processAdministrationOrder({ project: archive, customer });
  assert(!result.success && !('zip' in result));
  assert(result.validation.documents.some(item => item.status === 'PARTIAL' && item.reason?.includes('Simulasi')));
});

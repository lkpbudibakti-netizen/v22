import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { orderZipContainsSourceIdentity } from '../server/administrationOrderZipIdentity';
import { processAdministrationOrder, type AdministrationOrderInput } from '../server/administrationOrderProcessor';
import { prepareCompleteAdministrationProjectImport } from '../src/services/administrationProjectImportService';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { assertProductionDocumentFile } from '../src/services/productionValidation';
import { computeAtpSubstantiveFingerprint } from '../src/services/atpMappingActionApplyService';
import { generateZipBundle, validateDocumentRequirements } from '../src/services/documentEngine';
import { sourceIdentityExportIssue } from '../src/services/documentEngine/sourceIdentityGuard';
import { generateImportedProductionPackage, importedProjectExportReadiness } from '../src/services/identityOnlyProjectExport';
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

test('impor produksi dan endpoint mempertahankan jadwal yang memakai JP tahunan', async () => {
  const project = structuredClone(archive);
  project.project.annualJPReferences = [{ yearPlanId: project.project.yearPlans[0].id,
    value: { officialAnnualJP: null, referenceWeeklyEquivalentJP: 2 } }];
  project.project.semesterJPSettings = [];
  const atp = project.project.annualData.atp[0].value;
  for (const item of atp.items) delete item.unitTitle;
  project.project.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint = computeAtpSubstantiveFingerprint(atp);
  const state = createInitialStorageV5();
  state.profiles.push(source.profiles[1]);
  state.schools.push(source.schools[1]);
  const imported = prepareCompleteAdministrationProjectImport(state, project, {
    mode: 'IDENTITY_ONLY', workMode: 'production', targetProfileId: 'p2', targetSchoolId: 's2',
    documentDate: customer.documentDate,
  });
  const readiness = importedProjectExportReadiness(imported.state, imported.yearPlanId, 'production');
  const target = imported.state;
  for (const key of ['cp', 'cpAnalysis', 'tp', 'atp'] as const) {
    assert.equal(target.annualData[key][0].value.workflowStatus, project.project.annualData[key][0].value.workflowStatus);
    assert.equal(target.annualData[key][0].value.updatedAt, project.project.annualData[key][0].value.updatedAt);
  }
  const mapping = target.annualData.atpUnitMappings![0].value;
  assert.equal(mapping.basedOnAtpFingerprint, computeAtpSubstantiveFingerprint(target.annualData.atp[0].value));
  assert.deepEqual(mapping.units.map(unit => [unit.title, unit.materials.map(material => material.title)]),
    project.project.annualData.atpUnitMappings![0].value.units.map(unit => [unit.title, unit.materials.map(material => material.title)]));
  const meetings = target.annualData.unitExecutionPlans![0].value.units.flatMap(unit => unit.meetings);
  for (const [index, scope] of target.semesterData.learningMeetingSchedules!.entries()) {
    const original = project.project.semesterData.learningMeetingSchedules![index].value;
    assert.equal(scope.value.status, 'COMPLETE');
    assert.deepEqual(scope.value.entries.map(entry => [entry.date, entry.jp]), original.entries.map(entry => [entry.date, entry.jp]));
    const plan = target.semesterData.learningPlan.find(item => item.semesterPlanId === scope.semesterPlanId)!.value[0];
    assert.equal(plan.status, 'SIAP');
    assert.deepEqual(plan.learningMeetingIds, scope.value.entries.map(entry => entry.meetingId));
    for (const entry of scope.value.entries) {
      assert(meetings.some(meeting => meeting.id === entry.meetingId && meeting.unitId === entry.unitId));
      assert.equal(entry.sourceSlotId, `subject-slot:${scope.semesterPlanId}:${entry.sessionId}:${entry.date}`);
    }
  }
  for (const type of ['PEMETAAN_ATP_UNIT', 'PROTA', 'PROMES', 'MODUL_AJAR', 'ASESMEN', 'JURNAL'] as const) {
    const rows = readiness.rows.filter(row => row.type === type);
    assert(rows.length && rows.every(row => row.ready), JSON.stringify(rows));
  }
  const result = await processAdministrationOrder({ project, customer });
  assert(result.success, JSON.stringify(result.validation));
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
  assert.equal(typeof FileReader, 'undefined');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('localStorage diakses'); } });
  const other = {
    ...customer,
    teacher: { ...customer.teacher, name: 'GURU_PELANGGAN_BETA', nip: '777777777777777777' },
    school: { ...customer.school, name: 'SEKOLAH_PELANGGAN_BETA', npsn: '77777777' },
  };
  const before = JSON.stringify(archive);
  const withMetadata = structuredClone(archive);
  withMetadata.project.annualData.cp[0].value.source!.id = 'GURU_ASAL_TEST';
  try {
    const results = await Promise.all([
      processAdministrationOrder({ project: zip, customer }),
      processAdministrationOrder({ project: withMetadata, customer: other }),
    ]);
    for (const [i, result] of results.entries()) {
      assert(result.success, JSON.stringify(result.validation));
      assert.equal(result.validation.documents.length, 22);
      assert(result.validation.documents.every(item => item.status === 'SUCCESS' && item.filesGenerated?.length === 2));
      const expected = i === 0 ? customer : other;
      const unexpected = i === 0 ? other : customer;
      const output = await JSZip.loadAsync(result.zip, { checkCRC32: true });
      const paths = Object.values(output.files).filter(entry => !entry.dir && /[.](pdf|docx)$/.test(entry.name));
      assert.equal(paths.length, 44, '22 dokumen masing-masing dalam PDF dan DOCX');
      assert.equal(result.validation.documents.filter(item => item.type === 'RPM').length, 2);
      assert.equal(result.validation.documents.filter(item => item.type === 'MODUL_AJAR').length, 2);
      assert(paths.every(entry => entry.name.endsWith('.pdf') ? entry.name.includes('/PDF/') : entry.name.includes('/WORD/')));
      for (const format of ['pdf', 'docx'] as const) {
        const entries = paths.filter(entry => entry.name.endsWith('.' + format));
        assert.equal(entries.length, result.validation.documents.length);
        assert(entries.some(entry => entry.name.includes('Semester_1/')));
        assert(entries.some(entry => entry.name.includes('Semester_2/')));
        if (i === 0) {
          const singleFormat = new JSZip();
          for (const entry of entries) singleFormat.file(entry.name, await entry.async('uint8array'));
          const formatZip = await singleFormat.generateAsync({ type: 'uint8array' });
          assert(await orderZipContainsSourceIdentity(formatZip, [expected.school.name]), format);
        }
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
  assert(result.validation.findings.some(finding => finding.problem.includes('identitas asal')));
});

test('identitas di metadata yang tercetak tetap memblokir paket', async () => {
  const project = structuredClone(archive);
  project.project.annualData.cp[0].value.source!.title = 'SEKOLAH_ASAL_TEST';
  const result = await processAdministrationOrder({ project, customer });
  assert(!result.success && !('zip' in result));
  assert(result.validation.findings.some(finding => finding.stage === 'ZIP' && finding.object === 'Identitas sumber'),
    JSON.stringify(result.validation));
});

test('paket core melalui jalur UI dan endpoint ekuivalen walau asesmen belum ada dan timestamp berbeda', async () => {
  const project = structuredClone(archive);
  const original = project.project.semesterData.learningMeetingSchedules![0].value;
  original.basedOnSubjectWeeklyScheduleUpdatedAt = '2025-01-01T00:00:00Z';
  project.project.semesterData.assessmentPackage = [];
  const state = createInitialStorageV5();
  state.profiles.push({ ...source.profiles[1], ...customer.teacher });
  state.schools.push({ ...source.schools[1], ...customer.school });
  const prepared = prepareCompleteAdministrationProjectImport(state, project, {
    mode: 'IDENTITY_ONLY', workMode: 'production', targetProfileId: 'p2', targetSchoolId: 's2',
    documentDate: customer.documentDate,
  });
  const target = prepared.state.semesterData.learningMeetingSchedules![0].value;
  assert.equal(target.basedOnSubjectWeeklyScheduleUpdatedAt, original.basedOnSubjectWeeklyScheduleUpdatedAt);
  assert.deepEqual(target.entries.map(entry => [entry.date, entry.jp]), original.entries.map(entry => [entry.date, entry.jp]));
  assert.deepEqual(prepared.state.semesterData.learningPlan[0].value[0].learningMeetingIds, target.entries.map(entry => entry.meetingId));

  const [manual, order] = await Promise.all([
    generateImportedProductionPackage(prepared.state, prepared.yearPlanId, {
      scope: 'core', containsSourceIdentity: orderZipContainsSourceIdentity,
    }),
    processAdministrationOrder({ project, customer, packageScope: 'core' }),
  ]);
  assert(order.success, JSON.stringify(order.validation));
  assert(manual.exportGenerated && manual.exportCompleteForRequestedScope && manual.orderFulfillable);
  assert(order.validation.excludedDocumentTypes.includes('ASESMEN'));
  assert(!order.validation.documents.some(item => item.type === 'ASESMEN'));
  assert(order.validation.findings.some(item => item.classification === 'WARNING' && item.problem.includes('Timestamp jadwal')));
  const statuses = (documents: typeof manual.documents) => documents.map(({ type, status, filesGenerated }) => [type, status, filesGenerated]);
  assert.deepEqual(statuses(manual.documents), statuses(order.validation.documents));
  const [uiZip, orderZip] = await Promise.all([JSZip.loadAsync(manual.zip), JSZip.loadAsync(order.zip)]);
  assert.deepEqual(Object.keys(uiZip.files).sort(), Object.keys(orderZip.files).sort());
  assert(await orderZipContainsSourceIdentity(order.zip, [customer.school.name]));
  assert(!(await orderZipContainsSourceIdentity(order.zip, [source.schools[0].name])));
  const report = Object.values(orderZip.files).find(entry => entry.name.endsWith('/Laporan_Ekspor.txt'));
  assert.match(await report!.async('string'), /WARNING.*Timestamp jadwal/);

  const completeOrder = await processAdministrationOrder({ project, customer });
  assert(!completeOrder.success && !('zip' in completeOrder));
  assert(completeOrder.validation.exportGenerated && !completeOrder.validation.orderFulfillable);
  assert(completeOrder.validation.documents.some(item => item.type === 'ASESMEN' && item.status === 'SKIPPED'));
});

test('jadwal sumber berubah substantif dan dilaporkan pada ZIP manual dan memblokir pesanan', async () => {
  const project = structuredClone(archive);
  project.project.semesterData.learningMeetingSchedules![0].value.basedOnSubjectWeeklyScheduleUpdatedAt = '2025-01-01T00:00:00Z';
  project.project.semesterData.learningMeetingSchedules![0].value.entries[0].jp = 1;
  project.project.semesterData.learningMeetingSchedules![0].value.basedOnWeeklyJP = 3;
  const state = createInitialStorageV5();
  state.profiles.push(source.profiles[1]);
  state.schools.push(source.schools[1]);
  const options = { mode: 'IDENTITY_ONLY', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: customer.documentDate } as const;
  const imported = prepareCompleteAdministrationProjectImport(state, project, { ...options, workMode: 'production' });
  assert(imported.warnings.some(warning => warning.includes('Jadwal stale')));
  assert.equal(imported.state.semesterData.learningMeetingSchedules![0].value.status, 'COMPLETE');
  const authoring = prepareCompleteAdministrationProjectImport(state, project, { ...options, workMode: 'authoring' });
  assert.equal(authoring.state.semesterData.learningMeetingSchedules![0].value.status, 'DRAFT');

  const readiness = importedProjectExportReadiness(imported.state, imported.yearPlanId, 'production');
  const manual = await generateZipBundle({ types: ['CP', 'PROMES'], format: 'both', documentMode: 'data' }, readiness.context);
  assert(!manual.isComplete && manual.zipBlob);
  assert(manual.itemResults?.some(item => item.type === 'PROMES' && item.status === 'SKIPPED'));
  const output = await JSZip.loadAsync(await manual.zipBlob.arrayBuffer());
  const report = Object.values(output.files).find(entry => entry.name.endsWith('/Laporan_Ekspor.txt'));
  assert.match(await report!.async('string'), /TIDAK LENGKAP[\s\S]*Jadwal stale/);

  const result = await processAdministrationOrder({ project, customer });
  assert(!result.success && !('zip' in result));
  assert(result.validation.documents.some(item => item.type === 'CP' && item.status === 'SUCCESS'));
  assert(result.validation.documents.some(item => item.type === 'PROMES' && item.status === 'SKIPPED' && item.reason?.includes('Jadwal stale')));
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

test('endpoint internal autentikasi, validasi, dan hanya mengirim ZIP lengkap', async (t) => {
  const { app } = await import('../server');
  const secret = 'integration-test-token';
  const original = process.env.V22_ORDER_PROCESSOR_TOKEN;
  process.env.V22_ORDER_PROCESSOR_TOKEN = secret;
  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    if (original === undefined) delete process.env.V22_ORDER_PROCESSOR_TOKEN;
    else process.env.V22_ORDER_PROCESSOR_TOKEN = original;
    server.closeAllConnections();
    return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = 'http://127.0.0.1:' + address.port + '/api/internal/administration-orders/process';
  const body = { projectZipBase64: Buffer.from(zip).toString('base64'), customer };
  const send = (payload: unknown, token?: string) => fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(payload),
  });
  const expectJsonFailure = async (response: Response, status: number) => {
    assert.equal(response.status, status, await response.clone().text());
    assert.match(response.headers.get('content-type') || '', /^application\/json/);
    assert.equal(response.headers.get('content-disposition'), null);
    const error = await response.json();
    assert.equal(error.success, false);
    return error;
  };
  await expectJsonFailure(await send(body), 401);
  await expectJsonFailure(await send(body, 'wrong-token'), 401);
  await expectJsonFailure(await send({ ...body, packageScope: 'unknown' }, secret), 400);
  await expectJsonFailure(await send({ ...body, projectZipBase64: '!!!' }, secret), 400);
  await expectJsonFailure(await send({ ...body, customer: { ...customer, documentDate: '2026-02-30' } }, secret), 400);
  await expectJsonFailure(await send({ ...body, projectZipBase64: 'UEsDBA==' }, secret), 400);
  await expectJsonFailure(await send({ ...body, projectZipBase64: 'A'.repeat(12 * 1024 * 1024) }, secret), 413);
  await expectJsonFailure(await send({ ...body, projectZipBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }, secret), 413);

  const response = await send(body, secret);
  assert.equal(response.status, 200, response.ok ? undefined : await response.clone().text());
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.match(response.headers.get('content-disposition') || '', /^attachment;.*\.zip/i);
  const output = await JSZip.loadAsync(await response.arrayBuffer(), { checkCRC32: true });
  const files = Object.values(output.files).filter(entry => !entry.dir);
  assert.equal(files.filter(entry => entry.name.endsWith('.pdf')).length, 22);
  assert.equal(files.filter(entry => entry.name.endsWith('.docx')).length, 22);

  const originalArrayBuffer = Blob.prototype.arrayBuffer;
  let failNextPdf = true;
  const rendererFailure = t.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) {
    if (failNextPdf && this.type === 'application/pdf') {
      failNextPdf = false;
      throw new Error('Simulasi kegagalan ekspor HTTP');
    }
    return originalArrayBuffer.call(this);
  });
  try {
    const error = await expectJsonFailure(await send(body, secret), 422);
    assert(error.validation.documents.some(item => item.status === 'PARTIAL'));
  } finally {
    rendererFailure.mock.restore();
  }
});

function createSixUnitRegionalCalendarProject() {
  const baseSource = createTwoSemesterAdministrationImportFixture();
  const baseAtp = baseSource.annualData.atp[0].value;
  for (const item of baseAtp.items) item.unitTitle = 'Gerak manipulatif';
  baseSource.annualData.atpUnitMappings![0].value.basedOnAtpFingerprint = computeAtpSubstantiveFingerprint(baseAtp);

  // Realistic source regional identity + internal calendar metadata (without claiming SD_PJOK_1.zip itself).
  Object.assign(baseSource.schools[0], {
    village: 'Merdeka',
    district: 'Kec. Sukajadi',
    regency: 'Kota Bandung',
    province: 'Jawa Barat',
  });

  const mapping = baseSource.annualData.atpUnitMappings![0].value;
  const execution = baseSource.annualData.unitExecutionPlans![0].value;
  const sem1Dates = ['2026-08-03', '2026-08-10', '2026-08-17'];
  const sem2Dates = ['2027-01-04', '2027-01-11', '2027-01-18'];
  const templateUnit = structuredClone(mapping.units[0]);
  const templateExec = structuredClone(execution.units[0]);
  const templatePlanS1 = structuredClone(baseSource.semesterData.learningPlan.find(e => e.semesterPlanId === 'sp1')!.value[0]);
  const templatePlanS2 = structuredClone(baseSource.semesterData.learningPlan.find(e => e.semesterPlanId === 'sp2')!.value[0]);
  const templateEntryS1 = structuredClone(baseSource.semesterData.learningMeetingSchedules!.find(e => e.semesterPlanId === 'sp1')!.value.entries[0]);
  const templateEntryS2 = structuredClone(baseSource.semesterData.learningMeetingSchedules!.find(e => e.semesterPlanId === 'sp2')!.value.entries[0]);

  mapping.units = [];
  execution.units = [];
  const sem1Plans: any[] = [];
  const sem2Plans: any[] = [];
  const sem1Entries: any[] = [];
  const sem2Entries: any[] = [];

  for (let i = 0; i < 6; i++) {
    const order = i + 1;
    const isSem1 = i < 3;
    const localIdx = isSem1 ? i : i - 3;
    const unitId = `u-${order}`;
    const matId = `m-${order}`;
    const meetId = `meet-${order}`;
    const planId = `lp-${order}`;
    const spId = isSem1 ? 'sp1' : 'sp2';
    const date = (isSem1 ? sem1Dates : sem2Dates)[localIdx];

    const u = structuredClone(templateUnit);
    u.id = unitId;
    u.order = order;
    u.title = `Bab ${order} Gerak Manipulatif`;
    u.materials[0].id = matId;
    u.materials[0].title = `Materi ${order}`;
    mapping.units.push(u);

    const ex = structuredClone(templateExec);
    ex.unitId = unitId;
    ex.meetings[0].id = meetId;
    ex.meetings[0].unitId = unitId;
    ex.meetings[0].materialIds = [matId];
    execution.units.push(ex);

    const plan = structuredClone(isSem1 ? templatePlanS1 : templatePlanS2);
    plan.id = planId;
    plan.academicSettingId = spId;
    plan.unitId = unitId;
    plan.title = `Modul Bab ${order}`;
    plan.learningMeetingIds = [meetId];
    for (const stepList of Object.values(plan.learningSteps || {}) as any[][]) {
      if (Array.isArray(stepList)) for (const step of stepList) if (step.learningMeetingId) step.learningMeetingId = meetId;
    }
    for (const rows of Object.values(plan.assessmentPlan) as any[][]) {
      for (const row of rows) if (row.learningMeetingId) row.learningMeetingId = meetId;
    }
    (isSem1 ? sem1Plans : sem2Plans).push(plan);

    const entry = structuredClone(isSem1 ? templateEntryS1 : templateEntryS2);
    entry.meetingId = meetId;
    entry.unitId = unitId;
    entry.semesterPlanId = spId;
    entry.date = date;
    entry.weekIndex = localIdx + 1;
    entry.sourceSlotId = `subject-slot:${spId}:${entry.sessionId}:${date}`;
    (isSem1 ? sem1Entries : sem2Entries).push(entry);
  }

  execution.semesterPlacement = { mode: 'CONTIGUOUS_BOUNDARY', semester1LastUnitId: 'u-3', updatedAt: execution.updatedAt };
  baseSource.semesterData.learningPlan.find(e => e.semesterPlanId === 'sp1')!.value = sem1Plans;
  baseSource.semesterData.learningPlan.find(e => e.semesterPlanId === 'sp2')!.value = sem2Plans;
  baseSource.semesterData.learningMeetingSchedules!.find(e => e.semesterPlanId === 'sp1')!.value.entries = sem1Entries;
  baseSource.semesterData.learningMeetingSchedules!.find(e => e.semesterPlanId === 'sp2')!.value.entries = sem2Entries;
  baseSource.semesterData.assessmentPlan.find(e => e.semesterPlanId === 'sp1')!.value[0].learningPlanIds = ['lp-1'];
  baseSource.semesterData.assessmentPlan.find(e => e.semesterPlanId === 'sp2')!.value[0].learningPlanIds = ['lp-4'];
  baseSource.semesterData.journalRealizations.find(e => e.semesterPlanId === 'sp1')!.value[0].meetingId = 'meet-1';
  baseSource.semesterData.journalRealizations.find(e => e.semesterPlanId === 'sp2')!.value[0].meetingId = 'meet-4';

  const cal1 = baseSource.semesterData.academicCalendar.find(e => e.semesterPlanId === 'sp1')!.value;
  const cal2 = baseSource.semesterData.academicCalendar.find(e => e.semesterPlanId === 'sp2')!.value;
  Object.assign(cal1.calendar, {
    startDate: '2026-08-03', endDate: '2026-08-21',
    sourceRegion: 'Jawa Barat',
    sourceName: 'Kalender Pendidikan Jawa Barat — SEKOLAH_ASAL_TEST',
    sourceAuthority: 'Dinas Pendidikan Provinsi Jawa Barat (SEKOLAH_ASAL_TEST)',
    sourceReference: 'SK Kalender SEKOLAH_ASAL_TEST / GURU_ASAL_TEST',
    overrideReason: 'Penyesuaian internal SEKOLAH_ASAL_TEST',
    notes: 'Metadata internal SEKOLAH_ASAL_TEST',
    overrides: [{ id: 'ov-1', date: '2026-08-18', previousStatus: 'EFFECTIVE_LEARNING', newStatus: 'HOLIDAY', reason: 'Internal SEKOLAH_ASAL_TEST', overriddenAt: '2026-01-01T00:00:00Z' }],
  });
  const buildWeekdays = (start: string, end: string, calendarId: string, overridesByDate: Record<string, { status: 'EFFECTIVE_LEARNING' | 'HOLIDAY' | 'SCHOOL_EVENT'; notes: string; sourceName?: string; sourceAuthority?: string; overrideReason?: string }>) => {
    const days: any[] = [];
    for (let cur = new Date(start + 'T00:00:00Z'), last = new Date(end + 'T00:00:00Z'), idx = 0; cur <= last; cur.setUTCDate(cur.getUTCDate() + 1), idx++) {
      const dow = cur.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const date = cur.toISOString().slice(0, 10);
      const custom = overridesByDate[date];
      days.push({
        id: `${calendarId}-d-${idx}`,
        academicCalendarId: calendarId,
        date,
        status: custom?.status || 'EFFECTIVE_LEARNING',
        notes: custom?.notes || 'Hari Pembelajaran Reguler Kota Bandung',
        ...(custom?.sourceName ? { sourceName: custom.sourceName } : { sourceName: 'Kalender Pendidikan SEKOLAH_ASAL_TEST' }),
        ...(custom?.sourceAuthority ? { sourceAuthority: custom.sourceAuthority } : {}),
        ...(custom?.overrideReason ? { overrideReason: custom.overrideReason } : {}),
      });
    }
    return days;
  };
  cal1.days = buildWeekdays('2026-08-03', '2026-08-21', cal1.calendar.id, {
    '2026-08-03': { status: 'EFFECTIVE_LEARNING', notes: 'Pembukaan Semester 1 Provinsi Jawa Barat', sourceName: 'Kalender Pendidikan SEKOLAH_ASAL_TEST', sourceAuthority: 'Dinas Pendidikan Kota Bandung — SEKOLAH_ASAL_TEST', overrideReason: 'Internal SEKOLAH_ASAL_TEST' },
    '2026-08-18': { status: 'HOLIDAY', notes: 'Libur Daerah Jawa Barat & Hari Jadi Desa Merdeka', sourceName: 'SEKOLAH_ASAL_TEST' },
  });
  Object.assign(cal2.calendar, {
    startDate: '2027-01-04', endDate: '2027-01-22',
    sourceRegion: 'Jawa Barat',
    sourceName: 'Kalender Pendidikan Kota Bandung — SEKOLAH_ASAL_TEST',
    sourceAuthority: 'Dinas Pendidikan Jawa Barat',
    sourceReference: 'Lampiran SEKOLAH_ASAL_TEST',
  });
  cal2.days = buildWeekdays('2027-01-04', '2027-01-22', cal2.calendar.id, {
    '2027-01-04': { status: 'EFFECTIVE_LEARNING', notes: 'Hari Efektif Awal Semester 2 Kec. Sukajadi', sourceName: 'Kalender SEKOLAH_ASAL_TEST' },
    '2027-01-19': { status: 'SCHOOL_EVENT', notes: 'Kegiatan Bersama Tingkat Jawa Barat' },
  });
  return baseSource;
}

test('validasi identitas kalender: metadata internal & wilayah umum lolos, agenda/PDF/DOCX identitas asal tetap diblokir, core 6+6 konsisten UI dan HTTP', async (t) => {
  const projectState = createSixUnitRegionalCalendarProject();
  const projectZip = await createCompleteProjectZip(projectState, 'y');
  const projectArchive = await readCompleteProjectZip(projectZip);

  // 1, 3, 4, 6, 7, 8, 9, 10: Metadata internal & nama wilayah umum lolos; 2 kalender + 6 Modul Ajar + 6 RPM sukses di UI, processor, dan HTTP endpoint.
  const uiState = createInitialStorageV5();
  uiState.profiles.push({ ...projectState.profiles[1], ...customer.teacher });
  uiState.schools.push({ ...projectState.schools[1], ...customer.school });
  const imported = prepareCompleteAdministrationProjectImport(uiState, projectArchive, {
    mode: 'IDENTITY_ONLY', workMode: 'production', targetProfileId: 'p2', targetSchoolId: 's2', documentDate: customer.documentDate,
  });
  const tokens = imported.state.yearPlans.find(y => y.id === imported.yearPlanId)!.identityOnlyImport!.sourceIdentityTokens!;
  for (const specific of ['GURU_ASAL_TEST', 'SEKOLAH_ASAL_TEST', '11111111', 'KEPSEK_ASAL_TEST']) assert(tokens.includes(specific));
  for (const region of ['Merdeka', 'Kec. Sukajadi', 'Kota Bandung', 'Jawa Barat']) assert(!tokens.includes(region));

  const [uiPkg, procRes] = await Promise.all([
    generateImportedProductionPackage(imported.state, imported.yearPlanId, {
      scope: 'core', containsSourceIdentity: orderZipContainsSourceIdentity,
    }),
    processAdministrationOrder({ project: projectZip, customer, packageScope: 'core' }),
  ]);
  assert(procRes.success, JSON.stringify(procRes.validation));
  assert(uiPkg.exportCompleteForRequestedScope && uiPkg.orderFulfillable);
  assert(procRes.validation.exportCompleteForRequestedScope && procRes.validation.orderFulfillable);
  assert.equal(procRes.validation.documents.filter(d => d.type === 'KALENDER_AKADEMIK' && d.status === 'SUCCESS').length, 2);
  assert.equal(procRes.validation.documents.filter(d => d.type === 'MODUL_AJAR' && d.status === 'SUCCESS').length, 6);
  assert.equal(procRes.validation.documents.filter(d => d.type === 'RPM' && d.status === 'SUCCESS').length, 6);

  const statuses = (docs: typeof uiPkg.documents) => docs.map(({ type, status, filesGenerated }) => [type, status, filesGenerated]);
  assert.deepEqual(statuses(uiPkg.documents), statuses(procRes.validation.documents));
  const [uiZipObj, procZipObj] = await Promise.all([JSZip.loadAsync(uiPkg.zip, { checkCRC32: true }), JSZip.loadAsync(procRes.zip, { checkCRC32: true })]);
  assert.deepEqual(Object.keys(uiZipObj.files).sort(), Object.keys(procZipObj.files).sort());

  const calEntries = Object.values(procZipObj.files).filter(entry => !entry.dir && /Kalender_Pendidikan/.test(entry.name));
  assert.equal(calEntries.length, 4, '2 semester kalender x (PDF + DOCX)');
  assert.equal(calEntries.filter(entry => entry.name.includes('/PDF/') && entry.name.endsWith('.pdf')).length, 2);
  assert.equal(calEntries.filter(entry => entry.name.includes('/WORD/') && entry.name.endsWith('.docx')).length, 2);
  for (const entry of calEntries) {
    const bytes = await entry.async('uint8array');
    const body = entry.name.endsWith('.pdf')
      ? pdfText(bytes)
      : (await Promise.all(Object.values((await JSZip.loadAsync(bytes)).files).filter(p => !p.dir && p.name.endsWith('.xml')).map(p => p.async('string')))).join(' ');
    assert(body.includes(customer.school.name) && body.includes(customer.teacher.name), entry.name);
    assert(!body.includes('SEKOLAH_ASAL_TEST') && !body.includes('GURU_ASAL_TEST'), entry.name);
  }

  // Verify HTTP endpoint returns consistent ZIP with core 6+6 and both calendars.
  const { app } = await import('../server');
  const secret = 'calendar-regression-token';
  const prevSecret = process.env.V22_ORDER_PROCESSOR_TOKEN;
  process.env.V22_ORDER_PROCESSOR_TOKEN = secret;
  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    if (prevSecret === undefined) delete process.env.V22_ORDER_PROCESSOR_TOKEN;
    else process.env.V22_ORDER_PROCESSOR_TOKEN = prevSecret;
    server.closeAllConnections();
    return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const addr = server.address();
  assert(addr && typeof addr !== 'string');
  const httpRes = await fetch(`http://127.0.0.1:${addr.port}/api/internal/administration-orders/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ projectZipBase64: Buffer.from(projectZip).toString('base64'), customer, packageScope: 'core' }),
  });
  assert.equal(httpRes.status, 200);
  const httpZip = await JSZip.loadAsync(await httpRes.arrayBuffer(), { checkCRC32: true });
  assert.deepEqual(Object.keys(httpZip.files).sort(), Object.keys(procZipObj.files).sort());
  const allDocFiles = Object.values(httpZip.files).filter(entry => !entry.dir && /\.(pdf|docx)$/.test(entry.name));
  assert(allDocFiles.every(entry => entry.name.endsWith('.pdf') ? entry.name.includes('/PDF/') : entry.name.includes('/WORD/')));

  // Also check HARI_EFEKTIF directly with internal metadata only vs printed agenda leak.
  const readiness = importedProjectExportReadiness(imported.state, imported.yearPlanId, 'production', 'core');
  assert.equal(sourceIdentityExportIssue('HARI_EFEKTIF', readiness.context), undefined);
  assert.equal(validateDocumentRequirements('HARI_EFEKTIF', readiness.context).isValid, true);

  // 2: Specific source school identity inside printed calendar agenda day.notes MUST block KALENDER_AKADEMIK and HARI_EFEKTIF.
  const agendaLeakArchive = structuredClone(projectArchive);
  agendaLeakArchive.project.semesterData.academicCalendar[0].value.days[0].notes = 'Rapat Kerja Guru di SEKOLAH_ASAL_TEST';
  const agendaLeakResult = await processAdministrationOrder({ project: agendaLeakArchive, customer, packageScope: 'core' });
  assert(!agendaLeakResult.success && !('zip' in agendaLeakResult));
  assert(agendaLeakResult.validation.documents.some(d => d.type === 'KALENDER_AKADEMIK' && d.status === 'SKIPPED' && d.reason?.includes('identitas asal')));
  const leakedCtx = structuredClone(readiness.context);
  leakedCtx.calendarDays = leakedCtx.calendarDays!.map((day, idx) => idx === 0 ? { ...day, notes: 'Agenda SEKOLAH_ASAL_TEST' } : day);
  assert.equal(validateDocumentRequirements('HARI_EFEKTIF', leakedCtx).isValid, false);

  // 5: Identity leak in final PDF/DOCX inside ZIP MUST still reject the final ZIP.
  const tamperedPdfZip = new JSZip();
  for (const [name, entry] of Object.entries(procZipObj.files)) {
    if (!entry.dir) tamperedPdfZip.file(name, await entry.async('uint8array'));
  }
  const samplePdf = await new Promise<Uint8Array>(async resolve => {
    const mod = await import('jspdf');
    const doc = new mod.jsPDF();
    doc.text('Kebocoran identitas SEKOLAH_ASAL_TEST', 10, 10);
    resolve(new Uint8Array(doc.output('arraybuffer')));
  });
  const firstPdfPath = allDocFiles.find(entry => entry.name.endsWith('.pdf'))!.name;
  tamperedPdfZip.file(firstPdfPath, samplePdf);
  assert.equal(await orderZipContainsSourceIdentity(await tamperedPdfZip.generateAsync({ type: 'uint8array' }), tokens), true);

  const tamperedDocxZip = new JSZip();
  for (const [name, entry] of Object.entries(procZipObj.files)) {
    if (!entry.dir) tamperedDocxZip.file(name, await entry.async('uint8array'));
  }
  const firstDocxPath = allDocFiles.find(entry => entry.name.endsWith('.docx'))!.name;
  const docxInner = await JSZip.loadAsync(await procZipObj.file(firstDocxPath)!.async('uint8array'));
  const docXml = await docxInner.file('word/document.xml')!.async('string');
  docxInner.file('word/document.xml', docXml.replace('</w:body>', '<w:p><w:r><w:t>GURU_ASAL_TEST</w:t></w:r></w:p></w:body>'));
  tamperedDocxZip.file(firstDocxPath, await docxInner.generateAsync({ type: 'uint8array' }));
  assert.equal(await orderZipContainsSourceIdentity(await tamperedDocxZip.generateAsync({ type: 'uint8array' }), tokens), true);
});


import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { processAdministrationOrder, type AdministrationOrderInput } from './administrationOrderProcessor';

type Customer = AdministrationOrderInput['customer'];
const maxZipBytes = 8 * 1024 * 1024;
const json = express.json({ limit: '12mb', inflate: false });
const teacherStatuses = new Set(['PNS', 'PPPK', 'Guru Tetap Yayasan (GTY)', 'Guru Tidak Tetap (GTT) / Honorer', 'Lainnya']);
const digest = (value: string) => createHash('sha256').update(value).digest();

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Identitas pelanggan harus berupa objek.');
  return value as Record<string, unknown>;
}

function field(value: unknown, path: string, required = true): string {
  if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) {
    throw new Error('Nilai tidak valid untuk ' + path + '.');
  }
  return value.trim();
}

function parseCustomer(value: unknown): Customer {
  const input = record(value);
  const teacher = record(input.teacher);
  const school = record(input.school);
  const documentDate = field(input.documentDate, 'customer.documentDate');
  const date = new Date(documentDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate) || Number.isNaN(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== documentDate || documentDate.startsWith('0000')) {
    throw new Error('customer.documentDate harus berupa tanggal kalender YYYY-MM-DD.');
  }
  const status = field(teacher.status, 'customer.teacher.status');
  if (!teacherStatuses.has(status)) throw new Error('Status guru tidak valid.');
  return {
    documentDate,
    teacher: {
      name: field(teacher.name, 'customer.teacher.name'),
      nip: field(teacher.nip, 'customer.teacher.nip', false),
      nuptk: teacher.nuptk === undefined ? undefined : field(teacher.nuptk, 'customer.teacher.nuptk', false),
      status: status as Customer['teacher']['status'],
    },
    school: {
      name: field(school.name, 'customer.school.name'),
      npsn: field(school.npsn, 'customer.school.npsn'),
      address: field(school.address, 'customer.school.address'),
      village: field(school.village, 'customer.school.village'),
      district: field(school.district, 'customer.school.district'),
      regency: field(school.regency, 'customer.school.regency'),
      province: field(school.province, 'customer.school.province'),
      principalName: field(school.principalName, 'customer.school.principalName'),
      principalNip: field(school.principalNip, 'customer.school.principalNip', false),
    },
  };
}

export function registerAdministrationOrderRoute(app: express.Express) {
  app.post('/api/internal/administration-orders/process', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const secret = process.env.V22_ORDER_PROCESSOR_TOKEN?.trim();
    if (!secret) return res.status(503).json({ success: false, error: 'Endpoint pesanan belum dikonfigurasi.' });
    const token = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '')?.[1];
    if (!token || !timingSafeEqual(digest(token), digest(secret))) {
      return res.set('WWW-Authenticate', 'Bearer').status(401).json({ success: false, error: 'Token tidak valid.' });
    }
    if (!req.is('application/json')) {
      return res.status(415).json({ success: false, error: 'Gunakan Content-Type application/json.' });
    }
    json(req, res, (error?: { status?: number }) => {
      if (!error) return next();
      const status = error.status === 413 || error.status === 415 ? error.status : 400;
      res.status(status).json({ success: false, error: status === 413 ? 'Request melebihi batas 12 MiB.' :
        status === 415 ? 'Encoding atau charset request tidak didukung.' : 'Body JSON tidak valid.' });
    });
  }, async (req, res) => {
    let input: AdministrationOrderInput;
    try {
      const body = record(req.body);
      const encoded = body.projectZipBase64;
      if (typeof encoded !== 'string' || !encoded.length) throw new Error('projectZipBase64 wajib diisi.');
      if (encoded.length > Math.ceil(maxZipBytes / 3) * 4) {
        return res.status(413).json({ success: false, error: 'ZIP melebihi batas 8 MiB.' });
      }
      const project = Buffer.from(encoded, 'base64');
      if (project.toString('base64') !== encoded) throw new Error('projectZipBase64 harus berupa Base64 standar.');
      if (project.length > maxZipBytes) {
        return res.status(413).json({ success: false, error: 'ZIP melebihi batas 8 MiB.' });
      }
      const packageScope = body.packageScope;
      if (packageScope !== undefined && packageScope !== 'complete' && packageScope !== 'core') {
        throw new Error('packageScope harus complete atau core.');
      }
      input = { project, customer: parseCustomer(body.customer),
        packageScope: packageScope === 'core' || packageScope === 'complete' ? packageScope : undefined };
    } catch (error) {
      return res.status(400).json({ success: false, error: (error as Error).message });
    }
    try {
      const result = await processAdministrationOrder(input);
      if (result.success === false) {
        const invalidProject = result.validation.findings.some(finding => finding.stage === 'IMPORT');
        return res.status(invalidProject ? 400 : 422).json({
          success: false, error: invalidProject ? 'ZIP proyek V22 tidak valid.' : 'Paket administrasi tidak dapat diproses.',
          validation: result.validation,
        });
      }
      return res.attachment(result.fileName).type('application/zip').send(Buffer.from(result.zip));
    } catch {
      return res.status(500).json({ success: false, error: 'Pemrosesan pesanan gagal.' });
    }
  });
}

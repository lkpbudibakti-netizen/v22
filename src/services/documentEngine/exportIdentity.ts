import type { DocumentGenerationContext } from './types';
import { formatDocumentDate } from '../documentDateService';

const identityFields = new Set([
  'schoolName', 'npsn', 'schoolNpsn', 'schoolAddress', 'schoolVillage',
  'schoolDistrict', 'schoolRegency', 'schoolProvince', 'principalName',
  'principalNip', 'principalSource', 'principalSourceUrl', 'teacherName',
  'teacherNip', 'teacherNuptk', 'nuptk', 'teacherStatus',
]);

/** Export-only copy. Call after snapshot resolution; never write it to V5.
 * Canonical IDs and all academic/student content remain unchanged.
 */
export function maskExportIdentity<T extends Partial<DocumentGenerationContext>>(context: T): T {
  if (context.documentMode !== 'blank') return context;
  const date = context.snapshot?.documentDate ?? context.documentDate;
  const copy = (value: any, key = ''): any => {
    if (identityFields.has(key)) return '';
    if (key === 'formattedDocumentDate' || key === 'locationAndDate') return formatDocumentDate(date) || '';
    if (Array.isArray(value)) return value.map(item => copy(item));
    if (!value || typeof value !== 'object') return value;
    const result = Object.fromEntries(Object.entries(value).map(([field, child]) => {
      if (key === 'school' && !['id','createdAt','updatedAt'].includes(field)) return [field, ''];
      if (key === 'profile' && !['id','schoolId','defaultSubject','defaultLevel','createdAt','updatedAt'].includes(field)) return [field, ''];
      return [field, copy(child, field)];
    }));
    if (key === 'snapshot') result.documentMode = 'blank';
    return result;
  };
  return copy(context);
}

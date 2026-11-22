import * as productionValidation from '../../src/services/productionValidation';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import JSZip from 'jszip';
import * as planner from '../../src/services/documentEngine/annualZipPlan';
import { generateDocument, validateDocumentRequirements } from '../../src/services/documentEngine';
import { generatePdfDocument } from '../../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { resolveEffectiveContext } from '../../src/services/documentEngine/snapshot';
import { getCurriculumType } from '../../src/services/curriculumRules';
import { MERDEKA_EXPORT_DOC_TYPES } from '../../src/services/curriculumRouter';

/** Real ZIP orchestration/renderers. Capture only the browser download and adapt Blob for Node JSZip. */
export function documentZipHarness(options: { failTypes?: string[]; invalidTypes?: string[]; failDownload?: boolean; failZip?: boolean } = {}) {
  const downloads: {blob:Blob; name:string}[] = [];
  const exports: any = {};
  const bytes = async (blob: Blob) => { const array: any = new Uint8Array(await blob.arrayBuffer()); Object.defineProperty(array,'size',{value:array.length}); return array; };
  runInNewContext(ts.transpileModule(readFileSync('src/services/documentEngine/zipBundle.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText, {
    exports, console, Error, Blob, Uint8Array, TextDecoder, require:(id:string)=>{
      if(id==='../productionValidation') return productionValidation;
      if(id==='jszip') return options.failZip ? class extends JSZip { async generateAsync(): Promise<any> { throw new Error('ZIP compression failure'); } } : JSZip;
      if(id==='file-saver') return (blob:Blob,name:string)=>{if(options.failDownload) throw new Error('Download failure'); downloads.push({blob,name});};
      if(id==='./annualZipPlan') return planner;
      if(id==='../curriculumRules') return {getCurriculumType};
      if(id==='./snapshot') return {resolveEffectiveContext};
      if(id==='./index') return {validateDocumentRequirements,generateDocument:async(type:any,context:any)=>{if(options.failTypes?.includes(type)) throw new Error('Injected DOCX generator failure'); if(options.invalidTypes?.includes(type)) return {blob:await bytes(new Blob(['broken']))}; const result=await generateDocument(type,context);return {...result,blob:await bytes(result.blob!)};}};
      if(id==='./renderers/pdf/pdfDocGenerators') return {generatePdfDocument:async(type:any,context:any)=>{if(options.failTypes?.includes(type)) throw new Error('Injected PDF generator failure'); if(options.invalidTypes?.includes(type)) return {blob:await bytes(new Blob(['broken']))}; const result=await generatePdfDocument(type,context);return {...result,blob:await bytes(result.blob)};}};
      if(id==='../curriculumRouter') return {MERDEKA_EXPORT_DOC_TYPES};
      throw new Error('Unknown ZIP dependency: '+id);
    },
  });
  return { downloads, generateZipBundle: exports.generateZipBundle as typeof import('../../src/services/documentEngine').generateZipBundle };
}

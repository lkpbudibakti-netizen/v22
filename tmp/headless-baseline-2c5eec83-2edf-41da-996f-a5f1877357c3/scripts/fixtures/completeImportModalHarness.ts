import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ADMINISTRATION_IMPORT_MODES } from '../../src/types/completeProjectTransfer';
import { GRADE_PHASE_MAP } from '../../src/data/curriculumDefaults';
import { resolveGrade } from '../../src/services/cognitiveAdaptationService';

/** Executes the actual component's handlers with deterministic hooks; no browser/visual claim. */
export function completeImportModalHarness(props: any, dependencies: Record<string, unknown>) {
  const values: any[] = []; let cursor = 0;
  const source = readFileSync('src/components/CompleteProjectImportModal.tsx','utf8');
  const compiled = ts.transpileModule(source.slice(source.indexOf('export function CompleteProjectImportModal')), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, React, console, Error, ADMINISTRATION_IMPORT_MODES, GRADE_PHASE_MAP, resolveGrade,
    useState: (initial: any) => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial; return [values[index], (next: any) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useRef: (initial: any) => { const index = cursor++; return values[index] ||= { current: initial }; },
    useMemo: (factory: () => any) => factory(),
    Upload: 'upload-icon', X: 'close-icon', FileArchive: 'archive-icon',
    getLocalTodayDocumentDate: () => '2026-10-28',
    confirm: () => { throw new Error('Additional confirmation is forbidden'); }, ...dependencies,
  });
  function nodes(element: any): any[] {
    if (!React.isValidElement(element)) return [];
    return [element, ...React.Children.toArray((element.props as any).children).flatMap(nodes)];
  }
  return { nodes: () => { cursor = 0; return nodes(exports.CompleteProjectImportModal(props)); },
    text: (element: any): string => typeof element === 'string' ? element : typeof element === 'number' ? String(element) : React.isValidElement(element) ? React.Children.toArray((element.props as any).children).map(child => typeof child === 'string' ? child : '').join('') : '' };
}

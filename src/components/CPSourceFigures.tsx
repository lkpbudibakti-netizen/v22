import React from 'react';
import type { CPSource } from '../types';
import supplement from '../data/curriculum/cp/sources/cp-sd-bskap-046-2025-visual-supplement.json';

/** Render bundled source images only; restored metadata cannot load arbitrary URLs. */
export function CPSourceFigures({ source }: { source?: CPSource }) {
  const figures = Array.isArray(source?.sourceReview?.figures) ? source.sourceReview.figures : [];
  return <>{figures.map(figure => {
    const original = figure && supplement.records.flatMap(record => record.sourceFigures).find(item => item.id === figure.id && item.sha256 === figure.sha256 && item.assetPath === figure.assetPath);
    return original ? <figure key={original.id} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <figcaption className="text-xs text-slate-600">Contoh gambar sumber • Elemen {original.elementNumber} • PDF halaman {original.pdfPage}</figcaption>
      <img src={original.assetPath} width={original.width * 2} height={original.height * 2} alt={original.alt} className="max-w-full h-auto" />
      <p className="text-xs text-slate-600">Transkripsi visual (bukan tambahan redaksi CP): {original.transcription}</p>
    </figure> : null;
  })}</>;
}

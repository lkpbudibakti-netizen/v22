import source from './sources/cp-sd-bskap-046-2025-source-matched.json';
import visualSource from './sources/cp-sd-bskap-046-2025-visual-supplement.json';
import { adaptCP046Review } from './review046Adapter';

/** Explicit Step 03 source choice; never merged with the historical pool or saved teacher data. */
const visualEntries = adaptCP046Review(visualSource, 'SD').map(entry => {
  const record = visualSource.records.find(record => record.id === entry.id)!;
  const figures = record.sourceFigures.map(figure => ({ ...figure }));
  return { ...entry,
    elements: entry.elements.map(element => {
      const figure = figures.find(figure => figure.elementNumber === element.number);
      // Preserve the original image and extracted wording separately from its
      // dot-group transcription used by text consumers. No CP prose is invented.
      return figure ? { ...element, content: element.content.replace('Contoh:', 'Contoh:\n' + figure.transcription + '\n') } : element;
    }),
    sourceReview: { ...entry.sourceReview!, figures },
    notes: entry.notes + ' Contoh Aljabar: gambar asli X196 disimpan utuh; susunan titik ditranskripsikan dalam konten untuk jalur teks. Transkripsi bukan tambahan redaksi CP.',
  };
});

export const SD_REVIEW_CP_ENTRIES = [...adaptCP046Review(source, 'SD'), ...visualEntries];

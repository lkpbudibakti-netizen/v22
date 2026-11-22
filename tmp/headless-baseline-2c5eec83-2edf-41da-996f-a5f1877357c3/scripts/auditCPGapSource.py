"""Independent read-only audit of MAT A + original image and BING C source.

Usage: python scripts/auditCPGapSource.py "E:/Downloads/Kumpulan%20CP.pdf"
Requires pdfplumber, pypdf and Pillow. Never promotes verification automatically.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
import pdfplumber
from pypdf import PdfReader
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = json.loads((root / 'src/data/curriculum/cp/sources/cp-sd-bskap-046-2025-visual-supplement.json').read_text(encoding='utf-8'))
quarantine = json.loads((root / 'docs/cp046-sd-v21-quarantine.json').read_text(encoding='utf-8'))
pdf = Path(sys.argv[1])
assert hashlib.sha256(pdf.read_bytes()).hexdigest() == source['sumber']['sha256_pdf']
normalize = lambda text: re.sub(r'\s+', '', text)
record = source['records'][0]
with pdfplumber.open(pdf) as document:
    mat = normalize(' '.join(document.pages[n - 1].extract_text() for n in [111, 112]))
    passages = re.split(r'(?m)^\d+\.\d+\.\s*\n', record['teks_sumber_ekstraksi'])[1:]
    assert len(passages) == len(record['elemen']) == 5
    for element, passage in zip(record['elemen'], passages):
        assert normalize(passage) == normalize(element['teks']), element['nomor']
        assert normalize(element['teks']) in mat, element['nomor']
    english = next(r for r in quarantine['records'] if r['id'] == 'cp046-2025-sd-c-bing')
    actual = normalize(' '.join(document.pages[n - 1].extract_text() for n in [134, 135]))
    for passage in re.split(r'(?m)^\d+\.\d+\.\s*\n', english['teks_sumber_ekstraksi'])[1:]:
        assert normalize(passage) in actual
    assert 'FaseC' in actual and 'KelasIIIdanIV' in actual and 'Listening-Writing' in actual
figure = record['sourceFigures'][0]
asset = root / ('public' + figure['assetPath'])
original = PdfReader(pdf).pages[111].images[0]
assert original.name == figure['pdfImageName'] + '.png'
assert hashlib.sha256(asset.read_bytes()).hexdigest() == figure['sha256']
with Image.open(asset) as stored:
    assert stored.size == original.image.size == (229, 78)
    assert stored.convert('RGB').tobytes() == original.image.convert('RGB').tobytes()
assert figure['transcription'] == '(●●● | ●●●●) = (●● | ●●●●●) = (● | ●●●●●●)'
print('PASS source PDF hash; MAT A five complete text blocks; original X196 pixels; stored image hash; visual transcription manifest; BING C contradictions retained without correction.')

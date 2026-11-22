"""Read-only independent source check. Requires pdfplumber; never promotes verification.

Usage: python scripts/auditCP046SDSource.py "E:/Downloads/Kumpulan%20CP.pdf"
Page numbers are physical PDF pages (1-based), not printed page labels.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
import pdfplumber

root = Path(__file__).resolve().parents[1]
source = json.loads((root / 'src/data/curriculum/cp/sources/cp-sd-bskap-046-2025-source-matched.json').read_text(encoding='utf-8'))
quarantine = json.loads((root / 'docs/cp046-sd-v21-quarantine.json').read_text(encoding='utf-8'))
pdf = Path(sys.argv[1])
assert hashlib.sha256(pdf.read_bytes()).hexdigest() == source['sumber']['sha256_pdf']
normalize = lambda text: re.sub(r'\s+', '', text)
with pdfplumber.open(pdf) as document:
    cache = {}
    for record in source['records'] + quarantine['records']:
        pages = record['sumber_halaman_pdf']
        for number in range(pages['awal'], pages['akhir_terdeteksi'] + 1):
            if number not in cache:
                cache[number] = document.pages[number - 1].extract_text()
        text = normalize(' '.join(cache[n] for n in range(pages['awal'], pages['akhir_terdeteksi'] + 1)))
        # Independent PDF extractor; whitespace alone is normalized. It cannot
        # establish completeness of diagrams, class headings or legal applicability.
        passages = re.split(r'(?m)^\d+\.\d+(?:\.\d+)?\.\s*\n', record['teks_sumber_ekstraksi'])[1:]
        assert passages and all(normalize(passage) in text for passage in passages), record['id']
        def check(element):
            assert normalize(element['nama']) in text, element['id']
            if element['teks']:
                assert normalize(element['teks']) in text, element['id']
            for child in element.get('subelemen', []):
                check(child)
        if record['status_verifikasi'] == 'VERIFIED_SOURCE_MATCH':
            flattened = []
            def flatten(element):
                flattened.append(element)
                for child in element.get('subelemen', []):
                    flatten(child)
            for element in record['elemen']:
                flatten(element)
            assert len(flattened) == len(passages), record['id']
            for element, passage in zip(flattened, passages):
                assert normalize(element['teks'] or element['nama']) == normalize(passage), element['id']
            for element in record['elemen']:
                check(element)
        print(f"PASS {record['id']} PDF {pages['awal']}-{pages['akhir_terdeteksi']} ({len(passages)} passages)")
print('PASS 38 candidates against supplied PDF; this text check does not replace visual/source-identity review.')

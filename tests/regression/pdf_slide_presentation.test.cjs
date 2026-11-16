const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('apps/home/static/js/fixed_document.js', 'utf8');

test('PDF slideshow is only offered for PDF documents', () => {
  assert.match(source, /presentPdfButton\.hidden=note\.source_kind!=='pdf'/);
  assert.match(source, /if\(note\?\.source_kind!=='pdf'\|\|!pdf\|\|!active\)return/);
});

test('PDF slideshow renders each original page using the current PDF.js document', () => {
  assert.match(source, /documentPdf\.getPage\(index\+1\)/);
  assert.match(source, /page\.render\(\{canvasContext:canvas\.getContext\('2d'\)/);
  assert.match(source, /RenderingCancelledException/);
});

test('PDF presentation has keyboard controls and cleans up on navigation', () => {
  assert.match(source, /event\.key==='Escape'/);
  assert.match(source, /'ArrowRight','ArrowDown','PageDown'/);
  assert.match(source, /'ArrowLeft','ArrowUp','PageUp'/);
  assert.match(source, /pdfSlideShow\?\.close\(\);rememberPdfView\(\)/);
});

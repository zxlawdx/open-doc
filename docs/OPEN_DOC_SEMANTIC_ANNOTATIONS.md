# Open Doc — Semantic PDF annotations (increment 1)

Base: `main` at `3452b44819a5a2cad6889c4a75b8d8a6d5b02e8d`.

## Scope implemented in this branch

- Keep the existing `opendoc-fixed-v1` model and optional `annotations` field.
  Legacy documents without the field remain valid. The source PDF and existing
  vector ink remain unchanged.
- Extract selected-text rectangles from the active PDF.js `textLayer`.
  Refuse cross-page selections rather than silently corrupting anchors.
  Convert viewport rectangle corners to PDF default user-space QuadPoints.
- Show a contextual markup toolbar and a small annotation/comment panel.
  Highlights, underlines, strikeouts, edits and removals are passed through
  the existing fixed-document autosave/revision and undo/redo.
- Export native PDF `/Highlight`, `/Underline`, `/StrikeOut` annotations,
  with `/QuadPoints`, `/Contents`, `/C`, `/CA`, `/NM` and `/T`.
  Original PDF bytes are preserved. Rotated pages with flattened ink overlays
  receive equivalent transformations of their native annotation geometry.
- Add Python and JSDOM tests for model validation, persistence, native PDF
  annotations, rotation, and browser selection geometry.
- Keep CSS in `apps/open_doc/styles/semantic_annotations.css`. Run the
  project's normal `npm run build`; do not edit generated `main.css`.

## Files and boundaries

- `fixed_document/annotations.py`: validates semantic annotation shapes and
  creates standard PDF objects. No Qt or DOM references.
- `fixed_document/{schema,validation}.py`: backward-compatible schema,
  validation of new annotations.
- `ink/exporters.py`: joins existing flattening for ink with native markup.
- `static/js/semantic_annotations.js`: browser-only selection capture,
  per-page markup rendering, contextual editing and comments.
- `static/js/fixed_document.js`: lifecycle integration, history and rendering.
- `styles/semantic_annotations.css`: UI source styles.

## External references and licensing

| Reference | Concept | License / decision |
| --- | --- | --- |
| [PDF.js](https://github.com/mozilla/pdf.js) | TextLayer and viewport conversions | Apache-2.0; already bundled, reuse existing runtime |
| [pypdf](https://github.com/py-pdf/pypdf) | Native PDF annotations | BSD-style license; use installed Python API |
| [react-pdf-highlighter-extended](https://github.com/DanielArnould/react-pdf-highlighter-extended) | Viewport-independent highlights | MIT; UX/data concept only, do not add React |
| [Xournal++](https://github.com/xournalpp/xournalpp) | Ink/editing tools and sidebar | GPL-2.0; UX reference only, no code copied |
| [Okular](https://github.com/KDE/okular) | Native markup interoperability | Multiple SPDX licenses; UX reference only |
| [Zotero Reader](https://github.com/zotero/reader) | Text-linked highlights and notes | License not confirmed in this inspection; UX reference only |

No code was copied from any external application's implementation.

## Tests to run

```sh
python -m pip install -r requirements-dev.txt
npm ci
npm run build
python -m pytest -q tests/test_pdf_semantic_annotations.py
node --test tests/semantic_annotations.test.cjs
python -m pytest -q
npm test
python -u tools/qa_ink.py
python -u tools/qa_desktop.py
```

Run a real PDF in Windows and Linux Vela/QtWebEngine, then check
50%, 75%, 100%, 125%, 150%, 200% zoom; single and multi-line text,
two columns, high-DPI, CropBox shifts, 90°/180°/270° rotation, and
external PDF readers such as Okular and Adobe Acrobat.

## Known limitations — do not call this work complete

- **Not yet implemented:** academic study library, categorization,
  fichamentos, native annotation import, study split-view, OCR,
  persistent reading progress, and end-to-end Qt screenshot QA.
- This first increment refuses cross-page highlights; cross-page support
  needs anchored per-page splitting.
- Semantic annotations are saved in the fixed-document JSON stored in
  SQLite. A dedicated normalized annotation table and migration have not
  been introduced; confirm this design before expanding metadata.
- The browser geometry workflow and exported annotation appearances need
  *actual QtWebEngine* verification, including old Chromium builds.
- Underline/strikeout markup dictionaries rely on external viewers to
  construct appearances; verify interoperability before release.
- The current UI does not import existing native PDF annotations for editing.
- No runtime screenshot or cross-platform test run is claimed by this note.

## Manual acceptance path

Import a text-based PDF via the normal Open Doc import action. Select one
sentence, click **Destacar**, add a comment in the sidebar, save, close,
reopen, select the annotation and verify its comment. Zoom and inspect
alignment. Export a **different** PDF file, reopen in an external viewer and
inspect `/Annots` objects. Verify the original checksum is unchanged.

If any geometry renders incorrectly, keep the PR in draft and do not merge.

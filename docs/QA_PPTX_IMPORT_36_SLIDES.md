# QA for external PPTX: 36-slide political-economy template

## User-observed problems
- V2 rendered black text on a dark background in the Open Doc PPTX viewer.
- V3 corrected color but titles were severely undersized; import stayed in read-only preview.
- User works with external university/professor templates; the actual requirement is preserve original dimensions, theme, media and formatting while allowing editing.

## Confirmed source-format causes
1. The V3 had **363 text runs without an explicit `a:rPr/@sz`**. Size (e.g., `sz="5100"` for 51pt) was set on the paragraph's `a:pPr/a:defRPr`. The older viewer showed a smaller font. The V4 source correction writes size, font family, boldness and color on each run, but the importer must still understand inherited formatting in arbitrary external PPTX.
2. The deck has **170+ thin decorative rectangles**, including a vertical stripe only 0.009 of the slide width and horizontal rules ~0.008 of slide height. `native_importer._coordinates` had rejected shapes with width or height under **0.01**, causing `read_editable_deck` to return `None` for the entire deck. The main branch previously displayed the PPTX in read-only mode as a result.
3. Re-exporting imported files via a fresh `Presentation()` discarded unrelated layout/master information. The new source-preserving exporter attempts targeted changes while retaining untouched OOXML.
4. Text edited in a multi-paragraph shape previously became empty when the export routine removed the retained leading run. Regression tests must cover it.

## Research references (independent, not adopted as dependencies)
- [python-pptx text model](https://python-pptx.readthedocs.io/en/latest/api/text.html): paragraph defaults versus run overrides.
- [python-pptx issue #1135](https://github.com/scanny/python-pptx/issues/1135): real user report about `a:defRPr` size and editability.
- [Office Kit](https://github.com/office-kit/pptx): OOXML-preserving round-trip and fidelity corpus design.
- [pptx-viewer editing documentation](https://christophervr.github.io/ooxml/pptx/core/editing): per-run text properties and preservation of theme color references.
- [Casual Slides](https://github.com/CasualOffice/slides): UX patterns for Office-style slides editing.

## Tests
- Python: `test_36_slide_dark_template_imports_with_thin_rules_and_inherited_51pt_title`: all 36 slides editable, 51pt white Aptos title, thin shapes retained, title edited and exported, original PPTX unchanged.
- Qt integration: `tools/qa_imported_economy_capture.cjs` runs against a 36-slide fixture generated with the same dimensions, colors, font inheritance and thin geometry. Requires edit mode, 36 thumbnails, title with properly scaled font; captures 1366x768, 1920x1080, and after direct mouse + Inspector edit.
- CI runs clean screenshots only, preventing stale tracked screenshots masquerading as current results.

**Note:** the automated fixture reproduces the V3 design defects; it is not the exact V3/V4 binary. Native screenshots must be checked against its actual CI commit. The exact V4 PPTX binary was delivered separately to the user.

## Unfinished broader interoperability
Arbitrary SmartArt, OLE, grouping, complex animations, rich text range editing, table merge/split, unknown vendor extensions and slide-master editing need additional support. No claim of universal fidelity is warranted until roundtrip/visual tests cover those cases. Never silently flatten or erase unknown content.

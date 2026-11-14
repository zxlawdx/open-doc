# Open Doc: single-active-slide architecture and open-source reuse matrix (2026-11-06)

## Root cause and boundary

Before `feat/single-active-slide-canvas-20261106`, `SlideStudio.render()`
iterated over the full deck and mounted a `.fixed-surface` for every slide
inside `.fixed-scroll`. `FixedDocument.go()` scrolled to one of those DOM
nodes. That architecture is appropriate to multi-page PDF readers, but it
made editing a presentation resemble a long scrolling document and allowed
the selection contour to appear to encompass the reader workspace.

This change preserves `model.surfaces` in its entirety and mounts **exactly
one editable slide** in the principal PPTX workspace. The single active
canvas, independent thumbnails, and original PDF reader now have separate
presentation/navigation contracts.

| Responsibility | Editable PPTX | Imported PPTX preview | PDF | DOCX |
| --- | --- | --- | --- | --- |
| Primary viewport | Exactly one active physical slide | Existing read-only preview (legacy multi-page reader) | Virtualized, continuous pages | Text flow with automatic page breaks |
| Source of truth | `model.surfaces`, not DOM pages | Immutable original + fixed model | Immutable source PDF + overlays | Structured rich model |
| Navigation | `SlideStudio.goTo(index)`, replaces active canvas | Existing fixed document page navigation | Scroll to physical page + lazy render | Selection/bookmark preserving pagination |
| Sidebar | Simplified slide thumbnails | Existing PPTX thumbnails | PDF page thumbnails/bookmarks | Navigator/outline |
| Zoom | Visual workspace scaling, fit mode or manual, does not mutate coordinates | Reader zoom | Reader zoom | Document page zoom |
| Export | Existing editable OOXML PPTX export | Preserves imported source | Annotated PDF | DOCX / PDF / Markdown |
| Fullscreen | Vela native window API + independent presenter slide renderer | N/A | N/A | N/A |

## Component responsibilities

```text
FixedDocumentController
  ├── PDF continuous reader: pageNodes + lazy PDF.js renderer
  ├── Imported PPTX read-only preview: existing adapter
  └── Editable Presentation: SlideStudio
      ├── SlideDeckCommands: immutable-copy model transactions
      ├── ActiveSlideWorkspace: one physical .fixed-surface
      ├── ThumbnailRenderer: simplified, independent per-slide previews
      ├── SlideSvgRenderer: shapes bound to normalized coordinates
      ├── Slide Inspector: selection, object properties, layers, transitions
      └── Presentation playback: independent slide markup, Vela fullscreen
```

`_buildSurface(index)` is a reusable constructor; it mounts an active editor
surface or creates an independent, transient source for presentation of slides
not mounted in the editor. It does **not** append inactive editor pages.

`fixed_document.js` must never iterate the physical PPTX Canvas as though
it contained all slides. It reads the total count from `model.surfaces`.
PDF and non-editable PPTX keep their original page array and lazy rendering
contracts. DOCX's separate text pagination remains unchanged.

### Geometry contract

The data model stores `x, y, width, height` as fractions of the logical slide.
The viewport multiplies by `slide_width_pt * 4/3 * zoom` and
`slide_height_pt * 4/3 * zoom`. Pointer events divide deltas by the
**current physical active slide** rectangle. Fitting uses both available
width and height after workspace margins. Overflow grows a scrollable
container around this one slide; it never mounts other slides.

Thumbnail dimensions derive from each source slide's original
`width_pt / height_pt` (including 4:3 and custom). An explicit pixel-height
fallback supports legacy QtWebEngine without `aspect-ratio`.

## Open-source architecture and license compatibility

**These are architectural comparisons, not copied source code.** Confirmed
license links are included; verify transitive dependencies and distributable
bundles before adopting any package.

| Project | Current architectural value | License | Assessment for Vela / Open Doc |
| --- | --- | --- | --- |
| [PPTist](https://github.com/pipipi-pikachu/PPTist) | Vue/TS slide tools, object + slide animation panels and timeline | AGPL-3.0 | Inspiration for UI interactions only; **do not copy** its code into a differently licensed project without legal compatibility review |
| [Office Kit](https://github.com/office-kit/pptx) | ESM PPTX reader/writer, animation-player timeline and browser QA for with/after previous semantics | MIT | Useful independent reference for OOXML `p:timing`; Node/browser version compatibility must be validated before integrating |
| [Konva](https://github.com/konvajs/konva) | Scene graph: layers, event dispatch, dragging, handles, transforms | MIT | Conceptually valuable for a future dedicated scene graph; not interchangeable with the existing DOM/SVG editability in this P0 fix |
| [Fabric.js](https://github.com/fabricjs/fabric.js) | Object model for graphics, transform controls, groups, SVG IO | MIT | Could power an optional raster/vector canvas backend after migration tests; replacing rendering now risks losing OOXML/text fidelity |
| [ONLYOFFICE DocumentServer](https://github.com/ONLYOFFICE/DocumentServer) | Comprehensive document engines, command routing, multi-format services | AGPL-3.0 | Do not vendor/copy; substantial runtime and licensing costs |
| [PDF.js](https://github.com/mozilla/pdf.js) | PDF text/graphics reader with workers, text selection and viewport transforms | Apache-2.0 | Already underlies the PDF reader; preserve its worker/lazy-page architecture separately |
| [ProseMirror](https://github.com/ProseMirror/prosemirror) | Schema-driven rich documents, transactions, controlled selection and editing state | MIT | Relevant for a future DOCX editing engine upgrade; do not merge this into PPTX viewport work |

Some dependencies are rapidly evolving: Office Kit documents a pre-1.0 API
and modern browser requirements, while existing PyQtWebEngine builds can
ship much older Chromium engines. Prefer small well-tested adapters and
license-compatible reuse over replacing established components.

## Required regression evidence

- `tests/regression/slide_editor.test.cjs`: only one physical canvas for 2+ slides;
  thumbnails retain all slides; slides maintain object identity; editing
  geometry survives navigation and 4:3 sizes; presenter can render an offscreen
  slide without mounting it in the editor.
- `tests/regression/fixed_rendering.test.cjs`: the fixed-document controller's PPTX
  navigation points to the active slide, with a single physical page and full
  `model.surfaces`.
- `tools/qa_slide_capture.cjs`: live QtWebEngine tests thumbnail clicks,
  viewport/Inspector geometry, aspect ratio, and screenshots at 1366x768 and
  1920x1080. This complements, rather than replaces, JS DOM tests.
- Existing PDF 300-page search and DOCX pagination regressions must continue
  to pass. Native fullscreen is tested in Vela/Desktop QA.

## Follow-up capability matrix (not claimed complete)

| Capability | Current state / integration direction |
| --- | --- |
| Single active editable slide | Implemented on this branch, pending CI validation |
| Multi-slide thumbnails | Separate simplified renderer; click navigation implemented |
| Delete / Backspace of selected slide objects | Existing `SlideDeckCommands.deleteObjects`; verify object and text focus in native Qt |
| Direct text editing, move, resize, rotate, image crop | Existing DOM/SVG commands; test after viewport refactor |
| F5, Shift+F5, F11, fade/push/wipe transitions | Already merged through #30/Vela #22; must retain regression QA |
| One slide PPTX export | Already merged through #30; native OOXML source preserved |
| PDF single page export / PNG/JPEG | **Not delivered by this viewport PR** |
| Native PPTX object animations with timing tree | **Not implemented**. Separate model, player, editor UI and OOXML preservation tests required |
| Tables, advanced chart data/CSV, grouping and complex clipboard | **Not completed**; require dedicated model/command/export compatibility tests |
| Native PDF comments, DOCX large-delete stress | Out of scope for this structural slide PR; maintain existing regression suite |

## Merge policy

No claim of visual equivalence or readiness until both Windows and Linux
CI execute successfully, Qt screenshots/geometry satisfy acceptance tests,
and no new errors appear in PDF/DOCX. Test failures are repaired at their
cause, not suppressed. Every additional editor subsystem should have
an explicit, testable lifecycle.

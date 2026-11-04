"""Real Vela / QtWebEngine smoke; synthetic stylus is not hardware validation."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
os.environ.setdefault("PYWEBVIEW_GUI", "qt")
os.environ.setdefault("QT_API", "pyqt5")
os.environ.setdefault("QTWEBENGINE_REMOTE_DEBUGGING", "9234")
import webview
from fpdf import FPDF
from config.wsgi import create_app
from apps.open_doc.services.container import services
from apps.open_doc.services.preferences_service import Config
from apps.open_doc.ink.handwriting import Recognition


class FakeRecognizer:
    name = "qa-fake"
    available = True

    async def recognize(self, strokes, *, language):
        return Recognition("Texto convertido localmente", 0.95, self.name, language)


def wait(window, expression):
    for _ in range(200):
        if window.evaluate_js(expression):
            return
        time.sleep(0.1)
    raise AssertionError(
        expression
        + " STATUS "
        + str(window.evaluate_js("document.querySelector('[data-status]').textContent"))
    )


def main():
    errors = []
    original_start = webview.start

    def qa():
        window = webview.windows[0]
        try:
            from qa_runtime import report

            report(window)
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            wait(
                window,
                "document.querySelectorAll('.fixed-surface canvas').length>0 && document.querySelectorAll('.textLayer span').length>0",
            )
            output = subprocess.run(
                [
                    "node",
                    str(ROOT / "tools/qa_ink_capture.cjs"),
                    os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
                ],
                capture_output=True,
                text=True,
                timeout=100,
            )
            print(output.stdout, output.stderr, flush=True)
            assert output.returncode == 0
            note = services().fixed_documents.current()
            assert (
                note["revision"] > 1
                and note["content"]["surfaces"][0]["text_overlays"][0]["text"]
                == "Texto convertido localmente"
            )
            target = services().config.root / "output.pdf"
            services().fixed_documents.export(
                note["id"], note["revision"], "pdf", target
            )
            from pypdf import PdfReader

            assert (
                "Texto convertido localmente"
                in PdfReader(target).pages[0].extract_text()
            )
            print("QT_PDF_INK_RECOGNITION_EXPORT_OK", flush=True)
            # End-to-end semantic selection in the distributed QtWebEngine.
            window.evaluate_js(
                "document.querySelector('[data-ink-mode=cursor]').click();"
                "document.querySelector('.fixed-surface[data-page-index=\\\"0\\\"]').scrollIntoView();"
            )
            wait(window, "document.querySelector('.fixed-surface[data-page-index=\\\"0\\\"] .textLayer span')!==null")
            selected = window.evaluate_js(
                "(function(){"
                "var node=document.querySelector('.fixed-surface[data-page-index=\\\"0\\\"] .textLayer span');"
                "var range=document.createRange();range.selectNodeContents(node);"
                "var selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);"
                "document.querySelector('.fixed-scroll').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));"
                "return selection.toString().trim().length>0;"
                "})()"
            )
            assert selected, "A seleção de texto não funcionou no QtWebEngine."
            wait(
                window,
                "document.querySelector('.semantic-selection-menu')?.hidden===false",
            )
            window.evaluate_js(
                "document.querySelector('.semantic-selection-menu button').click()"
            )
            wait(window, "document.querySelectorAll('.semantic-fragment').length>0")
            window.evaluate_js(
                "(function(){"
                "var input=document.querySelector('.semantic-annotation-editor textarea');"
                "input.value='Comentário testado no Qt';"
                "input.dispatchEvent(new Event('change',{bubbles:true}));"
                "})()"
            )
            saved_annotation = None
            for _ in range(80):
                updated = services().fixed_documents.get(note["id"])
                annotations = updated["content"].get("annotations", [])
                if annotations and annotations[0]["comment"] == "Comentário testado no Qt":
                    saved_annotation = annotations[0]
                    break
                time.sleep(0.1)
            assert saved_annotation, "Comentário sem persistência SQLite."
            native = services().config.root / "native-semantic.pdf"
            services().fixed_documents.export(
                note["id"], updated["revision"], "pdf", native
            )
            marks = [
                item.get_object()
                for item in PdfReader(native).pages[0]["/Annots"]
            ]
            assert any(
                item["/Subtype"] == "/Highlight"
                and item["/Contents"] == "Comentário testado no Qt"
                for item in marks
            )
            print("QT_PDF_SEMANTIC_ANNOTATION_EXPORT_OK", flush=True)

            # Verify actual Qt pixel output, not merely JS model/DOM objects.
            window.evaluate_js("OpenDocApp.action('presentation-new')")
            wait(window, "document.querySelector('.fixed-document')?.dataset.slideEditor==='true'")
            window.evaluate_js(
                "Array.from(document.querySelectorAll('.slide-studio-toolbar button'))"
                ".find(b=>b.textContent==='Retângulo').click()"
            )
            wait(window, "!!document.querySelector('.slide-vector-shape rect')")
            window.evaluate_js(
                "Array.from(document.querySelectorAll('.slide-studio-toolbar button'))"
                ".find(b=>b.textContent==='Elipse').click()"
            )
            wait(window, "!!document.querySelector('.slide-vector-shape ellipse')")
            window.evaluate_js(
                "(function(){"
                "var label=Array.from(document.querySelectorAll('.slide-inspector label'))"
                ".find(x=>x.textContent.startsWith('Preenchimento'));"
                "var color=label.querySelector('input');color.value='#F4B183';"
                "color.dispatchEvent(new Event('change'));"
                "document.querySelector('.slide-object-ellipse')"
                ".scrollIntoView({block:'center',inline:'center'});"
                "})()"
            )
            wait(
                window,
                "document.querySelector('.slide-vector-shape ellipse')?.getAttribute('fill')?.toUpperCase()==='#F4B183'",
            )
            output = subprocess.run(
                [
                    "node", str(ROOT / "tools/qa_slide_capture.cjs"),
                    os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
                ],
                capture_output=True, text=True, timeout=35,
            )
            print(output.stdout, output.stderr, flush=True)
            assert output.returncode == 0, "Qt screenshot/shape hit test failed"
            from PIL import Image

            image_dir = ROOT / "docs/images/ink"
            screenshot = Image.open(image_dir / "slide-svg-shapes.png").convert("RGB")
            geometry = json.loads((image_dir / "slide-svg-shapes.json").read_text())
            for shape, fx, fy in [("rect", .06, .06), ("ellipse", .5, .5)]:
                rect = geometry[shape]
                px = round((rect["x"] + rect["width"] * fx)
                           * screenshot.width / geometry["viewport"]["width"])
                py = round((rect["y"] + rect["height"] * fy)
                           * screenshot.height / geometry["viewport"]["height"])
                assert 0 <= px < screenshot.width and 0 <= py < screenshot.height, (
                    "A forma ficou fora da área visível do Qt: " + shape
                )
                color = screenshot.getpixel((px, py))
                target = tuple(bytes.fromhex(rect["fill"].lstrip("#")))
                assert max(abs(a - b) for a, b in zip(color, target)) <= 24, (
                    f"Qt não pintou {shape} em {(px, py)}: {color} != {target}"
                )
            print("QT_SLIDE_SVG_PIXELS_REAL_VISIBLE_OK", flush=True)
            image_geometry = json.loads((image_dir / "slide-native-image.json").read_text())
            native_shot = Image.open(image_dir / "slide-native-image.png").convert("RGB")
            pixel_x = round((image_geometry["x"] + image_geometry["width"] / 2)
                            * native_shot.width / image_geometry["viewport"]["width"])
            pixel_y = round((image_geometry["y"] + image_geometry["height"] / 2)
                            * native_shot.height / image_geometry["viewport"]["height"])
            assert 0 <= pixel_x < native_shot.width and 0 <= pixel_y < native_shot.height
            image_pixel = native_shot.getpixel((pixel_x, pixel_y))
            assert max(abs(a - b) for a, b in zip(image_pixel, (20, 100, 200))) <= 24, (
                f"Native Qt image pixel is missing: {image_pixel}"
            )
            print("QT_SLIDE_IMAGE_PIXELS_REAL_VISIBLE_OK", flush=True)

            window.evaluate_js(
                "Array.from(document.querySelectorAll('.slide-studio-toolbar button'))"
                ".find(b=>b.textContent==='Texto').click()"
            )
            wait(window, "!!document.querySelector('.slide-object-text')")
            slide_note = None
            for _ in range(70):
                current = services().fixed_documents.current()
                if current.get("source_kind") == "pptx" and len(
                    current["content"]["surfaces"][0].get("elements", [])
                ) == 4:
                    slide_note = current
                    break
                time.sleep(.1)
            assert slide_note, "Os SVGs/texto não foram persistidos em SQLite."
            from pptx import Presentation
            target_pptx = services().config.root / "qa-slide-editable.pptx"
            services().fixed_documents.export(
                slide_note["id"], slide_note["revision"], "pptx", target_pptx
            )
            shapes = Presentation(target_pptx).slides[0].shapes
            from pptx.enum.shapes import MSO_SHAPE_TYPE
            assert len(shapes) == 4
            assert shapes[2].shape_type == MSO_SHAPE_TYPE.PICTURE
            assert shapes[2].name == "qt-pixel.png"
            assert shapes[2].image.size == (2, 2)
            assert shapes[3].text == "Novo texto"
            assert len(slide_note["content"].get("assets", {})) == 1
            print("QT_SLIDE_SVG_AND_EDITABLE_OOXML_EXPORT_OK", flush=True)

        except Exception as e:
            import traceback

            traceback.print_exc()
            errors.append(str(e))
        finally:
            window.confirm_close = False
            window.destroy()

    def start(*args, **kwargs):
        original_start(qa, gui="qt", debug=False)

    webview.start = start
    try:
        with tempfile.TemporaryDirectory(prefix="open-doc-ink-qa-") as folder:
            app = create_app(Config(Path(folder)))
            source = Path(folder) / "large.pdf"
            pdf = FPDF()
            for index in range(300):
                pdf.add_page()
                pdf.set_font("Helvetica", size=14)
                pdf.text(20, 30, "Pagina " + str(index + 1) + " texto pesquisavel")
                pdf.rect(20, 40, 60, 30, style="F")
            pdf.output(source)
            services().fixed_documents.import_pdf(source)
            services().handwriting.backends = [FakeRecognizer()]
            app.run()
    finally:
        webview.start = original_start
    if errors:
        raise RuntimeError("; ".join(errors))


if __name__ == "__main__":
    main()

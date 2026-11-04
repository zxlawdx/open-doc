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

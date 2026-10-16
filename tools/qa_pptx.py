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
            wait(window, "document.querySelector('.pptx-content svg')")
            destination = services().config.root / "output.pptx"
            window.create_file_dialog = lambda *args, **kwargs: (str(destination),)
            output = subprocess.run(
                [
                    "node",
                    str(ROOT / "tools/qa_pptx_capture.cjs"),
                    os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
                ],
                capture_output=True,
                text=True,
                timeout=100,
            )
            print(output.stdout, output.stderr, flush=True)
            assert output.returncode == 0
            note = services().fixed_documents.current()
            assert len(note["content"]["surfaces"][0]["strokes"]) == 1
            from pptx import Presentation

            assert len(Presentation(destination).slides) == 2
            assert (
                services().fixed_documents.source(note["id"]).read_bytes()
                == (ROOT / "tests/fixtures/visible.pptx").read_bytes()
            )
            print("QT_PPTX_WITHOUT_LIBREOFFICE_INK_SAVE_REOPEN_EXPORT_OK", flush=True)
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
            from unittest.mock import patch

            source = services().organizer.organize(ROOT / "tests/fixtures/visible.pptx")
            with patch(
                "subprocess.run",
                side_effect=AssertionError(
                    "PPTX import cannot start external renderers"
                ),
            ):
                note = services().fixed_documents.import_pptx(source)
            assert (
                note["capabilities"]["preview"]
                and note["capabilities"]["pptx_preview"]["backend"]
                == "pptx-viewer-0.2.2"
            )
            app.run()
    finally:
        webview.start = original_start
    if errors:
        raise RuntimeError("; ".join(errors))


if __name__ == "__main__":
    main()

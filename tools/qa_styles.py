"""Run the responsive visual matrix inside the actual Vela Qt window."""

from __future__ import annotations
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
os.environ.setdefault("PYWEBVIEW_GUI", "qt")
os.environ.setdefault("QT_API", "pyqt5")
os.environ.setdefault("QTWEBENGINE_REMOTE_DEBUGGING", "9234")
import webview
from apps.open_doc.services.preferences_service import Config
from apps.open_doc.services.container import services
from config.wsgi import create_app


def main():
    original = webview.start
    failures = []

    def qa():
        window = webview.windows[0]
        try:
            for _ in range(150):
                if window.evaluate_js(
                    "document.querySelector('[data-app]')?.dataset.ready==='true'"
                ):
                    break
                time.sleep(0.1)
            else:
                raise AssertionError("Vela editor did not mount")
            result = subprocess.run(
                [
                    "node",
                    str(ROOT / "tools/qa_styles_capture.cjs"),
                    os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
                ],
                text=True,
                capture_output=True,
                timeout=180,
            )
            print(result.stdout, flush=True)
            if result.returncode:
                raise AssertionError(result.stderr)
        except Exception as exc:
            failures.append(str(exc))
            print(exc, flush=True)
        finally:
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *args, **kwargs: original(qa, gui="qt", debug=False)
    try:
        with tempfile.TemporaryDirectory(prefix="open-doc-styles-") as folder:
            app = create_app(Config(Path(folder)))
            for i in range(6):
                services().editor.create(
                    (
                        "Título longo para verificar reticências e alinhamento — "
                        + ("documento importante " * 6)
                    )[:178]
                    + str(i),
                    "Texto preservado para operações de documento.",
                )
            (
                Path(folder)
                / "notes"
                / "Arquivo importado com nome longo e acentos.txt"
            ).write_text("Conteúdo local", encoding="utf-8")
            note = services().editor.create(
                "Documento de validação visual",
                "# Editor de documentos\n\n"
                + (
                    "\n\n".join(
                        "Parágrafo "
                        + str(i)
                        + ": texto editável para validar páginas e hierarquia visual. "
                        * 8
                        for i in range(24)
                    )
                ),
            )
            app.run()
    finally:
        webview.start = original
    if failures:
        raise RuntimeError("\n".join(failures))
    print("VELA_QT_STYLES_QA_COMPLETE", flush=True)


if __name__ == "__main__":
    main()

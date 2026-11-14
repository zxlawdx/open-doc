"""Exercise version restore through the actual Vela QtWebEngine window."""

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
os.environ.setdefault("QTWEBENGINE_REMOTE_DEBUGGING", "9240")

import webview

from config.composition import get_context
from shared.services.preferences_service import Config
from config.wsgi import create_app


def wait(window, expression):
    for _ in range(150):
        if window.evaluate_js(expression):
            return
        time.sleep(0.1)
    details = window.evaluate_js("""
        (() => ({
            url: location.href,
            documentState: document.readyState,
            app: Boolean(document.querySelector('[data-app]')),
            ready: document.querySelector('[data-app]')?.dataset.ready || null,
            status: document.querySelector('[data-status]')?.textContent || null,
            bridge: Boolean(window.pywebview?.api)
        }))()
    """)
    raise AssertionError(f"{expression} — estado da janela: {details}")


def main():
    errors = []
    native_start = webview.start

    def run_qa():
        window = webview.windows[0]
        try:
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            window.evaluate_js("""
                document.querySelector('.header-actions [data-action="version-history"]').click()
            """)
            wait(
                window,
                "Boolean(document.querySelector('.dialog-history select option:nth-child(2)'))",
            )
            window.evaluate_js("""
                document.querySelector('.dialog-history select').selectedIndex = 1;
                document.querySelector('button[title=Comparar]').click()
            """)
            wait(
                window,
                "document.querySelector('.version-history-comparison')?.textContent.includes('Resultados revisados')",
            )
            output = Path(
                os.environ.get("OPEN_DOC_HISTORY_CAPTURES", "docs/images/history")
            )
            output.mkdir(parents=True, exist_ok=True)
            commit = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"], text=True
            ).strip()
            subprocess.run(
                [
                    "node",
                    str(ROOT / "tools/qa_version_history_capture.cjs"),
                    os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
                    str(output),
                    f"{sys.platform}-{commit}",
                ],
                check=True,
                timeout=30,
            )
            window.evaluate_js("""
                window.confirm = () => true;
                document.querySelector('button[title=Restaurar]').click()
            """)
            wait(
                window,
                "OpenDocApp.editor().snapshot().title==='Resultados preliminares'",
            )
            assert (
                get_context().editor.current()["markdown"] == "Amostra com 8 registros."
            )
            print("QT_VERSION_HISTORY_RESTORED", flush=True)
        except Exception as exc:
            errors.append(exc)
        finally:
            window.confirm_close = False
            window.destroy()

    def start(*args, **kwargs):
        native_start(run_qa, gui="qt", debug=False)

    webview.start = start
    try:
        with tempfile.TemporaryDirectory(prefix="open-doc-history-qa-") as directory:
            app = create_app(Config(Path(directory)))
            editor = get_context().editor
            note = editor.create("Resultados preliminares", "Amostra com 8 registros.")
            editor.save(
                note["id"],
                "Resultados revisados",
                "Amostra com 12 registros.",
                note["revision"],
            )
            app.run()
    finally:
        webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

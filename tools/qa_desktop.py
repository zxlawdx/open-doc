"""Smoke test no Vela/Qt real e capturas via protocolo do QtWebEngine.

Executar em sessão gráfica; para CI configure QT_QPA_PLATFORM=offscreen.
Requer Node 22+ apenas para CDP/capturas. Não altera o workspace do usuário.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
os.environ.setdefault("PYWEBVIEW_GUI", "qt")
os.environ.setdefault("QT_API", "pyqt5")
os.environ.setdefault("QTWEBENGINE_REMOTE_DEBUGGING", "9234")

import webview
from app.config import Config
from app.runtime import services
from config.wsgi import create_app

FIXTURE = (
    "# Escrever com clareza\n\n"
    "Um documento começa com uma ideia. Este texto de validação verifica "
    "acentos, seleção e formatação no Open Doc.\n\n"
    "## Organização do texto\n\n"
    "A página ocupa o centro da mesa de trabalho. As ferramentas ficam "
    "por perto, sem disputar atenção com o conteúdo.\n\n"
    "- Registrar a primeira ideia\n- Desenvolver o argumento\n"
    "- Revisar com cuidado\n\n"
    "## Próximos passos\n\n"
    "O conteúdo permanece no dispositivo e pode ser exportado para PDF, "
    "DOCX ou Markdown.\n\n"
    "> Clareza também é escolher o que deixar de fora.\n"
)


def wait_for(window: Any, expression: str) -> Any:
    """Aguarda uma condição no renderer sem bloquear a thread Qt."""
    for _ in range(150):
        value = window.evaluate_js(expression)
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError("Timeout: " + expression)


def native_keyboard(window: Any) -> None:
    """Envia atalhos Qt reais ao focusProxy do QWebEngineView."""
    from threading import Event
    from PyQt5.QtCore import QObject, Qt, pyqtSignal, pyqtSlot
    from PyQt5.QtTest import QTest
    from PyQt5.QtWidgets import QApplication
    from webview.platforms.qt import BrowserView

    class Driver(QObject):
        """Entrega eventos na thread gráfica do Qt sem acessar widgets em paralelo."""

        requested = pyqtSignal(str, bool)

        def __init__(self, view: Any) -> None:
            super().__init__()
            self.view = view
            self.done = Event()
            self.requested.connect(self.perform)

        @pyqtSlot(str, bool)
        def perform(self, key: str, shift: bool) -> None:
            target = self.view.focusProxy() or self.view
            target.setFocus()
            modifiers = Qt.ControlModifier | (
                Qt.ShiftModifier if shift else Qt.NoModifier
            )
            QTest.keyClick(target, getattr(Qt, "Key_" + key), modifiers)
            self.done.set()

        def send(self, key: str, shift: bool = False) -> None:
            self.done.clear()
            self.requested.emit(key, shift)
            assert self.done.wait(3)
            time.sleep(0.2)

    driver = Driver(BrowserView.instances[window.uid].webview)
    driver.moveToThread(QApplication.instance().thread())
    window.evaluate_js("document.querySelector('[data-rich]').focus()")
    time.sleep(0.2)
    driver.send("A")
    assert len(window.evaluate_js("window.getSelection().toString()")) > 50
    driver.send("C")
    driver.send("X")
    assert not window.evaluate_js(
        "document.querySelector('[data-rich]').textContent"
    ).strip()
    driver.send("V")
    assert "Um documento começa" in window.evaluate_js(
        "document.querySelector('[data-rich]').textContent"
    )
    driver.send("Z")
    assert window.evaluate_js("document.querySelector('[data-source]').value").strip()
    driver.send("Y")
    driver.send("Z")
    driver.send("Z", shift=True)
    driver.send("S")
    wait_for(window, "window.OpenDocEditor.isClean()")
    print("NATIVE_CTRL_A_C_X_V_Z_Y_SHIFT_Z_S_OK", flush=True)


def run_qa() -> None:
    """Executa VelaApp e verifica comandos no Chromium nativo do Qt."""
    original_start = webview.start
    failures: list[str] = []

    def qa() -> None:
        window = webview.windows[0]
        try:
            wait_for(window, "Boolean(window.OpenDocApp && window.OpenDocApp.editor())")
            assert window.title == "Open Doc"
            assert (
                window.evaluate_js("document.querySelector('[data-rich]').hidden")
                is False
            )
            assert (
                window.evaluate_js("document.querySelector('[data-source]').hidden")
                is True
            )
            print("NATIVE_VELA_BOOT_OK", flush=True)
            result = window.evaluate_js("""(() => {
              const rich = document.querySelector('[data-rich]');
              const text = rich.querySelector('p').firstChild;
              const range = document.createRange();range.setStart(text,0);range.setEnd(text,12);
              const selection=window.getSelection();rich.focus();selection.removeAllRanges();selection.addRange(range);
              const button=document.querySelector('.toolbar [data-command=bold]');
              button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));button.click();
              return {markdown:document.querySelector('[data-source]').value,selected:selection.toString()};
            })()""")
            assert "**" in result["markdown"] and result["selected"]
            window.evaluate_js("window.OpenDocApp.editor().format('undo')")
            assert "**" not in window.evaluate_js(
                "document.querySelector('[data-source]').value"
            )
            window.evaluate_js("window.OpenDocApp.editor().format('redo')")
            assert "**" in window.evaluate_js(
                "document.querySelector('[data-source]').value"
            )
            window.evaluate_js("window.OpenDocApp.editor().format('italic')")
            assert "*" in window.evaluate_js(
                "document.querySelector('[data-source]').value"
            )
            print("NATIVE_SELECTION_BOLD_ITALIC_UNDO_REDO_OK", flush=True)
            window.evaluate_js("window.OpenDocApp.editor().flush()")
            wait_for(window, "window.OpenDocEditor.isClean()")
            assert not window.confirm_close
            for extension in ("pdf", "docx", "md"):
                window.evaluate_js(
                    "window.__qaExport = null; window.OpenDocApp.editor().export('"
                    + extension
                    + "').then(result => window.__qaExport = result).catch(error => window.__qaExport = {error: error.message})"
                )
                exported = wait_for(window, "window.__qaExport")
                assert "error" not in exported, exported
                target = Path(exported["path"])
                assert target.suffix == "." + extension and target.stat().st_size > 0
            print("NATIVE_SAVE_EXPORT_OK", flush=True)
            native_keyboard(window)
            # Return the fixture to its unformatted original content for screenshots.
            document = services().editor.current()
            document = services().editor.save(
                document["id"], document["title"], FIXTURE, document["revision"]
            )
            window.evaluate_js(
                "window.OpenDocApp.editor().load(" + json.dumps(document) + ")"
            )
            window.evaluate_js(
                "document.querySelector('[data-export-result]').textContent=''"
            )
            screenshot_script = ROOT / "tools" / "qa_capture.cjs"
            output = subprocess.run(
                [
                    "node",
                    str(screenshot_script),
                    os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
                ],
                text=True,
                capture_output=True,
                timeout=50,
            )
            print(output.stdout, output.stderr, flush=True)
            assert output.returncode == 0
            window.evaluate_js("window.OpenDocApp.showHome()")
            wait_for(
                window, "document.querySelectorAll('[data-documents] li').length > 0"
            )
            window.evaluate_js("window.OpenDocApp.action('new')")
            wait_for(
                window,
                "document.querySelector('[data-title]').value === 'Documento sem título'",
            )
            window.evaluate_js("window.OpenDocApp.editor().flush()")
            print("NATIVE_RECENT_NEW_AND_CLOSE_OK", flush=True)
        except Exception as error:
            failures.append(str(error))
            print("NATIVE_QA_ERROR", repr(error), flush=True)
        finally:
            # Test cleanup only; avoid a modal blocking CI if an assertion failed.
            window.confirm_close = False
            window.destroy()

    def start(*args: Any, **kwargs: Any) -> None:
        original_start(qa, gui="qt", debug=False)

    webview.start = start
    try:
        with tempfile.TemporaryDirectory(prefix="open-doc-qa-") as folder:
            application = create_app(Config(Path(folder)))
            note = services().editor.current()
            services().editor.save(
                note["id"], "Documento de validação", FIXTURE, note["revision"]
            )
            application.run()
    finally:
        webview.start = original_start
    if failures:
        raise RuntimeError("; ".join(failures))
    print("NATIVE_QA_COMPLETE", flush=True)


if __name__ == "__main__":
    run_qa()

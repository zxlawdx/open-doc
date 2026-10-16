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
from docx import Document
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
            wait(window, "document.querySelectorAll('.document-page').length>=10")
            fixture_id = services().editor.current()["id"]
            imports = []
            for suffix in ["md", "txt"]:
                path = services().config.root / ("import-" + suffix + "." + suffix)
                path.write_text(
                    "Olá, ação e acentuação 🐧\nConteúdo editável.", encoding="utf-8"
                )
                imports.append(path)
            imports.extend(
                [
                    ROOT / "tests/fixtures/visible.pdf",
                    ROOT / "tests/fixtures/visible.pptx",
                    services().config.root / "multipage.docx",
                ]
            )
            dialogs = iter(imports)
            window.create_file_dialog = lambda *args, **kwargs: (str(next(dialogs)),)
            output = subprocess.run(
                [
                    "node",
                    str(ROOT / "tools/qa_stabilization_capture.cjs"),
                    os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
                ],
                capture_output=True,
                text=True,
                timeout=100,
            )
            print(output.stdout, output.stderr, flush=True)
            assert output.returncode == 0
            from qa_runtime import Keyboard

            keyboard = Keyboard(window)
            keyboard.press("Z")
            wait(
                window,
                "document.querySelector('[data-node-id=\"'+__editedId+'\"]').textContent===__beforeText",
            )
            assert window.evaluate_js(
                "__fullRenders===0 && __prefix.every((n,i)=>n===document.querySelector('[data-page-index=\"'+i+'\"]'))"
            )
            keyboard.press("Y")
            time.sleep(0.3)
            window.evaluate_js(
                "(() => {const e=OpenDocApp.editor(),layers=OpenDocCompat.cloneJson(e.inkLayers());layers[0].strokes.push({...layers[0].strokes[0],id:'qa-keyboard'});e.setInkLayers(layers);document.querySelector('[data-ink-mode=pen]').click();})()"
            )
            keyboard.press("Z")
            wait(window, "OpenDocApp.editor().inkLayers()[0].strokes.length===20")
            assert window.evaluate_js("__fullRenders===0")
            print("QT_QTEST_CTRL_Z_Y_TYPING_AND_INK_INCREMENTAL_OK", flush=True)
            for position in [0, 5, -1]:
                window.evaluate_js("""(() => {document.querySelector('[data-ink-mode=cursor]').click();const pages=document.querySelectorAll('.document-page'),page=pages[%d<0?pages.length-1:%d],p=page.querySelector('p[data-node-id]');p.scrollIntoView();const range=document.createRange();range.selectNodeContents(p);range.collapse(false);document.querySelector('[data-rich]').focus();getSelection().removeAllRanges();getSelection().addRange(range);OpenDocApp.editor().capture();window.__pageText=p.textContent;window.__pageId=p.dataset.nodeId;__fullRenders=0;})()""" % (position,position))
                keyboard.type("x")
                time.sleep(0.3)
                keyboard.press("Z")
                wait(window, "document.querySelector('[data-node-id=\"'+__pageId+'\"]').textContent===__pageText")
                assert window.evaluate_js("__fullRenders===0")
            print("QT_QTEST_TYPING_UNDO_FIRST_MIDDLE_LAST_PAGES_OK", flush=True)
            for suffix, title, kind in [
                ("md", "import-md", "rich"),
                ("txt", "import-txt", "rich"),
                ("pdf", "visible", "pdf"),
                ("pptx", "visible", "pptx"),
                ("docx", "multipage", "rich"),
            ]:
                keyboard.press("O")
                wait(
                    window,
                    "document.querySelector('[data-title]').value==="
                    + json.dumps(title)
                    + " && document.querySelector('[data-app]').dataset.sourceKind==="
                    + json.dumps(kind),
                )
                if kind == "pdf":
                    wait(
                        window,
                        "document.querySelector('canvas[data-render-complete=true]')",
                    )
                elif kind == "pptx":
                    wait(window, "document.querySelector('.pptx-content svg')")
                else:
                    assert window.evaluate_js(
                        "document.querySelector('[data-document-body]').hidden===false"
                    )
                if suffix in ["md", "txt"]:
                    assert window.evaluate_js(
                        "document.querySelector('[data-source]').value.includes(String.fromCodePoint(0x1f427))"
                    )
                window.evaluate_js("OpenDocApp.editor().flush()")
            window.evaluate_js("OpenDocApp.action('home')")
            wait(
                window,
                "Array.from(document.querySelectorAll('[data-files] button')).some(b=>b.textContent==='import-md.md')",
            )
            window.evaluate_js(
                "Array.from(document.querySelectorAll('[data-files] button')).find(b=>b.textContent==='import-md.md').click()"
            )
            wait(
                window,
                "document.querySelector('[data-title]').value==='import-md' && document.querySelector('[data-app]').dataset.homeView==='false'",
            )
            window.evaluate_js("OpenDocApp.action('new')")
            wait(
                window,
                "document.querySelector('[data-title]').value==='Documento sem título'",
            )
            assert window.evaluate_js(
                "document.querySelector('[data-document-body]').hidden===false && document.querySelector('.fixed-document').hidden===true"
            )
            print(
                "QT_QTEST_CTRL_O_MD_TXT_PDF_PPTX_DOCX_HOME_NEW_LIFECYCLE_OK", flush=True
            )
            note = services().editor.get(fixture_id)
            assert sum(len(l["strokes"]) for l in note["content"]["ink_layers"]) == 20
            print("QT_DOCX_INK_PERSISTENCE_AND_INCREMENTAL_UNDO_OK", flush=True)
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
            source = Path(folder) / "multipage.docx"
            doc = Document()
            for index in range(10):
                doc.add_paragraph(
                    "Página "
                    + str(index + 1)
                    + " "
                    + ("Texto para verificar seleção, tinta e undo. " * 45)
                )
                if index < 9:
                    doc.add_page_break()
            doc.save(source)
            services().editor.import_docx(source)
            app.run()
    finally:
        webview.start = original_start
    if errors:
        raise RuntimeError("; ".join(errors))


if __name__ == "__main__":
    main()

"""Exercise new DOCX images with actual Qt mouse/keyboard and native file export."""

import json
import sys
import tempfile
from pathlib import Path
from threading import Event

import webview
from docx import Document
from docx.shared import Pt
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from apps.open_doc.services.container import services
from apps.open_doc.services.preferences_service import Config
from config.wsgi import create_app
from qa_docx_list import capture
from qa_runtime import Keyboard, report
from qa_version_history import wait


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    native_start = webview.start

    def exercise():
        from PyQt5.QtCore import QObject, QPoint, Qt, QTimer, pyqtSignal, pyqtSlot
        from PyQt5.QtTest import QTest
        from PyQt5.QtWidgets import (
            QApplication,
            QFileDialog,
            QDialogButtonBox,
            QLineEdit,
        )
        from webview.platforms.qt import BrowserView

        window = webview.windows[0]

        class Driver(QObject):
            requested = pyqtSignal(str, str)

            def __init__(self):
                super().__init__()
                self.done = Event()
                self.error = None
                self.requested.connect(self.perform)

            @pyqtSlot(str, str)
            def perform(self, action, payload):
                try:
                    data = json.loads(payload)
                    target = view.focusProxy() or view
                    if action == "drag":
                        a, b = data
                        QTest.mousePress(target, Qt.LeftButton, pos=QPoint(*a))
                        for step in range(1, 9):
                            point = QPoint(
                                round(a[0] + (b[0] - a[0]) * step / 8),
                                round(a[1] + (b[1] - a[1]) * step / 8),
                            )
                            QTest.mouseMove(target, point, delay=25)
                        QTest.mouseRelease(target, Qt.LeftButton, pos=QPoint(*b))
                        QTest.qWait(200)
                    elif action == "click":
                        QTest.mouseClick(target, Qt.LeftButton, pos=QPoint(*data))
                    elif action == "choose":
                        QApplication.setAttribute(Qt.AA_DontUseNativeDialogs, True)

                        def select(attempt=0):
                            dialogs = [
                                widget
                                for widget in QApplication.topLevelWidgets()
                                if isinstance(widget, QFileDialog)
                                and widget.isVisible()
                            ]
                            if not dialogs:
                                if attempt < 100:
                                    QTimer.singleShot(50, lambda: select(attempt + 1))
                                    return
                                self.error = AssertionError(
                                    "Native image picker did not open"
                                )
                            else:
                                dialog = dialogs[0]
                                dialog.setDirectory(str(Path(data["file"]).parent))
                                dialog.selectFile(Path(data["file"]).name)

                                def confirm():
                                    try:
                                        field = dialog.findChild(
                                            QLineEdit, "fileNameEdit"
                                        )
                                        field.setFocus()
                                        field.selectAll()
                                        QTest.keyClicks(field, data["file"])
                                        print(
                                            "IMAGE_FILE_PICKER",
                                            dialog.selectedFiles(),
                                            flush=True,
                                        )
                                        button = dialog.findChild(
                                            QDialogButtonBox
                                        ).button(QDialogButtonBox.Open)
                                        button.click()
                                    except Exception as exc:
                                        self.error = exc
                                    self.done.set()

                                QTimer.singleShot(200, confirm)
                                return
                            self.done.set()

                        QTimer.singleShot(50, select)
                        QTest.mouseClick(
                            target, Qt.LeftButton, pos=QPoint(*data["point"])
                        )
                        return
                except Exception as exc:
                    self.error = exc
                self.done.set()

            def call(self, action, data, wait_for_done=True):
                self.done.clear()
                self.error = None
                self.requested.emit(action, json.dumps(data))
                if wait_for_done:
                    if not self.done.wait(15):
                        raise AssertionError("Qt image driver timeout: " + action)
                    if self.error:
                        raise self.error

        try:
            report(window)
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            view = BrowserView.instances[window.uid].webview
            keyboard = Keyboard(window)
            driver = Driver()
            driver.moveToThread(QApplication.instance().thread())
            document = Document()
            document.sections[0].page_height = Pt(500)
            document.sections[0].page_width = Pt(595.28)
            document.add_paragraph("Texto preservado ao inserir e mover imagens.")
            document.add_page_break()
            document.add_paragraph("Segunda página preservada.")
            fixture = services().config.root / "image-document.docx"
            document.save(fixture)
            note = services().editor.import_docx(fixture)
            image = services().config.root / "ceramica.png"
            Image.new("RGB", (240, 160), "#a82266").save(image)
            window.evaluate_js(f"OpenDocApp.editor().load({json.dumps(note)})")
            wait(
                window,
                "document.querySelectorAll('[data-rich] .document-page').length===2",
            )
            window.evaluate_js("""(() => {
                const rich=document.querySelector('[data-rich]');rich.focus();
                const range=document.createRange();range.selectNodeContents(rich.querySelector('[data-node-type=text]'));
                getSelection().removeAllRanges();getSelection().addRange(range);OpenDocApp.editor().capture();
            })()""")
            # Complete the actual browser/Qt image chooser, not a mocked upload.
            capture(output, "before-image", width=1100, height=800)
            button = window.evaluate_js(
                """(() => {const r=document.querySelector('.toolbar [data-action=image-insert]').getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)];})()"""
            )
            print(
                "IMAGE_BUTTON",
                button,
                window.evaluate_js(
                    "({width:innerWidth,height:innerHeight,toolbar:document.querySelector('.toolbar').getBoundingClientRect().toJSON()})"
                ),
                flush=True,
            )
            driver.call("choose", {"file": str(image), "point": button})
            wait(
                window,
                "document.querySelector('[data-rich] .rich-image img')?.complete===true",
            )
            image_expr = "OpenDocApp.editor().snapshot().content.blocks.flatMap(b=>b.children||[]).find(n=>n.type==='image')"
            original = window.evaluate_js(image_expr)
            assert original and original["width_pt"] > 0
            assert "Texto preservado" in window.evaluate_js(
                "document.querySelector('[data-rich]').textContent"
            )

            def bounds(selector):
                return window.evaluate_js(
                    f"""(() => {{const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect();return {{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),left:r.left,top:r.top,width:r.width,height:r.height}};}})()"""
                )

            # Real pointer input at non-default paper zoom.
            window.evaluate_js(
                """(() => {const control=document.querySelector('[data-zoom]');control.value='75';control.dispatchEvent(new Event('input',{bubbles:true}));})()"""
            )
            wait(window, "document.querySelector('[data-zoom]').value==='75'")
            box = bounds("[data-rich] .rich-image")
            driver.call("drag", [[box["x"], box["y"]], [box["x"] + 80, box["y"] + 70]])
            moved = window.evaluate_js(image_expr)
            assert moved["x_pt"] > original["x_pt"] + 10, (original, moved)
            keyboard.press("Z")
            wait(window, f'Math.abs(({image_expr}).x_pt-{original["x_pt"]})<0.1')
            keyboard.press("Y")
            wait(window, f'Math.abs(({image_expr}).x_pt-{moved["x_pt"]})<0.1')
            box = bounds("[data-rich] .rich-image")
            driver.call("click", [box["x"], box["y"]])
            capture(output, "before-resize", width=1100, height=800)
            box = bounds("[data-rich] .rich-image [data-image-resize]")
            print("IMAGE_RESIZE_HANDLE", box, flush=True)
            driver.call("drag", [[box["x"], box["y"]], [box["x"] + 45, box["y"] + 30]])
            resized = window.evaluate_js(image_expr)
            assert resized["width_pt"] > moved["width_pt"] + 10, (moved, resized)
            assert abs(resized["width_pt"] / resized["height_pt"] - 1.5) < 0.01
            capture(output, "insert-move-resize", width=1366, height=900)
            window.evaluate_js(
                """(() => {const control=document.querySelector('[data-zoom]');control.value='50';control.dispatchEvent(new Event('input',{bubbles:true}));})()"""
            )
            wait(window, "document.querySelector('[data-zoom]').value==='50'")
            box = bounds("[data-rich] .rich-image")
            page = bounds('[data-rich] [data-page-index="1"]')
            driver.call(
                "drag",
                [
                    [box["x"], box["y"]],
                    [round(page["left"] + 150), round(page["top"] + 100)],
                ],
            )
            wait(
                window,
                "Boolean(document.querySelector('[data-rich] [data-page-index=\"1\"] .rich-image'))",
            )
            resized = window.evaluate_js(image_expr)
            keyboard.press("Z")
            wait(
                window,
                "Boolean(document.querySelector('[data-rich] [data-page-index=\"0\"] .rich-image'))",
            )
            keyboard.press("Y")
            wait(
                window,
                "Boolean(document.querySelector('[data-rich] [data-page-index=\"1\"] .rich-image'))",
            )
            capture(output, "moved-between-pages", width=1100, height=900)
            # Delete and undo must leave the surrounding paragraphs untouched.
            window.evaluate_js(
                "document.querySelector('[data-rich] .rich-image').focus()"
            )
            keyboard.key("Delete")
            wait(window, "!document.querySelector('[data-rich] .rich-image')")
            keyboard.press("Z")
            wait(window, "Boolean(document.querySelector('[data-rich] .rich-image'))")
            window.evaluate_js(
                "OpenDocApp.editor().flush().then(()=>window.__imageSaved=true)"
            )
            wait(window, "window.__imageSaved===true")
            saved = services().editor.get(note["id"])
            target = output / "editable-images.docx"
            services().exports.export(saved["id"], saved["revision"], "docx", target)
            reopened = services().editor.import_docx(target)
            pictures = [
                n
                for b in reopened["content"]["blocks"]
                for n in b.get("children", [])
                if n["type"] == "image"
            ]
            assert len(pictures) == 1
            for key in ("width_pt", "height_pt", "x_pt", "y_pt"):
                assert abs(pictures[0][key] - resized[key]) < 0.01, (
                    key,
                    pictures[0],
                    resized,
                )
            window.evaluate_js(f"OpenDocApp.editor().load({json.dumps(reopened)})")
            wait(
                window,
                "document.querySelector('[data-rich] .rich-image img')?.naturalWidth>0",
            )
            capture(output, "reopened-native-image", width=1366, height=900)
            (output / "result.json").write_text(
                json.dumps(
                    {
                        "inserted": original,
                        "moved": moved,
                        "resized": resized,
                        "reimported": pictures[0],
                    },
                    indent=2,
                )
            )
            print(
                "QT_DOCX_IMAGE_PICKER_DRAG_RESIZE_UNDO_DELETE_SAVE_EXPORT_REIMPORT_OK",
                flush=True,
            )
        except Exception as exc:
            print(
                "IMAGE_QA_STATE",
                window.evaluate_js(
                    "({status:document.querySelector('[data-status]').textContent,files:document.querySelector('[data-docx-image-input]')?.files?.length,images:document.querySelectorAll('.rich-image').length,insert:typeof OpenDocApp.editor().insertImage})"
                ),
                flush=True,
            )
            errors.append(exc)
        finally:
            window.confirm_close = False
            window.destroy()

    def start(*args, **kwargs):
        native_start(exercise, gui="qt", debug=False)

    webview.start = start
    try:
        with tempfile.TemporaryDirectory(prefix="open-doc-images-") as directory:
            create_app(Config(Path(directory))).run()
    finally:
        webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

"""Qt regression: continuous rich text must prepare a drawable paged surface.

Mouse input traverses Qt's native WebEngine focus proxy. Stylus pressure is
synthetic; this does not claim validation of a physical tablet driver.
"""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event

from docx import Document
from qa_stabilization import Config, create_app, services, wait, webview


class Mouse:
    def __init__(self, window):
        from PyQt5.QtCore import QObject, QPoint, Qt, pyqtSignal, pyqtSlot
        from PyQt5.QtTest import QTest
        from PyQt5.QtWidgets import QApplication
        from webview.platforms.qt import BrowserView

        class Driver(QObject):
            requested = pyqtSignal(int, int)

            def __init__(self, view):
                super().__init__()
                self.view = view
                self.done = Event()
                self.requested.connect(self.draw)

            @pyqtSlot(int, int)
            def draw(self, x, y):
                target = self.view.focusProxy() or self.view
                target.setFocus()
                QTest.mousePress(target, Qt.LeftButton, pos=QPoint(x, y))
                for step in range(1, 8):
                    QTest.mouseMove(target, QPoint(x + step * 10, y + step * 3), 10)
                QTest.mouseRelease(target, Qt.LeftButton, pos=QPoint(x + 80, y + 24))
                self.done.set()

        self.driver = Driver(BrowserView.instances[window.uid].webview)
        self.driver.moveToThread(QApplication.instance().thread())

    def draw(self, x, y):
        self.driver.done.clear()
        self.driver.requested.emit(round(x), round(y))
        assert self.driver.done.wait(5), "Qt mouse input timed out"


def exercise(window):
    js = window.evaluate_js
    wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
    js(
        """window.__textModel=()=>{const m=OpenDocCompat.cloneJson(OpenDocApp.editor().snapshot().content);delete m.ink_layers;return JSON.stringify(m);};window.__inkText=__textModel();
      OpenDocApp.editor().pageView('continuous');"""
    )
    assert js("document.querySelectorAll('.document-page,.ink-overlay').length") == 0
    js("document.querySelector('[data-ink-mode=pen]').click()")
    wait(window, "document.querySelector('.document-page > .ink-overlay')")
    assert js("document.querySelector('[data-app]').dataset.pageMode") == "pages"
    assert js("document.querySelector('[data-app]').dataset.inkMode") == "pen"
    assert js("__textModel()===__inkText")
    js("""const zoom=document.querySelector('[data-zoom]');zoom.value='140';
      zoom.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('.ink-overlay').scrollIntoView({block:'start'});""")
    point = js(
        """(() => {const r=document.querySelector('.ink-overlay').getBoundingClientRect();
      return {x:r.left+100,y:Math.max(r.top+100,380)};})()"""
    )
    Mouse(window).draw(point["x"], point["y"])
    wait(window, "OpenDocApp.editor().inkLayers()[0]?.strokes.length===1")
    # Pressure, shapes and erasing use the same prepared surface.
    js("""window.__stroke=(mode,x,y) => {
      document.querySelector('[data-ink-mode="'+mode+'"]').click();
      const svg=document.querySelector('.ink-overlay'),r=svg.getBoundingClientRect();
      for(const [type,dx,p] of [['pointerdown',0,.2],['pointermove',50,.8],['pointerup',90,.4]])
        svg.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:71,
          pointerType:'pen',button:0,buttons:type==='pointerup'?0:1,pressure:p,
          clientX:r.left+x+dx,clientY:r.top+y}));
    };__stroke('highlighter',120,250);__stroke('rectangle',130,350);""")
    wait(window, "OpenDocApp.editor().inkLayers()[0]?.strokes.length===3")
    assert (
        abs(
            js("OpenDocApp.editor().inkLayers()[0].strokes[1].points[0].pressure") - 0.2
        )
        < 0.001
    )
    js("__stroke('eraser',120,250)")
    wait(window, "OpenDocApp.editor().inkLayers()[0]?.strokes.length===2")
    js("OpenDocApp.editor().format('undo')")
    wait(window, "OpenDocApp.editor().inkLayers()[0]?.strokes.length===3")
    js("OpenDocApp.editor().format('redo')")
    wait(window, "OpenDocApp.editor().inkLayers()[0]?.strokes.length===2")
    js("""window.__inkSaved=JSON.stringify(OpenDocApp.editor().inkLayers());
      OpenDocApp.editor().pageView('continuous');""")
    wait(window, "document.querySelector('[data-app]').dataset.inkMode==='cursor'")
    js("document.querySelector('[data-ink-mode=pen]').click()")
    wait(window, "document.querySelector('.document-page > .ink-overlay')")
    assert js("JSON.stringify(OpenDocApp.editor().inkLayers())===__inkSaved")
    js("""window.__inkFlushDone=false;OpenDocApp.editor().flush().then(()=>{
      const e=OpenDocApp.editor(),saved=e.snapshot();e.load(saved);window.__inkFlushDone=true;
    });""")
    wait(window, "window.__inkFlushDone")
    assert js("JSON.stringify(OpenDocApp.editor().inkLayers())===__inkSaved")
    assert js("__textModel()===__inkText")
    print("QT_CONTINUOUS_INK_OK", json.dumps({"strokes": 2, "zoom": 140}), flush=True)


def main():
    original = webview.start
    errors = []

    def qa():
        window = webview.windows[0]
        try:
            exercise(window)
        except Exception as error:  # noqa: BLE001
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *a, **k: original(qa, gui="qt", debug=False)
    try:
        with TemporaryDirectory(prefix="continuous-ink-qa-") as directory:
            root = Path(directory)
            app = create_app(Config(root / "workspace"))
            source = root / "ink.docx"
            doc = Document()
            doc.add_paragraph("Documento para validar desenho no Linux e Windows.")
            doc.save(source)
            services().editor.import_docx(source)
            app.run()
    finally:
        webview.start = original
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

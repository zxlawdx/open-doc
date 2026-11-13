"""Qt regression: continuous rich text must prepare a drawable paged surface.

Mouse input uses Qt's focus proxy on Linux and browser hit testing via CDP on
Windows hosted desktops. Stylus pressure is
synthetic; this does not claim validation of a physical tablet driver.
"""

import json
import os
import subprocess
import sys
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
    hit = js(
        f"document.elementFromPoint({point['x']},{point['y']})?.closest('.ink-overlay')?true:false"
    )
    assert hit, {
        "point": point,
        "viewport": js("[innerWidth,innerHeight,devicePixelRatio]"),
    }
    if (
        os.environ.get("OPEN_DOC_QA_MOUSE", "cdp" if sys.platform == "win32" else "qt")
        == "cdp"
    ):
        # The hosted Windows desktop can deliver QTest mouse events outside the
        # WebEngine viewport. CDP uses viewport coordinates and performs a real
        # browser hit test (unlike dispatchEvent on the SVG).
        script = """
        (async()=>{
          const pages=await(await fetch('http://127.0.0.1:'+process.argv[1]+'/json/list')).json();
          const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
          await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad});
          let id=0;const pending=new Map();
          ws.onmessage=e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p[1](Error(JSON.stringify(r.error))):p[0](r.result)}};
          const send=(method,params)=>new Promise((ok,bad)=>{const n=++id;pending.set(n,[ok,bad]);ws.send(JSON.stringify({id:n,method,params}))});
          const x=Number(process.argv[2]),y=Number(process.argv[3]);
          await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
          for(let i=1;i<=8;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+i*10,y:y+i*3,button:'left',buttons:1});
          await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+80,y:y+24,button:'left',buttons:0,clickCount:1});
          ws.close();
        })().catch(e=>{console.error(e);process.exitCode=1});
        """
        subprocess.run(
            [
                "node",
                "-e",
                script,
                os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
                str(point["x"]),
                str(point["y"]),
            ],
            check=True,
            timeout=20,
        )
    else:
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

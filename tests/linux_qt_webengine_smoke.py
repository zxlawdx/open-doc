"""Real QtWebEngine offscreen rendering smoke test, not a synthetic screenshot."""
import os, sys, json
from pathlib import Path
os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX","1")
os.environ.setdefault("QT_OPENGL","software")
os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE","1")
from PyQt6.QtCore import QTimer, QUrl
from PyQt6.QtWidgets import QApplication
from PyQt6.QtWebEngineWidgets import QWebEngineView

out=Path(os.environ.get("GUI_ARTIFACT_DIR","artifacts"));out.mkdir(parents=True,exist_ok=True)
app=QApplication(sys.argv)
view=QWebEngineView()
view.resize(900,600)
html="""<!doctype html><html><head><style>body{background:#12263a;color:white;font:32px sans-serif}</style></head>
<body><main id="render-probe">Vela / Open Doc GUI probe</main><script>document.body.dataset.js='ok';</script></body></html>"""
state={"loaded":False,"js":False,"screenshot":False}
def capture(ok):
    state["loaded"]=bool(ok)
    if not ok:
        finish();return
    view.page().runJavaScript("document.body.dataset.js === 'ok' && !!document.querySelector('#render-probe')", on_js)
def on_js(ok):
    state["js"]=bool(ok)
    QTimer.singleShot(1000, screenshot)
def screenshot():
    image=view.grab().toImage()
    image.save(str(out/"qt-webengine.png"))
    # Sample non-white, non-uniform pixel distribution in the rendered image.
    colors=set()
    for y in range(30,min(image.height(),500),30):
        for x in range(30,min(image.width(),850),30):
            colors.add(image.pixelColor(x,y).rgb())
    state["screenshot"]=len(colors)>1
    finish()
def finish():
    (out/"qt-result.json").write_text(json.dumps(state,indent=2))
    print(json.dumps(state),flush=True)
    app.exit(0 if all(state.values()) else 1)
view.loadFinished.connect(capture)
QTimer.singleShot(25000,finish)
view.setHtml(html,QUrl("about:blank"))
view.show()
sys.exit(app.exec())

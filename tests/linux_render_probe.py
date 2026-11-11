"""Shared Linux QtWebEngine smoke probe: distinguish a launched window from rendered content."""
import json
import os
import sys
from pathlib import Path

from PyQt6.QtCore import QTimer, QUrl
from PyQt6.QtGui import QColor
from PyQt6.QtWidgets import QApplication
from PyQt6.QtWebEngineWidgets import QWebEngineView

out = Path(os.environ.get("PROBE_OUTPUT", "artifacts"))
out.mkdir(parents=True, exist_ok=True)
app = QApplication(sys.argv)
view = QWebEngineView()
view.resize(800, 500)
html = """<!doctype html><html><body style="margin:0;background:#153b68">
<div id="ready" style="background:#16c784;width:800px;height:500px;color:white;font:40px sans-serif">RENDER OK</div>
<script>window.__probeReady = document.getElementById('ready') !== null;</script>
</body></html>"""
state = {"platform": os.environ.get("QT_QPA_PLATFORM"), "display": os.environ.get("DISPLAY"),
         "wayland_display": os.environ.get("WAYLAND_DISPLAY"), "load_ok": False,
         "js_ready": False, "pixel_ok": False}

def finish():
    image = view.grab().toImage()
    image.save(str(out / "qt-render.png"))
    if not image.isNull():
        color = image.pixelColor(image.width() // 2, image.height() // 2)
        state["pixel_rgb"] = [color.red(), color.green(), color.blue()]
        state["pixel_ok"] = color.green() > 120 and color.green() > color.red()
    (out / "result.json").write_text(json.dumps(state, indent=2))
    print(json.dumps(state), flush=True)
    app.exit(0 if all(state[k] for k in ("load_ok", "js_ready", "pixel_ok")) else 1)

def loaded(ok):
    state["load_ok"] = bool(ok)
    view.page().runJavaScript("window.__probeReady === true", lambda v: (state.update(js_ready=bool(v)), QTimer.singleShot(1000, finish)))

view.loadFinished.connect(loaded)
QTimer.singleShot(20000, lambda: (print("TIMEOUT", flush=True), finish()))
view.setHtml(html, QUrl("http://localhost/"))
view.show()
sys.exit(app.exec())

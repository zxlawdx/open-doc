"""Interactive physical tablet diagnosis. Run on the target computer, not CI.

Compares Qt tablet samples with WebEngine Pointer Events. Output is local JSONL;
no document is opened and no recognizer/model is downloaded. This is a diagnostic,
not a production QTabletEvent fallback: only enable a fallback after observing a
missing or incorrect WebEngine stream on the actual Windows/tablet combination.
"""

import json
import sys
import time
from PyQt5.QtCore import QObject, QEvent, QTimer
from PyQt5.QtWidgets import QApplication
from PyQt5.QtWebEngineWidgets import QWebEnginePage, QWebEngineView

HTML = """<!doctype html><meta charset="utf-8"><title>Diagnóstico de mesa</title>
<style>body{font:18px sans-serif;margin:24px}canvas{border:1px solid #555;width:90vw;height:65vh;touch-action:none}pre{white-space:pre-wrap}</style>
<h1>Diagnóstico de mesa digitalizadora</h1><p>Escreva com pressão leve/forte, incline a caneta, use a borracha e apoie a palma. Feche para encerrar.</p><canvas width="1600" height="900"></canvas><pre></pre>
<script>const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),out=document.querySelector('pre');let batch=[],last=null;
for(const type of ['pointerover','pointerenter','pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','pointerout','click','auxclick','contextmenu'])canvas.addEventListener(type,e=>{if(type==='pointerdown'){try{canvas.setPointerCapture(e.pointerId);}catch{};last=null;}const events=e.getCoalescedEvents?.();for(const p of events?.length?events:[e]){batch.push({type,pointerId:p.pointerId,pointerType:p.pointerType,twist:p.twist,width:p.width,height:p.height,isPrimary:p.isPrimary,pressure:p.pressure,tiltX:p.tiltX,tiltY:p.tiltY,buttons:p.buttons,button:p.button,timeStamp:p.timeStamp,x:p.clientX,y:p.clientY});if(p.buttons && p.pointerType!=='touch'){const r=canvas.getBoundingClientRect(),x=(p.clientX-r.left)*canvas.width/r.width,y=(p.clientY-r.top)*canvas.height/r.height;ctx.lineWidth=1+p.pressure*8;ctx.beginPath();ctx.moveTo(last?.x??x,last?.y??y);ctx.lineTo(x,y);ctx.stroke();last={x,y};}}e.preventDefault();});
setInterval(()=>{if(batch.length){out.textContent=JSON.stringify(batch[batch.length-1],null,2);console.log(JSON.stringify({source:'pointer',samples:batch}));batch=[];}},16);</script>"""


class Page(QWebEnginePage):
    def javaScriptConsoleMessage(self, level, message, line, source):
        print(message, flush=True)


class TabletFilter(QObject):
    def __init__(self):
        super().__init__()
        self.samples = []
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.flush)
        self.timer.start(16)

    def eventFilter(self, obj, event):
        if event.type() in (
            QEvent.TabletPress,
            QEvent.TabletMove,
            QEvent.TabletRelease,
        ):
            self.samples.append(
                {
                    "type": int(event.type()),
                    "pressure": event.pressure(),
                    "tiltX": event.xTilt(),
                    "tiltY": event.yTilt(),
                    "pointerType": int(event.pointerType()),
                    "buttons": int(event.buttons()),
                    "timestamp_ms": event.timestamp(),
                }
            )
        return False

    def flush(self):
        if self.samples:
            print(
                json.dumps({"source": "qtablet", "samples": self.samples}), flush=True
            )
            self.samples = []


if __name__ == "__main__":
    app = QApplication(sys.argv)
    view = QWebEngineView()
    view.setPage(Page(view))
    filter = TabletFilter()
    app.installEventFilter(filter)
    view.setHtml(HTML)
    view.resize(1366, 768)
    view.show()
    print(
        json.dumps(
            {
                "diagnostic": "Open Doc tablet",
                "started": time.time(),
                "note": "Physical Windows/tablet validation requires running this tool on that device.",
            }
        ),
        flush=True,
    )
    sys.exit(app.exec_())

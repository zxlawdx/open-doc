"""Optional real user DOCX regression, with no text logging or screenshots."""

import json
import time
from pathlib import Path


def verify(window, services, keyboard, wait, source):
    source = Path(source)
    original = source.read_bytes()
    note = services().editor.import_docx(source)
    window.evaluate_js("OpenDocApp.editor().load(" + json.dumps(note) + ")")
    time.sleep(1)
    wait(window, "document.querySelectorAll('.document-page').length>0")
    count = window.evaluate_js("document.querySelectorAll('.document-page').length")
    window.evaluate_js(
        "window.__userRenders=0;const r=OpenDocRichRenderer.render;OpenDocRichRenderer.render=(...a)=>{if(a[1].matches('[data-rich]'))__userRenders++;return r(...a);}"
    )
    for index in sorted({0, count // 2, count - 1}):
        window.evaluate_js(
            """(() => {document.querySelector('[data-ink-mode=cursor]').click();const page=document.querySelector('[data-page-index="%d"]'),p=page.querySelector('p[data-node-id]');p.scrollIntoView();const range=document.createRange();range.selectNodeContents(p);range.collapse(false);document.querySelector('[data-rich]').focus();getSelection().removeAllRanges();getSelection().addRange(range);OpenDocApp.editor().capture();window.__userText=p.textContent;window.__userNode=p.dataset.nodeId;__userRenders=0;})()"""
            % index
        )
        keyboard.type("x")
        time.sleep(0.3)
        keyboard.press("Z")
        wait(
            window,
            "document.querySelector('[data-node-id=\"'+__userNode+'\"]').textContent===__userText",
        )
        assert window.evaluate_js("__userRenders===0")
        window.evaluate_js(
            """(() => {document.querySelector('[data-ink-mode=pen]').click();const svg=document.querySelector('[data-page-index="%d"] .ink-overlay'),r=svg.getBoundingClientRect();svg.setPointerCapture=()=>{};for(const [type,x] of [['pointerdown',.2],['pointermove',.3],['pointerup',.4]])svg.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:90,pointerType:'pen',button:0,buttons:1,pressure:.6,clientX:r.left+r.width*x,clientY:r.top+r.height*.2}));})()"""
            % index
        )
        total = window.evaluate_js(
            "OpenDocApp.editor().inkLayers().reduce((n,l)=>n+l.strokes.length,0)"
        )
        keyboard.press("Z")
        wait(
            window,
            "OpenDocApp.editor().inkLayers().reduce((n,l)=>n+l.strokes.length,0)==="
            + str(total - 1),
        )
        keyboard.press("Y")
        wait(
            window,
            "OpenDocApp.editor().inkLayers().reduce((n,l)=>n+l.strokes.length,0)==="
            + str(total),
        )
        assert window.evaluate_js("__userRenders===0")
    window.evaluate_js("OpenDocApp.editor().flush()")
    wait(window, "document.querySelector('[data-app]').dataset.dirty==='false'")
    saved = services().editor.get(note["id"])
    assert sum(
        len(layer["strokes"]) for layer in saved["content"]["ink_layers"]
    ) == len({0, count // 2, count - 1})
    window.evaluate_js("OpenDocApp.editor().load(" + json.dumps(saved) + ")")
    assert source.read_bytes() == original
    print(
        "QT_PRIVATE_IMPORTED_DOCX_FIRST_MIDDLE_LAST_TYPING_INK_HISTORY_SAVE_REOPEN_OK",
        flush=True,
    )

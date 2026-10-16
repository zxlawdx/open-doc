"""Checks executed inside the real Vela Qt window by qa_desktop.py."""

import json
import time
from pathlib import Path
from uuid import uuid4


def verify_pages(window, services, wait_for):
    def js(code):
        return window.evaluate_js(code)

    def paragraph(text):
        return {
            "id": str(uuid4()),
            "type": "paragraph",
            "style": {},
            "children": [
                {"id": str(uuid4()), "type": "text", "text": text, "style": {}}
            ],
        }

    blocks = [
        paragraph(("Página de teste com conteúdo editável. " * 8) + str(i))
        for i in range(30)
    ]
    blocks.append(paragraph("Parágrafo longo com fragmentação visual. " * 700))
    blocks.append(
        {
            "id": str(uuid4()),
            "type": "table",
            "rows": [
                {
                    "id": str(uuid4()),
                    "cells": [
                        {
                            "id": str(uuid4()),
                            "col_span": 1,
                            "row_span": 1,
                            "blocks": [paragraph("Célula da linha " + str(i))],
                        }
                    ],
                }
                for i in range(45)
            ],
        }
    )
    model = {
        "version": "opendoc-rich-v1",
        "blocks": blocks,
        "sections": [
            {
                "id": str(uuid4()),
                "type": "section",
                "page_width_pt": 595.28,
                "page_height_pt": 841.89,
                "margin_top_pt": 56.7,
                "margin_bottom_pt": 56.7,
                "margin_left_pt": 56.7,
                "margin_right_pt": 56.7,
            }
        ],
        "styles": {},
        "numbering": {},
        "media": {},
        "headers": {},
        "footers": {},
        "footnotes": {},
        "endnotes": {},
        "comments": {},
        "metadata": {},
        "preserved_parts": [],
    }
    note = services().editor.create_rich_copy("Paginação Qt", model)
    js(
        "window.OpenDocApp.editor().load("
        + json.dumps(note)
        + ');window.OpenDocApp.editor().pageView("pages")'
    )
    wait_for(window, "document.querySelectorAll('[data-page-index]').length > 5")
    geometry = js(
        "Array.from(document.querySelectorAll('[data-page-index]')).map(p=>({height:p.getBoundingClientRect().height,content:p.querySelector('[data-page-content]').getBoundingClientRect().height,capacity:parseFloat(p.style.height)*4/3-parseFloat(p.style.paddingTop)*4/3-parseFloat(p.style.paddingBottom)*4/3}))"
    )
    assert all(p["content"] <= p["capacity"] + 2 for p in geometry), geometry
    assert js("document.querySelectorAll('[data-fragment-of]').length") > 0
    js(
        "document.querySelector('[data-rich]').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}))"
    )
    snapshot = js("window.OpenDocApp.editor().snapshot()")
    assert len(snapshot["content"]["blocks"]) == len(blocks)
    assert (
        snapshot["content"]["blocks"][-2]["children"][0]["text"]
        == blocks[-2]["children"][0]["text"]
    )
    assert len(snapshot["content"]["blocks"][-1]["rows"]) == 45
    time.sleep(0.4)
    # An edit to the last page must leave the earlier page DOM intact.
    js(
        "window.__firstPage=document.querySelector('[data-page-index]');const p=Array.from(document.querySelectorAll('[data-rich] td p')).pop();const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);document.querySelector('[data-rich]').focus();p.appendChild(document.createTextNode(' Alterada'));document.querySelector('[data-rich]').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}))"
    )
    time.sleep(0.4)
    assert js("window.__firstPage===document.querySelector('[data-page-index]')")
    assert "Alterada" in str(js("window.OpenDocApp.editor().snapshot().content"))

    import subprocess, os

    capture = subprocess.run(
        [
            "node",
            str(Path(__file__).with_name("qa_pages_capture.cjs")),
            os.environ.get("QTWEBENGINE_REMOTE_DEBUGGING", "9234"),
        ],
        text=True,
        capture_output=True,
        timeout=20,
    )
    print(capture.stdout, flush=True)
    assert capture.returncode == 0, capture.stderr

    # Ctrl+Enter travels through Qt's keyboard event pipeline.
    from threading import Event
    from PyQt5.QtCore import QObject, Qt, pyqtSignal, pyqtSlot
    from PyQt5.QtWidgets import QApplication
    from PyQt5.QtTest import QTest
    from webview.platforms.qt import BrowserView

    class Keyboard(QObject):
        requested = pyqtSignal()

        def __init__(self):
            super().__init__()
            self.done = Event()
            self.requested.connect(self.send)

        @pyqtSlot()
        def send(self):
            view = BrowserView.instances[window.uid].webview
            target = view.focusProxy() or view
            target.setFocus()
            QTest.keyClick(target, Qt.Key_Return, Qt.ControlModifier)
            self.done.set()

    keyboard = Keyboard()
    keyboard.moveToThread(QApplication.instance().thread())
    js(
        "const span=document.querySelector('[data-rich] p span');const range=document.createRange();range.setStart(span.firstChild,10);range.collapse(true);document.querySelector('[data-rich]').focus();getSelection().removeAllRanges();getSelection().addRange(range)"
    )
    keyboard.requested.emit()
    assert keyboard.done.wait(3)
    wait_for(
        window,
        "window.OpenDocApp.editor().snapshot().content.blocks.some(b=>b.type==='page_break')",
    )
    assert (
        js(
            "window.OpenDocApp.editor().snapshot().content.blocks[0].children.map(r=>r.text || '').join('').length"
        )
        == 10
    )
    js("document.querySelector('.toolbar [data-command=undo]').click()")
    assert not js(
        "window.OpenDocApp.editor().snapshot().content.blocks.some(b=>b.type==='page_break')"
    )
    js("document.querySelector('.toolbar [data-command=redo]').click()")
    assert js(
        "window.OpenDocApp.editor().snapshot().content.blocks.some(b=>b.type==='page_break')"
    )
    time.sleep(0.3)
    # Import a genuinely new family through the native bridge; picker alone is stubbed.
    from test_native_services import make_font
    import webview

    font = services().config.root / "OpenDoc Test.ttf"
    make_font(font, True)
    original = window.create_file_dialog
    window.create_file_dialog = lambda *a, **kw: (str(font),)
    try:
        js("document.querySelector('[data-action=font-import]').click()")
        wait_for(
            window,
            "Boolean(document.querySelector('[data-font-family] option[value=\"OpenDoc Test TTF\"]'))",
        )
    finally:
        window.create_file_dialog = original
    js(
        "const text=document.querySelector('[data-rich] p span').firstChild;const r=document.createRange();r.selectNodeContents(text);getSelection().removeAllRanges();getSelection().addRange(r);window.OpenDocApp.editor().capture();const select=document.querySelector('[data-font-family]');select.value='OpenDoc Test TTF';select.dispatchEvent(new Event('change',{bubbles:true}))"
    )
    assert "OpenDoc Test TTF" in str(
        js("window.OpenDocApp.editor().snapshot().content.blocks[0]")
    )
    js("window.OpenDocApp.editor().flush()")
    wait_for(window, "window.OpenDocEditor.isClean()")
    from docx import Document

    saved = services().editor.current()
    target = services().config.root / "exports" / "Páginas Qt.docx"
    services().exports.export(saved["id"], saved["revision"], "docx", target)
    exported = Document(target)
    assert any(
        run.font.name == "OpenDoc Test TTF"
        for paragraph in exported.paragraphs
        for run in paragraph.runs
    )
    assert 'w:type="page"' in exported.element.xml
    print("NATIVE_CTRL_ENTER_UNDO_REDO_FONT_IMPORT_APPLY_DOCX_OK", flush=True)
    # Right click on page chrome opens the menu; text click leaves it closed.
    js(
        "document.querySelector('[data-page-index]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))"
    )
    assert js("document.querySelector('[data-page-menu]').hidden") is False
    js(
        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
    )
    assert js("document.querySelector('[data-page-menu]').hidden") is True
    js(
        "document.querySelector('[data-rich] p').dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}))"
    )
    assert js("document.querySelector('[data-page-menu]').hidden") is True
    js("window.OpenDocApp.editor().pageView('continuous')")
    assert js("document.querySelectorAll('[data-page-index]').length") == 0
    js("window.OpenDocApp.editor().pageView('pages')")
    assert js("document.querySelectorAll('[data-page-index]').length") > 5
    js("window.OpenDocApp.editor().flush()")
    wait_for(window, "window.OpenDocEditor.isClean()")
    print(
        "NATIVE_PAGES_LONG_PARAGRAPH_TABLE_REFLOW_MENU_CONTINUOUS_SAVE_OK", flush=True
    )

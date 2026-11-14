"""Validate appearance and zoom in the real Vela Qt window on Linux and Windows."""

import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

from qa_docx_list import capture, wait
from qa_runtime import Keyboard, report

import webview
from fpdf import FPDF

from config.composition import services
from shared.services.preferences_service import Config
from config.wsgi import create_app


def exercise(window, output, reopen):
    js = window.evaluate_js

    def click(selector):
        js(f"document.querySelector({selector!r}).click()")

    def zoom(value):
        wait(window, f"document.querySelector('[data-zoom]').value === '{value}'")

    def set_zoom(value):
        js(f"""(() => {{
          const control = document.querySelector('[data-zoom]');
          control.value = {value};
          control.dispatchEvent(new Event('input', {{bubbles:true}}));
        }})()""")
        zoom(value)

    def theme(value, button=".header-actions [data-action=theme]"):
        click(button)
        wait(window, "!document.querySelector('[data-dialog]').hidden")
        js(f"document.querySelector('[data-dialog-select]').value = '{value}'")
        click("[data-dialog-confirm]")
        wait(
            window,
            f"document.querySelector('[data-app]').dataset.themePreference === '{value}'",
        )

    def capture_module(name):
        for appearance in ("light", "dark"):
            theme(appearance)
            for value in (80, 100, 150):
                set_zoom(value)
                if name == "pdf":
                    wait(
                        window,
                        "!!document.querySelector('.fixed-surface canvas[data-render-complete=true]')",
                    )
                capture(output, f"{name}-{appearance}-{value}")

    wait(window, "document.querySelector('[data-app]')?.dataset.ready === 'true'")
    report(window)
    if reopen:
        zoom(120)
        assert js("document.querySelector('[data-app]').dataset.theme") == "dark"
        capture(output, "central-reaberta")
        return

    keyboard = Keyboard(window)
    js("document.querySelector('[data-library-search]').focus()")
    keyboard.press("F")
    wait(window, "document.activeElement.matches('[data-library-search]')")
    keyboard.press("Plus")
    zoom(110)
    keyboard.press("Minus")
    zoom(100)
    keyboard.press("Minus")
    zoom(90)
    keyboard.press("0")
    zoom(100)

    for appearance in ("light", "dark"):
        theme(appearance)
        for value in (80, 100, 150):
            set_zoom(value)
            capture(output, f"central-{appearance}-{value}", width=960, height=720)
            bounds = js("""(() => {
              const bar = document.querySelector('[data-zoom-value]').getBoundingClientRect();
              const button = document.querySelector('.header-actions [data-action=theme]').getBoundingClientRect();
              const app = document.querySelector('[data-app]').getBoundingClientRect();
              return {bar: bar.toJSON(), button: button.toJSON(), app: app.toJSON(), width:innerWidth,height:innerHeight};
            })()""")
            assert bounds["bar"]["bottom"] <= bounds["app"]["bottom"] + 1, bounds
            assert bounds["button"]["right"] <= bounds["app"]["right"] + 1, bounds
            assert bounds["bar"]["width"] > 0 and bounds["button"]["width"] > 0, bounds
    set_zoom(100)
    for width, height, dpi in (
        (1280, 720, 1),
        (1366, 768, 1),
        (1600, 900, 1),
        (1920, 1080, 1),
        (2560, 1440, 1),
        (1280, 720, 1.25),
        (1280, 720, 1.5),
        (1280, 720, 2),
    ):
        capture(output, f"sidebar-{width}x{height}-dpr{dpi:g}", width, height, dpi)
        spacing = js("""(() => {
          const rows = [...document.querySelectorAll('.home-side-nav button, .product')];
          return rows.map(row => {
            const icon = row.querySelector('svg').getBoundingClientRect();
            const label = row.querySelector('span:last-child').getBoundingClientRect();
            return Math.round(label.left - icon.right);
          });
        })()""")
        assert len(spacing) > 10 and min(spacing) >= 8, (width, height, dpi, spacing)
    capture(output, "sidebar-restaurada", 1280, 720)
    js("document.querySelector('.header-actions [data-action=theme]').focus()")
    click(".header-actions [data-action=theme]")
    keyboard.key("Escape")
    wait(window, "document.querySelector('[data-dialog]').hidden")
    assert js("document.activeElement.matches('.header-actions [data-action=theme]')")

    theme("system")
    assert js("document.querySelector('[data-app]').dataset.theme") == (
        "dark" if js("matchMedia('(prefers-color-scheme: dark)').matches") else "light"
    )
    theme("dark")
    set_zoom(120)

    click("[data-action=resume-editor]")
    zoom(100)
    js("document.querySelector('[data-rich]').focus()")
    keyboard.type("Teste de zoom e tema")
    wait(
        window,
        "document.querySelector('[data-rich]').textContent.includes('Teste de zoom e tema')",
    )
    # Native Qt typing and its logical transaction may finish after keyClicks
    # returns. Establish a committed baseline before checking zoom invariance.
    js("OpenDocApp.editor().flush().then(()=>window.__appearanceTypingSaved=true)")
    wait(window, "window.__appearanceTypingSaved===true")
    before = js("JSON.stringify(OpenDocApp.editor().snapshot().content)")
    click("[data-zoom-step='10']")
    zoom(110)
    assert js("JSON.stringify(OpenDocApp.editor().snapshot().content)") == before
    theme("light", "[data-menu-panel=tools] [data-action=theme]")
    theme("dark", "[data-menu-panel=tools] [data-action=theme]")
    capture_module("docx")

    click("[data-action=presentation-new]")
    wait(
        window,
        "document.querySelector('.fixed-surface .slide-object, .slide-stage') || document.querySelector('[data-slide-editor=true] .fixed-surface')",
    )
    # Native Qt typing and its logical transaction may finish after keyClicks
    # returns. Establish a committed baseline before checking zoom invariance.
    js("OpenDocApp.editor().flush().then(()=>window.__appearanceTypingSaved=true)")
    wait(window, "window.__appearanceTypingSaved===true")
    before = js("JSON.stringify(OpenDocApp.editor().snapshot().content)")
    keyboard.press("0")
    zoom(100)
    click("[data-zoom-step='10']")
    zoom(110)
    assert js("JSON.stringify(OpenDocApp.editor().snapshot().content)") == before
    # A scripted click leaves focus wherever the previous editor left it.
    # Start from a visible control and wait for Qt to deliver the native key.
    zoom_button = "[data-zoom-step='10']"
    js(f"document.querySelector({zoom_button!r}).focus()")
    wait(window, f"document.activeElement.matches({zoom_button!r})")
    keyboard.press("F")
    wait(
        window,
        "document.activeElement.matches("
        "'.fixed-document[data-slide-editor=true][data-search-open=true] "
        ".fixed-controls input[type=search]')",
    )
    zoom(110)
    capture_module("pptx")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=14)
    pdf.text(10, 30, "Open Doc QA")
    source = services().config.root / "appearance-qa.pdf"
    pdf.output(source)
    note = services().fixed_documents.import_pdf(source)
    js(f"OpenDocApp.editor().load({json.dumps(note)})")
    wait(window, "document.querySelector('[data-app]').dataset.readerState === 'ready'")
    keyboard.press("0")
    zoom(100)
    before = source.read_bytes()
    click("[data-zoom-step='-10']")
    zoom(90)
    assert source.read_bytes() == before
    capture_module("pdf")

    click(".product")
    zoom(120)
    click("[data-library-route=xlsx]")
    click("[data-library-primary]")
    wait(window, "!document.querySelector('[data-workbook]').hidden")
    zoom(100)
    js("document.querySelector('[data-book-formula]').focus()")
    keyboard.type("=1+2")
    keyboard.press("Plus")
    zoom(110)
    assert js("document.querySelector('[data-book-formula]').value") == "=1+2"
    keyboard.key("Escape")
    click("[data-workbook] [data-ribbon-tab=code]")
    wait(window, "!!document.querySelector('[data-book-analysis] .cm-editor')")
    assert js(
        """getComputedStyle(document.querySelector('[data-book-analysis] .cm-editor'))
        .backgroundColor === getComputedStyle(document.querySelector('.app-header')).backgroundColor"""
    )
    capture_module("planilha")
    js("""[...document.querySelectorAll('[data-workbook] button')]
        .find(button => button.title === 'Tela inteira').click()""")
    zoom(120)
    assert (
        js("document.querySelector('[data-zoom-label]').textContent")
        == "Zoom da interface"
    )
    capture_module("codigo")
    set_zoom(120)

    click(".product")
    wait(window, "!document.querySelector('[data-library]').hidden")
    zoom(120)
    click("[data-library] [data-action=datasets]")
    wait(window, "!document.querySelector('[data-dataset]').hidden")
    zoom(120)
    source = services().config.root / "appearance-qa.csv"
    source.write_text("id,nome\n001,Ana\n002,Bia\n", encoding="utf-8")
    picker = window.create_file_dialog
    try:
        window.create_file_dialog = lambda *args, **kwargs: (str(source),)
        click("[data-dataset-command=new]")
        wait(
            window,
            "document.querySelector('[data-dataset-table] td')?.textContent === '001'",
        )
    finally:
        window.create_file_dialog = picker
    capture_module("dados")
    set_zoom(120)
    wait(window, "document.querySelector('[data-app]').dataset.theme === 'dark'")


def run(output, workspace, reopen):
    original_start = webview.start
    errors = []

    def qa():
        window = webview.windows[0]
        try:
            exercise(window, output, reopen)
        except Exception as error:
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *args, **kwargs: original_start(qa, gui="qt", debug=False)
    try:
        create_app(Config(workspace), start_in_library=True).run()
    finally:
        webview.start = original_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 2:
        run(output, Path(sys.argv[2]), sys.argv[3] == "reopen")
    else:
        with TemporaryDirectory(prefix="open-doc-appearance-qa-") as directory:
            for phase in ("exercise", "reopen"):
                subprocess.run(
                    [sys.executable, __file__, str(output), directory, phase],
                    check=True,
                    timeout=240,
                    env=os.environ.copy(),
                )
        print("QT_GLOBAL_APPEARANCE_ZOOM_OK", flush=True)

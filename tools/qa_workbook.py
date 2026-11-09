"""Exercise workbook navigation and editing on QtWebEngine."""

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from qa_docx_list import capture, wait

import webview

from apps.open_doc.application.context import get_context
from apps.open_doc.services.preferences_service import Config
from config.wsgi import create_app


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    native_start = webview.start

    def exercise():
        window = webview.windows[0]
        js = window.evaluate_js

        def click(selector):
            js(f"document.querySelector({json.dumps(selector)}).click()")

        def type_formula(text):
            js(f"""(() => {{
                const formula=document.querySelector('[data-book-formula]');
                formula.focus();
                formula.value={json.dumps(text)};
                formula.dispatchEvent(new Event('input',{{bubbles:true}}));
                formula.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',bubbles:true}}));
            }})()""")

        try:
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            click(".home-side-nav [data-library-route=xlsx]")
            wait(window, "document.querySelectorAll('[data-template-id^=sheet-]:not([hidden])').length===5")
            capture(output, "templates")
            click("[data-template-id=sheet-budget]")
            wait(window, "!document.querySelector('[data-dialog]').hidden")
            click("[data-dialog-confirm]")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='20'")
            js("""document.querySelector('[data-cell="1,1"]').dispatchEvent(
              new MouseEvent('dblclick',{bubbles:true}));""")
            wait(window, "document.activeElement.matches('[data-book-inline]')")
            capture(output, "inline")
            js("""(() => {
              const field=document.querySelector('[data-book-inline]');
              field.value='2000';
              field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
            })()""")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='520'")
            click("[data-book-command=undo]")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='20'")
            click("[data-book-command=redo]")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='520'")
            click('[data-cell="1,3"]')
            capture(output, "editor")
            click("[data-book-command=add]")
            wait(window, "document.querySelectorAll('[data-book-tabs] button').length===2")
            type_formula("=Exemplo!D2")
            wait(window, "document.querySelector('[data-cell=\"0,0\"]')?.textContent==='520'")
            click(".product")
            wait(window, "document.querySelector('[data-library]').hidden===false")
            wait(window, "document.querySelector('[data-library-recent] .library-file-title')?.textContent==='Orçamento doméstico'")
            assert get_context().workbooks.list()[0]["revision"] == 2
            click("[data-library-recent] .library-file-title")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='520'")
            assert js("document.querySelectorAll('[data-cell]').length<1500")
            click("[data-book-command=pivot]")
            wait(window, "!document.querySelector('[data-book-sidebar]').hidden")
            js("document.querySelector('[data-pivot-range]').value='A1:D2'")
            click("[data-book-command=pivot-fields]")
            wait(window, "document.querySelectorAll('[data-pivot-field]').length===4")
            click('[data-pivot-add="0"]')  # Categoria -> Linhas
            js("document.querySelector('[data-pivot-choice=\"3\"]').value='values'")
            click('[data-pivot-add="3"]')  # Saldo -> Valores
            wait(window, """Array.from(document.querySelectorAll('[data-pivot-preview] td'))
              .some(cell=>cell.textContent==='520')""")
            js("document.querySelector('[data-pivot-choice=\"1\"]').value='values'")
            click('[data-pivot-add="1"]')  # Previsto -> segunda métrica
            wait(window, "document.querySelectorAll('[data-pivot-chips=values] .pivot-v2-chip').length===2")
            assert js("""Array.from(document.querySelectorAll('[data-pivot-preview] td'))
              .some(cell=>cell.textContent==='2000')""")
            capture(output, "pivot")
            for width in (1920, 1500, 1000, 800, 390):
                capture(output, f"pivot-{width}", width=width)
            capture(output, "pivot-narrow", width=640)
            assert js("""(() => {
                const panel=document.querySelector('[data-book-sidebar]');
                return innerWidth===640 && getComputedStyle(panel).position==='fixed' &&
                  panel.getBoundingClientRect().right<=innerWidth+2 &&
                  panel.getBoundingClientRect().left>=-2;
            })()""")
            assert js("""(() => {
                const available=document.querySelector('.pivot-v2-field-panel');
                const firstZone=document.querySelector('[data-pivot-zone=rows]');
                const list=document.querySelector('[data-pivot-available]');
                return available.getBoundingClientRect().bottom+2<=firstZone.getBoundingClientRect().top &&
                  list.getBoundingClientRect().bottom<=available.getBoundingClientRect().bottom+1;
            })()""")
            capture(output, "pivot")
            click("[data-book-command=pivot-create]")
            wait(window, "document.querySelectorAll('[data-book-tabs] button').length===3")
            wait(window, "document.querySelector('[data-cell=\"1,1\"]')?.textContent==='520'")
            wait(window, "document.querySelector('[data-cell=\"1,2\"]')?.textContent==='2000'")
            click("[data-book-command=undo]")
            wait(window, "document.querySelectorAll('[data-book-tabs] button').length===2")
            click('[data-cell="1,1"]')
            type_formula("2050")
            click("[data-ribbon-tab=analysis]")
            wait(window, "!!document.querySelector('#book-sql + .dataset-code-editor .cm-editor')")
            click("[data-book-command=run-sql]")
            wait(window, "document.querySelector('[data-book-query-results] tbody tr')?.cells[1]?.textContent==='2050'")
            confirm=window.create_confirmation_dialog
            window.create_confirmation_dialog=lambda *args: True
            try:
                click("[data-book-command=run-python]")
                wait(window, "document.querySelector('[data-book-python-output]').textContent.includes('Total de registros: 2')")
            finally:
                window.create_confirmation_dialog=confirm
            capture(output, "analysis")
            print("QT_WORKBOOK_INLINE_PIVOT_SQL_PYTHON_OK", flush=True)
        except Exception as error:
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *args, **kwargs: native_start(exercise, gui="qt", debug=False)
    try:
        with TemporaryDirectory(prefix="open-doc-workbook-qa-") as directory:
            create_app(Config(Path(directory)), start_in_library=True).run()
    finally:
        webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

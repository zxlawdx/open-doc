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
            click('[data-cell="1,1"]')
            type_formula("2000")
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
            print("QT_WORKBOOK_TEMPLATE_EDIT_UNDO_SAVE_REOPEN_OK", flush=True)
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

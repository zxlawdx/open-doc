"""Verify all template preview renderers and personal copies in Qt."""

import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from qa_docx_list import capture, wait

import webview

from shared.services.preferences_service import Config
from config.wsgi import create_app


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    native_start = webview.start

    def exercise():
        window = webview.windows[0]
        js = window.evaluate_js
        try:
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            js("document.querySelector('[data-library-route=templates]').click()")
            for identifier, selector in (
                ("field-report", ".template-paper h1"),
                ("research-deck", ".pptx-thumbnail"),
                ("review-sheet", "canvas"),
                ("sheet-budget", "table td"),
                ("academic-article", ".template-paper"),
                ("academic-defense", ".pptx-thumbnail"),
                ("sheet-research-budget", "table td"),
            ):
                wait(window, f"!!document.querySelector('[data-template-id={identifier}]')")
                js(f"document.querySelector('[data-template-id={identifier}]').scrollIntoView({{block:'center'}})")
                wait(window, f"!!document.querySelector('[data-template-id={identifier}] {selector}')")
            capture(output, "gallery")
            js("document.querySelector('[data-template-id=sheet-budget]').click()")
            wait(window, "!!document.querySelector('.template-preview-expanded table')")
            js("document.querySelector('[data-dialog-confirm]').click()")
            wait(window, "document.querySelector('[data-workbook]').hidden===false")
            js("document.querySelector('[data-workbook] [data-action=template-save]').click()")
            wait(window, "!document.querySelector('[data-dialog]').hidden")
            js("document.querySelector('[data-dialog-input]').value='Meu orçamento';document.querySelector('[data-dialog-confirm]').click()")
            wait(window, "document.querySelector('[data-book-status]').textContent.includes('Template salvo')")
            js("document.querySelector('.product').click()")
            wait(window, "document.querySelector('[data-library]').hidden===false")
            js("document.querySelector('[data-library-route=templates]').click()")
            wait(window, "!!document.querySelector('[data-category=\"Meus templates\"]')")
            js("""(() => {
              const category=document.querySelector('[data-template-category]');
              category.value='Meus templates';
              category.dispatchEvent(new Event('change'));
            })()""")
            wait(window, "!!document.querySelector('[data-category=\"Meus templates\"] table')")
            print("QT_TEMPLATE_PREVIEWS_AND_PERSONAL_COPY_OK", flush=True)
        except Exception as error:
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *args, **kwargs: native_start(exercise, gui="qt", debug=False)
    try:
        with TemporaryDirectory(prefix="open-doc-template-preview-qa-") as directory:
            create_app(Config(Path(directory)), start_in_library=True).run()
    finally:
        webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

"""Check the offline template center in Qt and capture its main screens."""

import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import webview

from apps.open_doc.services.preferences_service import Config
from config.wsgi import create_app
from qa_docx_list import capture, wait


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("QTWEBENGINE_REMOTE_DEBUGGING", "9248")
    errors = []
    start = webview.start

    def exercise():
        window = webview.windows[0]
        js = window.evaluate_js

        def click(selector):
            js(f"document.querySelector({json.dumps(selector)}).click()")

        try:
            wait(window, "document.querySelectorAll('[data-template-id]').length === 10")
            assert js("document.querySelector('[data-app]').dataset.homeView === 'true'")
            capture(output, "central")
            for route, template, kind in (
                ("docx", "field-report", "rich"),
                ("pptx", "research-deck", "fixed"),
                ("pdf", "review-sheet", "fixed"),
            ):
                click(f".home-side-nav [data-library-route={route}]")
                selector = f"[data-template-id={template}]"
                wait(window, f"document.querySelector('{selector}')?.hidden === false")
                capture(output, "templates-" + route)
                click(selector)
                wait(window, "!document.querySelector('[data-dialog]').hidden")
                click("[data-dialog-confirm]")
                wait(window, "document.querySelector('[data-app]').dataset.homeView === 'false'")
                assert js(f"document.querySelector('[data-app]').dataset.documentKind === '{kind}'")
                if kind == "fixed":
                    assert js(f"OpenDocApp.editor().snapshot().content.source_kind === '{route}'")
                click(".product")
            print("QT_OFFLINE_TEMPLATE_CENTER_OK", flush=True)
        except Exception as error:
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *args, **kwargs: start(exercise, gui="qt", debug=False)
    try:
        with TemporaryDirectory(prefix="open-doc-templates-qa-") as directory:
            create_app(Config(Path(directory)), start_in_library=True).run()
    finally:
        webview.start = start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

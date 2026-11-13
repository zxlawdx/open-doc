"""Verify PDF outline hierarchy, long-document navigation and lazy thumbnails in Qt."""

import hashlib
import json
import os
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from time import sleep

from fpdf import FPDF
from pypdf import PdfReader, PdfWriter
from qa_runtime import Keyboard
from qa_stabilization import Config, create_app, services, wait, webview

OUTPUT = Path(
    os.environ.get("OPEN_DOC_PDF_NAV_OUTPUT", "docs/images/pdf-navigation")
).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)


def fixture(path):
    document = FPDF(unit="pt", format=(595, 842))
    document.set_auto_page_break(False)
    for index in range(1016):
        document.add_page()
        document.set_font("Helvetica", size=15)
        document.text(72, 90, "PDF navigation validation - page " + str(index + 1))
        if index == 973:
            document.set_font("Helvetica", size=24)
            document.text(72, 180, "Clonando o repositorio")
            document.set_font("Helvetica", size=12)
            document.text(
                72, 220, "Navigation keeps chapters, sections and page position."
            )
    writer = PdfWriter()
    writer.append(PdfReader(BytesIO(bytes(document.output()))))
    parents = {}
    for level, title, page in [
        [1, "Prefácio", 1],
        [1, "Instalação", 2],
        [1, "Notação", 3],
        [1, "Introdução", 4],
        [2, "Objetivos", 5],
        [2, "Método", 6],
        [1, "Apêndice: ferramentas", 970],
        [2, "Contribuindo", 972],
        [3, "Código fonte", 973],
        [4, "Clonando o repositório", 974],
        [1, "Bibliography", 1000],
        [1, "Python Module Index", 1007],
        [1, "Index", 1010],
    ]:
        parents[level] = writer.add_outline_item(
            title, page - 1, parent=parents.get(level - 1), is_open=False
        )
    writer.write(path)


def outline_entries(reader):
    entries = []

    def walk(items, level):
        for item in items:
            if isinstance(item, list):
                walk(item, level + 1)
            else:
                entries.append(
                    [level, item.title, reader.get_destination_page_number(item) + 1]
                )

    walk(reader.outline, 1)
    return entries


def capture(window, name):
    import subprocess

    subprocess.run(
        [
            "node",
            str(Path(__file__).with_name("qa_office_capture.cjs")),
            os.environ.get("QTWEBENGINE_REMOTE_DEBUGGING", "9234"),
            str(OUTPUT / name),
            "1920",
            "1080",
        ],
        check=True,
        timeout=30,
    )


def exercise(window, source, expected):
    js = window.evaluate_js
    wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
    wait(window, "document.querySelector('.pdf-outline-tree [role=treeitem]')")
    roots = js(
        "[...document.querySelectorAll('.pdf-outline-tree > [role=treeitem]')].map(n=>n.getAttribute('aria-label'))"
    )
    assert roots == [title for level, title, _ in expected if level == 1], roots
    assert js(
        "document.querySelectorAll('.pdf-outline-tree [role=treeitem]').length"
    ) == len(expected)
    assert (
        js("document.querySelectorAll('.fixed-sidebar [data-thumbnail-index]').length")
        == 0
    )
    assert (
        js("document.querySelector('.fixed-sidebar').getBoundingClientRect().width")
        >= 200
    )
    capture(window, "outline-overview.png")
    target = next(entry for entry in expected if entry[1] == "Clonando o repositório")
    js("""(() => {
      const link=[...document.querySelectorAll('.pdf-outline-title')].find(n=>n.textContent==='Clonando o repositório');
      const parents=[];let node=link.closest('[role=treeitem]').parentElement.closest('[role=treeitem]');
      while(node){parents.push(node);node=node.parentElement.closest('[role=treeitem]');}
      for(const parent of parents.reverse())if(parent.getAttribute('aria-expanded')==='false')parent.querySelector('.pdf-outline-disclosure').click();
      link.scrollIntoView({block:'nearest'});link.click();
    })()""")
    wait(
        window,
        f"document.querySelector('.fixed-controls input[type=number]').value==='{target[2]}'",
    )
    wait(
        window,
        f"document.querySelector('[data-position]').textContent==='Página {target[2]} de 1016'",
    )
    wait(
        window,
        f"document.querySelector('.fixed-surface[data-page-index=\"{target[2]-1}\"] canvas[data-render-complete=true]')",
    )
    assert (
        js("getComputedStyle(document.querySelector('[data-count]')).display") == "none"
    )
    wait(
        window,
        "document.querySelector('.pdf-outline-tree').dataset.outlineState==='ready'",
    )
    selected = js(
        "document.querySelector('.pdf-outline-tree [aria-current=location]')?.getAttribute('aria-label')"
    )
    assert selected == target[1], selected
    # Browser-style keyboard expansion and focus, sent through Qt's focus proxy.
    js("document.querySelector('.pdf-outline-tree > [role=treeitem]').focus()")
    keyboard = Keyboard(window)
    keyboard.key("Down")
    wait(
        window,
        "document.activeElement.getAttribute('aria-label')===" + json.dumps(roots[1]),
    )
    js("document.querySelector('[data-pdf-outline-current]').click()")
    capture(window, "outline-light.png")
    js("OpenDocApp.theme().set('dark')")
    sleep(0.2)
    capture(window, "outline-dark.png")
    js("document.querySelector('[data-pdf-nav-tab=thumbnails]').click()")
    wait(
        window,
        f"document.querySelector('[data-thumbnail-index=\"{target[2]-1}\"][aria-current=page] canvas')",
    )
    assert (
        js(
            "document.querySelectorAll('.pdf-navigation-panel:not([hidden]) [role=treeitem]').length"
        )
        == 0
    )
    assert js("document.querySelectorAll('.pdf-navigation-panel canvas').length") <= 26
    capture(window, "thumbnails.png")
    js("document.querySelector('[data-pdf-sidebar-toggle]').click()")
    assert js("document.querySelector('.fixed-sidebar').hidden") is True
    assert (
        js("document.querySelector('[data-position]').textContent")
        == f"Página {target[2]} de 1016"
    )
    js(
        "document.querySelector('[data-pdf-sidebar-toggle]').click();document.querySelector('[data-pdf-nav-tab=outline]').click();OpenDocApp.theme().set('light')"
    )
    # Search gets its own pane and never mixes results with the outline.
    js(
        "OpenDocApp.editor().find();const input=document.querySelector('.fixed-controls input[type=search]');input.value='Clonando o';input.dispatchEvent(new Event('input',{bubbles:true}))"
    )
    wait(
        window,
        "document.querySelector('[data-pdf-nav-panel=results] [data-search-result]')",
    )
    assert js("document.querySelector('[data-pdf-nav-panel=outline]').hidden") is True
    assert (
        js("document.querySelector('.pdf-outline-tree [data-search-result]')") is None
    )
    js(
        "const input=document.querySelector('.fixed-controls input[type=search]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))"
    )
    sleep(0.35)
    print(
        "QT_PDF_BROWSER_NAVIGATION_OK",
        json.dumps(
            {
                "pages": 1016,
                "outlineEntries": len(expected),
                "rootOrder": roots,
                "destination": target[2],
                "selected": selected,
                "thumbnailCanvases": js(
                    "document.querySelectorAll('.pdf-navigation-panel canvas').length"
                ),
            }
        ),
        flush=True,
    )


def main():
    original = webview.start
    errors = []
    with TemporaryDirectory(prefix="pdf-navigation-qa-") as directory:
        root = Path(directory)
        source = (
            Path(os.environ["OPEN_DOC_QA_PDF"]).resolve()
            if os.environ.get("OPEN_DOC_QA_PDF")
            else root / "navigation.pdf"
        )
        if not source.exists():
            fixture(source)
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        document = PdfReader(source)
        expected = outline_entries(document)
        assert len(document.pages) == 1016

        def qa():
            window = webview.windows[0]
            try:
                exercise(window, source, expected)
            except Exception as error:  # noqa: BLE001
                errors.append(error)
            finally:
                window.confirm_close = False
                window.destroy()

        webview.start = lambda *a, **k: original(qa, gui="qt", debug=False)
        try:
            app = create_app(Config(root / "workspace"))
            services().fixed_documents.import_pdf(services().organizer.organize(source))
            app.run()
        finally:
            webview.start = original
        assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

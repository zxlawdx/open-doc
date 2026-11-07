"""Round trip through the real PDF viewer, bridge and content-stream writer."""

import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
os.environ.setdefault("QT_API", "pyqt5")

from fpdf import FPDF
from pypdf import PdfReader

from qa_stabilization import Config, create_app, services, wait, webview


def main():
    errors = []
    original_start = webview.start

    def qa():
        window = webview.windows[0]
        try:
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            wait(window, "document.querySelector('.fixed-surface .textLayer span')")
            window.evaluate_js("""
                document.querySelector('.fixed-sidebar [data-thumbnail-index="1"]').click();
                document.querySelector('[data-app]').dispatchEvent(
                    new CustomEvent('open-doc:fixed-zoom', {detail: 125}));
            """)
            wait(
                window,
                "document.querySelector('[data-position]').textContent === 'Página 2 de 3'",
            )
            window.create_file_dialog = lambda *args, **kwargs: (str(destination),)
            window.evaluate_js("""(() => {
                    const text = [...document.querySelectorAll('.textLayer span')]
                        .find(node => node.textContent === 'Relatorio de atividade');
                    const button = [...document.querySelectorAll('.fixed-controls button')]
                        .find(node => node.textContent === 'Editar PDF');
                    button.click();
                    text.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
                    const form = document.querySelector('.pdf-native-editor');
                    form.querySelector('input[type=text]').value = 'Relatorio de atividades';
                    form.querySelector('input[type=checkbox]').checked = true;
                    form.querySelector('button[type=submit]').click();
                })()""")
            wait(
                window,
                """[...document.querySelectorAll('.textLayer span')].some(
                    node => node.textContent === 'Relatorio de atividades')""",
            )
            assert source.read_bytes() == original_bytes
            pages = PdfReader(destination).pages
            assert len(pages) == 3
            assert pages[0].extract_text() == "Primeira pagina original"
            assert pages[1].extract_text() == "Relatorio de atividades"
            assert pages[2].extract_text() == "Terceira pagina original"
            wait(
                window,
                "document.querySelector('[data-position]').textContent === 'Página 2 de 3'",
            )
            assert (
                window.evaluate_js("document.querySelector('[data-zoom]').value")
                == "125"
            )
            document = services().fixed_documents.current()
            assert document["reader_view"]["page"] == 1
            assert document["reader_view"]["zoom"] == 1.25
            window.evaluate_js("""
                (() => {
                    const editor = OpenDocApp.editor();
                    const layers = editor.inkLayers();
                    layers[1].text_overlays.push({
                        id: 'qa-note', text: 'Anotação de teste', x: .07, y: .14,
                        width: .5, height: .08, font_family: 'Inter',
                        font_size_pt: 16, color: '#204060'
                    });
                    editor.setInkLayers(layers);
                })()
            """)
            wait(window, "OpenDocApp.editor().isClean()")
            assert (
                window.evaluate_js(
                    "document.querySelector('[data-position]').textContent"
                )
                == "Página 2 de 3"
            )
            saved = services().fixed_documents.current()
            assert (
                saved["content"]["surfaces"][1]["text_overlays"][0]["id"] == "qa-note"
            )
            window.evaluate_js("OpenDocApp.editor().load(" + json.dumps(saved) + ")")
            wait(
                window,
                """document.querySelector('[data-position]').textContent === 'Página 2 de 3'
                && document.querySelector('.fixed-surface[data-page-index="1"] canvas[data-render-complete=true]')""",
            )
            assert (
                window.evaluate_js("document.querySelector('[data-zoom]').value")
                == "125"
            )
            assert window.evaluate_js("""
                [...document.querySelectorAll('.fixed-controls button')]
                    .find(button => button.textContent === 'Anterior').disabled === false
            """)
            subprocess.run(
                [
                    "node",
                    str(ROOT / "tools/qa_pdf_view_capture.cjs"),
                    os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],
                ],
                check=True,
                timeout=20,
            )
            print("QT_NATIVE_PDF_EDIT_EXPORT_REOPEN_VIEW_AND_ANNOTATION_OK", flush=True)
        except Exception as exc:
            errors.append(exc)
        finally:
            window.confirm_close = False
            window.destroy()

    def start(*args, **kwargs):
        original_start(qa, gui="qt", debug=False)

    try:
        webview.start = start
        with tempfile.TemporaryDirectory(prefix="open-doc-pdf-qa-") as folder:
            path = Path(folder)
            workspace = path / "workspace"
            workspace.mkdir()
            source, destination = workspace / "original.pdf", path / "corrigido.pdf"
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Helvetica", size=14)
            pdf.text(10, 30, "Primeira pagina original")
            pdf.add_page()
            pdf.text(10, 30, "Relatorio de atividade")
            pdf.add_page()
            pdf.text(10, 30, "Terceira pagina original")
            pdf.output(source)
            original_bytes = source.read_bytes()
            app = create_app(Config(workspace))
            services().fixed_documents.import_pdf(source)
            app.run()
    finally:
        webview.start = original_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

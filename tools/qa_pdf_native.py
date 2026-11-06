"""Round trip through the real PDF viewer, bridge and content-stream writer."""

import os
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
            assert len(pages) == 2
            assert pages[0].extract_text() == "Relatorio de atividades"
            assert pages[1].extract_text() == "Segunda pagina original"
            print("QT_NATIVE_PDF_EDIT_EXPORT_REOPEN_OK", flush=True)
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
            pdf.text(10, 30, "Relatorio de atividade")
            pdf.add_page()
            pdf.text(10, 30, "Segunda pagina original")
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

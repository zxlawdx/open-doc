"""Exercise dataset imports in the real desktop window."""

import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from qa_docx_list import capture, wait

import webview

from apps.open_doc.services.preferences_service import Config
from config.wsgi import create_app


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    native_start = webview.start

    with TemporaryDirectory(prefix="open-doc-datasets-qa-") as directory:
        root = Path(directory)
        first, second = root / "dados-2023.csv", root / "dados-2024.csv"
        first.write_text("id;ano;nome\n001;2023;Ana\n", encoding="utf-8")
        second.write_text("ano;nome;id\n2024;Bia;002\n", encoding="utf-8")
        destination = root / "consolidado.csv"
        paths = iter([(str(first),), (str(second),), (str(destination),)])

        def exercise():
            window = webview.windows[0]
            picker = window.create_file_dialog
            confirm = window.create_confirmation_dialog
            window.create_confirmation_dialog = lambda *args: True
            window.create_file_dialog = lambda *args, **kwargs: next(paths)
            try:
                wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
                window.evaluate_js("document.querySelector('[data-action=datasets]').click()")
                wait(window, "document.querySelector('[data-dataset]').hidden===false")
                window.evaluate_js("document.querySelector('[data-dataset-command=new]').click()")
                wait(window, "document.querySelector('[data-dataset-table] td')?.textContent==='001'")
                window.evaluate_js("document.querySelector('[data-dataset-command=append]').click()")
                wait(window, "document.querySelector('[data-dataset-table] td')?.textContent==='002'")
                window.evaluate_js("document.querySelector('[data-dataset-command=previous]').click()")
                wait(window, "document.querySelectorAll('[data-dataset-table] tbody tr').length===2")
                assert "2 arquivos" in window.evaluate_js("document.querySelector('[data-dataset-status]').textContent")
                capture(output, "append")
                window.evaluate_js("""document.querySelector('[data-dataset-sql]').value='SELECT COUNT(*) FROM dados';
                  document.querySelector('[data-dataset-command=query]').click();""")
                wait(window, "document.querySelector('[data-dataset-table] td')?.textContent==='2'")
                window.evaluate_js("document.querySelector('[data-dataset-command=export]').click()")
                wait(window, "document.querySelector('[data-dataset-status]').textContent.includes('2 linhas exportadas')")
                assert "002,2024,Bia" in destination.read_text(encoding="utf-8")
                window.evaluate_js("""document.querySelector('[data-dataset-python]').open=true;
                  document.querySelector('[data-dataset-command=python]').click();""")
                wait(window, "document.querySelector('[data-dataset-output]').textContent.includes('Total de registros: 2')")
                capture(output, "python")
                print("QT_DATASET_IMPORT_APPEND_QUERY_EXPORT_PYTHON_OK", flush=True)
            except Exception as error:
                errors.append(error)
            finally:
                window.create_file_dialog = picker
                window.create_confirmation_dialog = confirm
                window.confirm_close = False
                window.destroy()

        webview.start = lambda *args, **kwargs: native_start(exercise, gui="qt", debug=False)
        try:
            create_app(Config(root / "workspace"), start_in_library=True).run()
        finally:
            webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

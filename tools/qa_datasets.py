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
                wait(window, """
                    document.querySelector('[data-dataset]').hidden===false &&
                    !document.querySelector('[data-dataset-command=new]').disabled &&
                    document.querySelector('[data-dataset-status]').textContent.includes('para começar')
                """)
                window.evaluate_js("document.querySelector('[data-dataset-command=new]').click()")
                wait(window, "document.querySelector('[data-dataset-table] td')?.textContent==='001'")
                window.evaluate_js("document.querySelector('[data-dataset-command=append]').click()")
                wait(window, "document.querySelector('[data-dataset-table] td')?.textContent==='002'")
                window.evaluate_js("document.querySelector('[data-dataset-command=previous]').click()")
                wait(window, "document.querySelectorAll('[data-dataset-table] tbody tr').length===2")
                assert "2 arquivos" in window.evaluate_js("document.querySelector('[data-dataset-status]').textContent")
                capture(output, "append")
                window.evaluate_js("""const editor=OpenDocCodeVendor.EditorView.findFromDOM(document.querySelector('[data-dataset-query] .cm-editor'));
                  editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:'SELECT COUNT(*) FROM dados'}});
                  document.querySelector('[data-dataset-command=query]').click();""")
                wait(window, "document.querySelector('[data-dataset-table] td')?.textContent==='2'")
                window.evaluate_js("document.querySelector('[data-dataset-command=export]').click()")
                wait(window, "document.querySelector('[data-dataset-status]').textContent.includes('2 linhas exportadas')")
                assert "002,2024,Bia" in destination.read_text(encoding="utf-8")
                window.evaluate_js("""document.querySelector('[data-dataset-python]').open=true;
                  document.querySelector('[data-dataset-command=python]').click();""")
                wait(window, "document.querySelector('[data-dataset-output]').textContent.includes('Total de registros: 2')")
                capture(output, "python")
                window.evaluate_js("""(() => {
                  const view=OpenDocCodeVendor.EditorView.findFromDOM(document.querySelector('[data-dataset-python] .cm-editor'));
                  const code='import pathlib as p\\np.Pa';
                  view.dispatch({changes:{from:0,to:view.state.doc.length,insert:code},
                    selection:{anchor:code.length},userEvent:'input.type'});
                  view.focus();
                  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',
                    {key:' ',code:'Space',ctrlKey:true,bubbles:true,cancelable:true}));
                })()""")
                wait(window, "Array.from(document.querySelectorAll('.cm-tooltip-autocomplete li')).some(item=>item.textContent.includes('Path'))")
                capture(output, "autocomplete-python")
                window.evaluate_js("""(() => {
                  const view=OpenDocCodeVendor.EditorView.findFromDOM(document.querySelector('[data-dataset-query] .cm-editor'));
                  const code='SELECT * FROM dados WHERE nom';
                  view.dispatch({changes:{from:0,to:view.state.doc.length,insert:code},
                    selection:{anchor:code.length},userEvent:'input.type'});
                  view.focus();
                  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',
                    {key:' ',code:'Space',ctrlKey:true,bubbles:true,cancelable:true}));
                })()""")
                wait(window, "Array.from(document.querySelectorAll('.cm-tooltip-autocomplete li')).some(item=>item.textContent.includes('nome'))")
                capture(output, "autocomplete-sql")
                print("QT_DATASET_IMPORT_APPEND_QUERY_EXPORT_PYTHON_COMPLETION_OK", flush=True)
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

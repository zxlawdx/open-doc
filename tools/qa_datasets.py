"""Exercise dataset imports in the real desktop window."""

import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from qa_docx_list import capture, wait
from qa_workbook import capture_viewports

import webview

from shared.services.preferences_service import Config
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
                capture_viewports(window, output, "dataset")
                window.evaluate_js("""(() => {
                  const cell=document.querySelector('[data-dataset-cell][data-dataset-row="2"][data-dataset-col="2"]');
                  cell.click();
                  document.querySelector('[data-dataset] [data-ribbon-tab=filter]').click();
                  document.querySelector('[data-dataset-command=filter]').click();
                })()""")
                wait(window, "document.querySelector('[data-dataset-table] td')?.textContent==='002'")
                assert window.evaluate_js("document.querySelectorAll('[data-dataset-table] tbody tr').length===1")
                window.evaluate_js("document.querySelector('[data-dataset-command=reset]').click()")
                wait(window, "document.querySelectorAll('[data-dataset-table] tbody tr').length===2")
                window.evaluate_js("""(() => {
                  const handle=document.querySelector('.dataset-col-resize');
                  handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
                })()""")
                assert window.evaluate_js("!!document.querySelector('.dataset-col-resize').getAttribute('aria-valuenow')")
                window.evaluate_js("document.querySelector('[data-dataset-command=show-sql]').click()")
                wait(window, "!document.querySelector('[data-dataset-tools]').hidden")
                capture_viewports(window, output, "dataset-sql")
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
                window.evaluate_js("document.querySelector('[data-dataset-command=reset]').click()")
                wait(window, "document.querySelectorAll('[data-dataset-table] tbody tr').length===2")
                window.evaluate_js("""(() => {
                  const cell=document.querySelector('[data-dataset-cell][data-dataset-row="1"][data-dataset-col="0"]');
                  cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
                })()""")
                wait(window, "!!document.querySelector('.dataset-inline-editor')")
                window.evaluate_js("""(() => {
                  const editor=document.querySelector('.dataset-inline-editor');
                  editor.value='009';
                  editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
                })()""")
                wait(window, "document.querySelector('[data-dataset-cell][data-dataset-row=\"1\"][data-dataset-col=\"0\"]')?.textContent==='009'")
                window.evaluate_js("""(() => {
                  const header=document.querySelector('thead [data-dataset-col="0"]');
                  header.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:150}));
                })()""")
                wait(window, "!!document.querySelector('.book-context-menu')")
                window.evaluate_js("""Array.from(document.querySelectorAll('.book-context-menu button'))
                  .find(button=>button.textContent==='Texto').click()""")
                wait(window, "document.querySelector('thead [data-dataset-col=\"0\"]')?.classList.contains('dataset-typed')")
                window.evaluate_js("""(() => {
                  const cell=document.querySelector('[data-dataset-cell][data-dataset-row="1"][data-dataset-col="0"]');
                  cell.focus();
                  cell.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));
                })()""")
                wait(window, "document.querySelector('thead [data-dataset-col=\"0\"]')?.classList.contains('dataset-typed')===false")
                window.evaluate_js("""(() => {
                  const cell=document.querySelector('[data-dataset-cell][data-dataset-row="1"][data-dataset-col="0"]');
                  cell.focus();
                  cell.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));
                })()""")
                wait(window, "document.querySelector('[data-dataset-cell][data-dataset-row=\"1\"][data-dataset-col=\"0\"]')?.textContent==='001'")
                window.evaluate_js("""(() => {
                  const cell=document.querySelector('[data-dataset-cell][data-dataset-row="1"][data-dataset-col="0"]');
                  cell.focus();
                  cell.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}));
                })()""")
                wait(window, "document.querySelector('[data-dataset-cell][data-dataset-row=\"1\"][data-dataset-col=\"0\"]')?.textContent==='009'")
                window.evaluate_js("""(() => {
                  const cell=document.querySelector('[data-dataset-cell][data-dataset-row="1"][data-dataset-col="0"]');
                  cell.focus();
                  cell.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}));
                })()""")
                wait(window, "document.querySelector('thead [data-dataset-col=\"0\"]')?.classList.contains('dataset-typed')")
                capture(output, "inline-and-types")
                window.evaluate_js("""(() => {
                  const cell=document.querySelector('[data-dataset-cell][data-dataset-row="1"][data-dataset-col="0"]');
                  cell.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:130,clientY:140}));
                })()""")
                wait(window, "!!document.querySelector('.book-context-menu select[aria-label=\"Tipo para converter\"]')")
                window.evaluate_js("""(() => {
                  const choice=document.querySelector('.book-context-menu select[aria-label="Tipo para converter"]');
                  choice.value='integer';
                  Array.from(document.querySelectorAll('.book-context-menu button'))
                    .find(button=>button.textContent.includes('Prévia e conversão')).click();
                })()""")
                wait(window, "document.querySelector('[data-dataset-conversion]').hidden===false")
                assert "alterações propostas" in window.evaluate_js(
                    "document.querySelector('[data-conversion-summary]').textContent")
                capture(output, "conversion-preview")
                window.evaluate_js("document.querySelector('[data-dataset-command=confirm-conversion]').click()")
                wait(window, "document.querySelector('[data-dataset-cell][data-dataset-row=\"1\"][data-dataset-col=\"0\"]')?.textContent==='9'")
                window.evaluate_js("""(() => {
                  const cell=document.querySelector('[data-dataset-cell][data-dataset-row="1"][data-dataset-col="0"]');
                  cell.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));
                })()""")
                wait(window, "document.querySelector('[data-dataset-cell][data-dataset-row=\"1\"][data-dataset-col=\"0\"]')?.textContent==='009'")
                capture(output, "conversion-undo")
                js = window.evaluate_js
                js("""(() => {
                  const notebook=document.querySelector('[data-dataset-tools] .code-notebook');
                  notebook.querySelector('button[title="SQL"]').click();
                  const cell=notebook.querySelector('[data-code-cell=sql]');
                  const editor=OpenDocCodeVendor.EditorView.findFromDOM(cell.querySelector('.cm-editor'));
                  editor.dispatch({changes:{from:0,insert:'SELECT COUNT(*) FROM dados'}});
                  cell.querySelector('button[title="Executar"]').click();
                })()""")
                wait(window, "Boolean(document.querySelector('[data-dataset] [data-code-cell=sql] td'))")
                print("QT_DATASET_CODE_NOTEBOOK_OK", flush=True)
                print("QT_DATASET_CONVERSION_PREVIEW_CONFIRM_UNDO_OK", flush=True)
                window.evaluate_js("""(() => {
                  const view=OpenDocCodeVendor.EditorView.findFromDOM(document.querySelector('[data-dataset-query] .cm-editor'));
                  view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'SELECT id,nome FROM dados LIMIT 2'}});
                  document.querySelector('[data-dataset-command=query]').click();
                })()""")
                wait(window, "document.querySelector('[data-dataset-command=sql-to-workbook]').disabled===false")
                window.evaluate_js("document.querySelector('[data-dataset-command=sql-to-workbook]').click()")
                wait(window, "document.querySelector('[data-workbook]').hidden===false")
                wait(window, "document.querySelector('[data-cell=\"1,0\"]')?.textContent==='009'")
                capture(output, "sql-to-workbook")
                # Exercise the public notebook controls, publication and native reference sheet.
                js("document.querySelector('[data-action=datasets]').click()")
                wait(window, "!document.querySelector('[data-dataset]').hidden")
                wait(window, "[...document.querySelector('[data-dataset-tools]').children].some(n=>n.textContent==='Abrir como DataFrame' && !n.disabled)")
                js("document.querySelector('[data-dataset-command=reset]').click()")
                wait(window, "document.querySelector('[data-dataset-command=reset]').disabled")
                js("""(() => {
                  const tools=document.querySelector('[data-dataset-tools]');
                  [...tools.children].find(node=>node.textContent==='Abrir como DataFrame').click();
                })()""")
                wait(window, "document.querySelector('[data-dataset-output]').textContent.includes('DataFrame pronto')")
                js("""(() => {
                  const notebook=document.querySelector('[data-dataset-tools] .code-notebook');
                  notebook.querySelector('button[title="Python"]').click();
                  const cell=notebook.querySelector('[data-code-cell=python]:last-child');
                  const editor=OpenDocCodeVendor.EditorView.findFromDOM(cell.querySelector('.cm-editor'));
                  editor.dispatch({changes:{from:0,to:editor.state.doc.length,
                    insert:"df['qa_published'] = 42\\nprint('isolated-frame-ready')"}});
                  cell.querySelector('button[title="Executar"]').click();
                })()""")
                wait(window, "[...document.querySelectorAll('.code-notebook-output')].some(n=>n.textContent.includes('isolated-frame-ready'))")
                assert not js("document.querySelector('[data-dataset-table]').textContent.includes('qa_published')"), "Unpublished edits leaked into table"
                js("[...document.querySelector('[data-dataset-tools]').children].find(n=>n.textContent==='Publicar df na tabela').click()")
                wait(window, "document.querySelector('[data-dataset-status]').textContent.includes('Transformação publicada')")
                assert js("document.querySelector('[data-dataset-table]').textContent.includes('qa_published')")
                capture(output, "notebook-published-table")
                js("[...document.querySelector('[data-dataset-tools]').children].find(n=>n.textContent==='Abrir em Planilhas por referência').click()")
                wait(window, "document.querySelector('.linked-resource-sheet')?.textContent.includes('qa_published')")
                assert js("document.querySelector('.linked-resource-sheet td:last-child')?.textContent==='42'")
                capture(output, "notebook-reference-sheet")
                print("QT_CSV_DATAFRAME_NOTEBOOK_PUBLICATION_REFERENCE_SHEET_OK", flush=True)
                print("QT_DATASET_SQL_TO_WORKBOOK_OK", flush=True)
                print("QT_DATASET_INLINE_TYPES_UNDO_REDO_OK", flush=True)
                print("QT_DATASET_IMPORT_APPEND_QUERY_EXPORT_PYTHON_COMPLETION_OK", flush=True)
            except Exception as error:
                print("QT_DATASET_FAILURE_STATE", window.evaluate_js("({status:document.querySelector('[data-dataset-status]')?.textContent,output:document.querySelector('[data-dataset-output]')?.textContent})"), flush=True)
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

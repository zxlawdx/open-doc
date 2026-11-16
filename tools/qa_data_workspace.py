from qa_runtime import accept_import_preview
"""Exercise project tabs, filters and real CodeMirror pointer/autocomplete in Qt."""
import json
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import webview
from config.wsgi import create_app
from shared.services.preferences_service import Config
from qa_docx_list import capture
from qa_runtime import Keyboard, report
from qa_version_history import wait


def main(output):
    output.mkdir(parents=True,exist_ok=True)
    original=webview.start
    errors=[]
    with TemporaryDirectory(prefix='open-doc-data-workspace-') as directory:
        root=Path(directory);source=root/'example.csv';source.write_text('name,value\nAna,1\nBia,2\n',encoding='utf-8')
        def qa():
            w=webview.windows[0];js=w.evaluate_js
            def click(selector):js(f'document.querySelector({json.dumps(selector)}).click()')
            def create(title):
                click('[data-dataset-command=new-project]');wait(w,"!document.querySelector('[data-dialog]').hidden")
                js(f'document.querySelector("[data-dialog-input]").value={json.dumps(title)}')
                click('[data-dialog-confirm]')
                wait(w,f'document.querySelector("[data-dataset-list] option:checked")?.textContent === {json.dumps(title)}')
                wait(w,"document.querySelector('[data-dataset]').getAttribute('aria-busy')==='false'")
            try:
                wait(w,"document.querySelector('[data-app]')?.dataset.ready==='true'");report(w)
                js('OpenDocApp.showHome()');wait(w,"!document.querySelector('[data-library]').hidden")
                assert js("document.querySelectorAll('.suite-launcher [data-suite-app]').length")==7
                assert js("document.querySelector('.suite-launcher').getBoundingClientRect().bottom <= document.querySelector('.home-inner').getBoundingClientRect().top + 1")
                capture(output,'application-launcher')
                js("window.__qaPersistentRoot=document.querySelector('[data-app]')")
                click('.suite-launcher [data-suite-app=data]')
                wait(w,"document.querySelector('[data-app]')?.dataset.entryApp==='data' && document.querySelector('[data-app]').dataset.ready==='true'")
                assert js("window.__qaPersistentRoot===document.querySelector('[data-app]')"), "Vela navigation remounted the desktop app"
                create('Primeiro programa')
                wait(w,"!!document.querySelector('.code-notebook-cell .cm-content')")
                assert not js("!!document.querySelector('[data-dataset-python]')")
                before_cells=js("document.querySelectorAll('[data-code-cell=python]').length")
                click('.od-app-rail [data-suite-app=code]')
                wait(w,"document.querySelector('[data-app]')?.dataset.entryApp==='code' && document.querySelector('[data-app]')?.dataset.datasetView==='true'")
                assert js("window.__qaPersistentRoot===document.querySelector('[data-app]')"), "Code navigation remounted the desktop app"
                assert js("document.querySelectorAll('[data-code-cell=python]').length")==before_cells, "Code navigation duplicated Python cells"
                js("document.querySelector('.code-notebook-cell .cm-content').scrollIntoView({block:'center'})")
                keyboard=Keyboard(w)
                rect=js("document.querySelector('.code-notebook-cell .cm-content').getBoundingClientRect().toJSON()")
                keyboard.click(rect['left']+25,rect['top']+80)
                assert js("document.activeElement.classList.contains('cm-content')")
                keyboard.press('A');keyboard.type('import pandas as pd');keyboard.key('Return');keyboard.type('pd.Dat')
                keyboard.press('Space')
                wait(w,"[...document.querySelectorAll('.cm-tooltip-autocomplete li')].some(n=>n.textContent.includes('DataFrame'))")
                capture(output,'python-autocomplete');keyboard.key('Escape')
                create('Segundo programa')
                assert js("document.querySelectorAll('[data-dataset-project-tabs] button').length")==2
                js("[...document.querySelectorAll('[data-dataset-project-tabs] button')].find(n=>n.textContent==='Primeiro programa').click()")
                wait(w,"document.querySelector('[data-dataset-list] option:checked')?.textContent==='Primeiro programa'")
                wait(w,"document.querySelector('.code-notebook-cell .cm-content')?.textContent.includes('pd.Dat')")
                capture(output,'project-tabs')
                w.create_file_dialog=lambda *args,**kwargs:(str(source),)
                click('[data-dataset-command=new]')
                accept_import_preview(w)
                wait(w,"document.querySelector('[data-dataset-table] td')?.textContent==='Ana'")
                click('[data-ribbon-tab=filter]')
                js("document.querySelector('[data-filter-column]').value='0';document.querySelector('[data-filter-value]').value='Bia'")
                click('[data-dataset-command=apply-filter]')
                wait(w,"document.querySelector('[data-dataset-table] td')?.textContent==='Bia'")
                click('[data-dataset-command=clear-filter]')
                wait(w,"document.querySelector('[data-dataset-table] td')?.textContent==='Ana'")
                capture(output,'filters-cleared')
                click('[data-ribbon-tab=import]');click('[data-dataset-command=delete-project]')
                wait(w,"!document.querySelector('[data-dialog]').hidden");click('[data-dialog-confirm]')
                wait(w,"document.querySelector('[data-dataset]').getAttribute('aria-busy')==='false'")
                assert not js("[...document.querySelectorAll('[data-dataset-list] option')].some(n=>n.textContent==='example')")
                print('QT_DATA_WORKSPACE_PROJECTS_AUTOCOMPLETE_POINTER_FILTER_DELETE_OK',flush=True)
            except Exception as error:errors.append(error)
            finally:w.confirm_close=False;w.destroy()
        webview.start=lambda *args,**kwargs:original(qa,gui='qt',debug=False)
        try:create_app(Config(root)).run()
        finally:webview.start=original
    if errors:raise errors[0]

if __name__=='__main__':main(Path(sys.argv[1] if len(sys.argv)>1 else 'docs/images/data-workspace').resolve())

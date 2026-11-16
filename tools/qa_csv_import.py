"""Exercise editable CSV previews and nullable type inference in real Qt."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tempfile import TemporaryDirectory
import webview
from config.wsgi import create_app
from config.composition import get_context
from shared.services.preferences_service import Config
from qa_docx_list import capture
from qa_version_history import wait


def main(output):
    output.mkdir(parents=True,exist_ok=True);errors=[];start=webview.start
    with TemporaryDirectory(prefix='opendoc-csv-preview-') as directory:
        root=Path(directory);source=root/'locale.csv'
        source.write_text('Relatório de teste\nAge;Amount;CEP;Day;Flag\n20;1.234,50;00123;31/01/2024;true\n;2,50;00456;01/02/2024;false\n31;-3,75;00789;02/02/2024;\n',encoding='utf-8')
        def exercise():
            window=webview.windows[0];js=window.evaluate_js
            def click(selector):js(f'document.querySelector({selector!r}).click()')
            def set_field(selector,value):js(f"document.querySelector({selector!r}).value={value!r};document.querySelector({selector!r}).dispatchEvent(new Event('change',{{bubbles:true}}))")
            def refresh():
                click('[data-import-refresh]')
                wait(window,"document.querySelector('[data-import-table] th')?.textContent==='Age'")
                wait(window,"!document.querySelector('[data-import-status]').textContent.includes('Analisando')")
            try:
                wait(window,"document.querySelector('[data-app]')?.dataset.ready==='true'")
                js("OpenDocApp.action('datasets')")
                wait(window,"!document.querySelector('[data-dataset]').hidden && !document.querySelector('[data-dataset-command=new]').disabled")
                window.create_file_dialog=lambda *args,**kwargs:(str(source),)
                click('[data-dataset-command=new]');wait(window,"!!document.querySelector('[data-import-confirm]')")
                assert js("document.querySelector('[data-import-confirm]').disabled")
                set_field('[data-import-header]','2');set_field('[data-import-decimal]',',');set_field('[data-import-thousands]','.');set_field('[data-import-date-format]','%d/%m/%Y');refresh()
                assert not js("document.querySelector('[data-import-confirm]').disabled")
                set_field('[data-import-type=Amount]','integer');refresh()
                assert js("document.querySelector('[data-import-confirm]').disabled")
                capture(output,'conversion-errors')
                set_field('[data-import-type=Amount]','auto');set_field('[data-import-type=CEP]','text');refresh()
                capture(output,'csv-import-preview')
                click('[data-import-confirm]');wait(window,"!document.querySelector('[data-import-confirm]')")
                wait(window,"document.querySelector('[data-dataset-table] td')?.textContent==='20'")
                ctx=get_context();identifier=js("document.querySelector('[data-dataset-list]').value")
                profile=ctx.datasets.import_schema(identifier)
                assert [field['dtype'] for field in profile['schema']]==['Float64','Float64','string','datetime64[ns]','boolean']
                assert ctx.datasets.page(identifier,0,0)['rows'][1][0] is None
                assert ctx.datasets.query(identifier,'SELECT AVG(Age) FROM dados')['rows']==[[25.5]]
                handle=ctx.dataset_exchange.snapshot(identifier)['resource'];df=ctx.dataset_exchange.dataframe(handle['resource_id'],handle['revision'])
                df['Age']=df.Age.fillna(df.Age.mean());assert df.Age.tolist()==[20.0,25.5,31.0]
                assert df.CEP.tolist()==['00123','00456','00789']
                capture(output,'typed-table')
                print('QT_CSV_PREVIEW_TYPES_NULLS_LOCALE_IDENTIFIERS_PANDAS_OK',flush=True)
            except Exception as error:errors.append(error)
            finally:window.confirm_close=False;window.destroy()
        webview.start=lambda *args,**kwargs:start(exercise,gui='qt',debug=False)
        try:create_app(Config(root/'workspace')).run()
        finally:webview.start=start
    if errors:raise errors[0]

if __name__=='__main__':main(Path(sys.argv[1] if len(sys.argv)>1 else 'docs/images/csv-import').resolve())

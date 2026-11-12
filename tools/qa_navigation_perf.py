"""Measure native Qt typing after drawing with pressure-sensitive pen events."""

import json
import os
from pathlib import Path
from statistics import median
from tempfile import TemporaryDirectory
from time import sleep
from threading import Event

from qa_stabilization import Config, create_app, services, wait, webview
from qa_runtime import Keyboard, report
from docx import Document
from pypdf import PdfReader


def fixture(path):
    reference = os.environ.get("OPEN_DOC_INK_QA_PDF")
    pages = (
        [page.extract_text() for page in PdfReader(reference).pages]
        if reference
        else ["Questão de revisão. Compare as hipóteses e explique o resultado. " * 22]
        * 14
    )
    document = Document()
    for index, text in enumerate(pages):
        if index:
            document.add_page_break()
        document.add_paragraph(" ".join(text.split()))
        document.add_paragraph("Resposta")
    document.save(path)


def exercise(window, save_gate, save_entered, save_timed_out):
    js = window.evaluate_js
    wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
    wait(
        window, "document.querySelectorAll('.document-page > .ink-overlay').length>=14"
    )
    report(window)
    keyboard = Keyboard(window)
    js("document.querySelector('[data-ink-mode=pen]').click()")
    for page in range(14):
        js(f"""(() => {{
          const svg=document.querySelectorAll('.document-page > .ink-overlay')[{page}];
          const rect=svg.getBoundingClientRect();
          svg.setPointerCapture=()=>{{}};
          for(let stroke=0;stroke<8;stroke++){{
            for(let sample=0;sample<=160;sample++){{
              const type=sample===0?'pointerdown':sample===160?'pointerup':'pointermove';
              svg.dispatchEvent(new PointerEvent(type,{{bubbles:true,cancelable:true,
                pointerId:77,pointerType:'pen',button:0,buttons:sample===160?0:1,
                pressure:.25+.6*(1+Math.sin(sample/7))/2,tiltX:14,tiltY:-9,
                clientX:rect.left+rect.width*(.12+.68*sample/160),
                clientY:rect.top+rect.height*(.14+.075*stroke+.022*Math.sin(sample/2.5))}}));
            }}
          }}
        }})()""")
    wait(
        window,
        "OpenDocApp.editor().inkLayers().reduce((n,l)=>n+l.strokes.length,0)===112",
    )

    js("""(() => {
      window.__navigationMetrics={requests:[],actions:[],mainThreadInkEncodes:0};
      const root=document.querySelector('[data-app]'),model=OpenDocApp.editor().snapshot().content;
      __navigationMetrics.inkBytes=JSON.stringify(model.ink_layers).length;
      window.__navigationDoc=OpenDocApp.editor().snapshot().id;
      const stringify=JSON.stringify;
      JSON.stringify=function(value,...rest){
        if(value===model || value?.content===model)__navigationMetrics.mainThreadInkEncodes++;
        return stringify.call(this,value,...rest);
      };
      const send=OpenDocRecovery.sendRequest;
      OpenDocRecovery.sendRequest=async(...args)=>{
        const start=performance.now();
        try{return await send(...args);}finally{
          __navigationMetrics.requests.push({url:args[0],ms:performance.now()-start});
        }
      };
      window.__navigationDone=false;window.__navigationIndependent=false;
      (async()=>{
        const recovery={...OpenDocApp.editor().snapshot(),id:'qa-worker-recovery'};
        await OpenDocRecovery.write(recovery);
        const cached=await OpenDocRecovery.readAsync(recovery.id);
        if(cached?.content?.ink_layers.length!==model.ink_layers.length)throw Error('Worker recovery did not preserve ink');
        await OpenDocRecovery.clear(recovery.id);
        if(await OpenDocRecovery.readAsync(recovery.id))throw Error('Worker recovery was not cleared');
        for(const name of ['workbook-new','datasets','workbook-new','home']){
          const start=performance.now();await OpenDocApp.action(name);
          __navigationMetrics.actions.push({name,ms:performance.now()-start,
            workbook:root.dataset.workbookView,dataset:root.dataset.datasetView,home:root.dataset.homeView});
        }
        window.__navigationIndependent=true;
      })().catch(error=>{window.__navigationError=error.message;__navigationDone=true;});
    })()""")
    wait(
        window,
        "window.__navigationIndependent===true || Boolean(window.__navigationError)",
    )
    assert not js("window.__navigationError || null")
    assert save_entered.wait(2), "The background save did not reach the real server"
    assert (
        not save_timed_out.is_set()
    ), "Module navigation waited for document persistence"
    assert not save_gate.is_set()
    assert js("document.querySelector('[data-app]').dataset.globalDirty==='true'")
    save_gate.set()
    js(
        """(async()=>{
      const root=document.querySelector('[data-app]');
      for(const name of ['new','home','workbook-new','home']){
        const start=performance.now();await OpenDocApp.action(name);
        __navigationMetrics.actions.push({name,ms:performance.now()-start,
          workbook:root.dataset.workbookView,dataset:root.dataset.datasetView,home:root.dataset.homeView});
      }
      __navigationMetrics.navigatedWhileSavePending=true;__navigationDone=true;
    })().catch(error=>{window.__navigationError=error.message;__navigationDone=true;})"""
    )
    wait(window, "window.__navigationDone===true")
    assert not js("window.__navigationError || null")
    result = js("__navigationMetrics")
    print("QT_NAVIGATION_PERF", json.dumps(result), flush=True)
    assert result["mainThreadInkEncodes"] == 0, result
    for action in result["actions"]:
        if action["name"] == "workbook-new":
            assert action["workbook"] == "true", action
        elif action["name"] == "datasets":
            assert action["dataset"] == "true", action
        elif action["name"] == "new":
            assert action["home"] == "false", action
    assert js("OpenDocApp.editor().isClean()")
    saved = services().editor.get(js("__navigationDoc"))
    assert sum(len(layer["strokes"]) for layer in saved["content"]["ink_layers"]) == 112


def main():
    errors = []
    save_gate, save_entered, save_timed_out = Event(), Event(), Event()
    native_start = webview.start

    def qa():
        window = webview.windows[0]
        try:
            exercise(window, save_gate, save_entered, save_timed_out)
        except Exception as error:
            errors.append(error)
        finally:
            save_gate.set()
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *args, **kwargs: native_start(qa, gui="qt", debug=False)
    try:
        with TemporaryDirectory(prefix="open-doc-ink-typing-") as folder:
            config = Config(Path(folder))
            source = config.root / "caderno.docx"
            fixture(source)
            app = create_app(config)
            services().editor.import_docx(source)
            editor = services().editor
            original_save = editor.save

            def delayed_save(*args, **kwargs):
                save_entered.set()
                if not save_gate.wait(10):
                    save_timed_out.set()
                return original_save(*args, **kwargs)

            editor.save = delayed_save
            app.run()
    finally:
        webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

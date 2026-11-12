"""Measure native Qt typing after drawing with pressure-sensitive pen events."""

import json
import os
from pathlib import Path
from statistics import median
from tempfile import TemporaryDirectory
from time import sleep

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


def exercise(window):
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
      window.__navigationMetrics={requests:[],actions:[]};
      const fetch=window.fetch;
      window.fetch=async(...args)=>{const start=performance.now();const response=await fetch(...args);
        __navigationMetrics.requests.push({url:String(args[0]),ms:performance.now()-start});return response;};
      const root=document.querySelector('[data-app]');
      __navigationMetrics.inkBytes=JSON.stringify(OpenDocApp.editor().inkLayers()).length;
      window.__navigationDoc=OpenDocApp.editor().snapshot().id;
      window.__navigationDone=false;
      (async()=>{for(const name of ['workbook-new','datasets','workbook-new','new','home','workbook-new','home']){
        const start=performance.now();await OpenDocApp.action(name);
        __navigationMetrics.actions.push({name,ms:performance.now()-start,
          workbook:root.dataset.workbookView,dataset:root.dataset.datasetView,home:root.dataset.homeView});
      }__navigationDone=true;})().catch(error=>{window.__navigationError=error.message;__navigationDone=true;});
    })()""")
    wait(window, "window.__navigationDone===true")
    assert not js("window.__navigationError || null")
    result = js("__navigationMetrics")
    print("QT_NAVIGATION_PERF", json.dumps(result), flush=True)
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
    native_start = webview.start

    def qa():
        window = webview.windows[0]
        try:
            exercise(window)
        except Exception as error:
            errors.append(error)
        finally:
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
            app.run()
    finally:
        webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

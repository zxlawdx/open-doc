"""Native Qt office UI and ink stress QA. All documents are disposable fixtures."""

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from time import sleep

from qa_stabilization import Config, create_app, services, wait, webview

from apps.open_doc.office.academic import document

OUT = Path(
    os.environ.get("OPEN_DOC_QA_OUTPUT", "docs/images/office-foundation")
).resolve()
OUT.mkdir(parents=True, exist_ok=True)


def exercise(window):
    js = window.evaluate_js
    wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
    wait(window, "document.querySelectorAll('.document-page > .ink-overlay').length>0")
    assert js("document.querySelectorAll('[data-ruler-handle]').length") == 3
    js(
        "[...document.querySelectorAll('.office-document-tabs button')].find(b=>b.textContent==='Referências').click()"
    )
    assert js("document.querySelector('.office-document-panel').hidden") is False
    js("document.querySelector('.office-document-panel button').click()")
    assert (
        abs(
            js("OpenDocApp.editor().snapshot().content.sections[0].margin_left_pt")
            - 3 * 72 / 2.54
        )
        < 0.01
    )
    # A keyboard ruler adjustment changes the document, not merely its decoration.
    left = js("OpenDocApp.editor().snapshot().content.sections[0].margin_left_pt")
    js(
        "document.querySelector('[data-ruler-handle=left]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))"
    )
    assert (
        js("OpenDocApp.editor().snapshot().content.sections[0].margin_left_pt") > left
    )
    js(
        "[...document.querySelectorAll('.office-document-tabs button')].find(b=>b.textContent==='Início').click()"
    )
    js(
        "document.querySelector('[data-office-search]').click();document.querySelector('.office-command-palette input').value='citacao';document.querySelector('.office-command-palette input').dispatchEvent(new Event('input'))"
    )
    assert "Citação longa" in js(
        "document.querySelector('.office-command-palette').textContent"
    )
    js("document.querySelector('.office-command-palette input').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true}))")
    assert js("document.activeElement.textContent") == 'Fechar'
    js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
    capture(window, "academic-editor.png")
    js("OpenDocApp.theme().set('dark')")
    sleep(0.2)
    capture(window, "academic-editor-dark.png")
    js(
        "OpenDocApp.theme().set('light');document.querySelector('[data-office-search]').click()"
    )
    capture(window, "command-search.png")
    js(
        "document.querySelector('.office-command-palette input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
    )
    js("document.querySelector('[data-office-compatibility]').click()")
    assert (
        js("document.querySelectorAll('.office-compatibility-table tbody tr').length")
        == 8
    )
    capture(window, "format-compatibility.png")
    js("document.querySelector('[data-dialog-cancel]').click()")
    results = []
    for count in [
        int(value)
        for value in os.environ.get(
            "OPEN_DOC_STRESS_COUNTS", "300,500,1000,10000,100000"
        ).split(",")
    ]:
        js(f"""(()=>{{
          const started=performance.now(),strokes=Array.from({{length:{count}}},(_,i)=>{{const x=.06+(i%250)/300,y=.08+(Math.floor(i/250)%300)/400;return {{id:'stress-'+i,tool:'pen',color:'#164f68',size:1.5,opacity:.8,points:[{{x,y,pressure:.5,tilt_x:0,tilt_y:0,time:0}},{{x:x+.002,y:y+.001,pressure:.5,tilt_x:0,tilt_y:0,time:1}}],outline:[[x,y],[x+.003,y],[x+.002,y+.001],[x,y+.001]]}};}});
          window.__officeBench={{count:{count},buildMs:performance.now()-started,raf:[],done:false}};
          let before=performance.now();function tick(now){{__officeBench.raf.push(now-before);before=now;if(!__officeBench.done)requestAnimationFrame(tick);}}requestAnimationFrame(tick);
          const begin=performance.now();OpenDocApp.editor().setInkLayers([{{surface_index:0,width_pt:595.28,height_pt:841.89,strokes,text_overlays:[]}}]);__officeBench.commitMs=performance.now()-begin;__officeBench.started=performance.now();
          const indexed=performance.now(),index=OpenDocInkEngine.index(strokes);__officeBench.indexMs=performance.now()-indexed;const query=performance.now();__officeBench.candidates=index.query({{left:.2,right:.21,top:.08,bottom:.09}}).length;__officeBench.queryMs=performance.now()-query;
        }})()""")
        wait(
            window,
            f"document.querySelector('.ink-overlay')?.dataset.inkPainted==='{count}'",
        )
        js(
            "__officeBench.paintMs=performance.now()-__officeBench.started;__officeBench.done=true;__officeBench.maxPaintSliceMs=Number(document.querySelector('.ink-overlay').dataset.inkMaxSlice);__officeBench.paintFrames=Number(document.querySelector('.ink-overlay').dataset.inkFrames);__officeBench.paths=document.querySelectorAll('.ink-overlay path').length;__officeBench.retained=OpenDocApp.editor().inkLayers()[0].strokes.length"
        )
        # Persist through the real backend, then verify the serialized count.
        js(
            "window.__officeSaveDone=false;(async()=>{const started=performance.now();await OpenDocApp.editor().flush();__officeBench.saveMs=performance.now()-started;__officeSaveDone=true;})().catch(e=>window.__officeSaveError=e.message)"
        )
        # Navigate while the worker is still persisting this document.
        js(
            "window.__officeNavDone=false;(async()=>{const start=performance.now();__officeBench.navigationWhileSaving=!__officeSaveDone;await OpenDocApp.action('workbook-new');__officeBench.navigationMs=performance.now()-start;__officeNavDone=true;})().catch(e=>window.__officeNavError=e.message)"
        )
        wait(window, "window.__officeNavDone===true || window.__officeNavError")
        assert not js("window.__officeNavError||null")
        wait(window, "window.__officeSaveDone===true || window.__officeSaveError")
        assert not js("window.__officeSaveError||null")
        identifier = js("OpenDocApp.editor().snapshot().id")
        reopened = services().editor.get(identifier)
        assert len(reopened["content"]["ink_layers"][0]["strokes"]) == count
        value = js("__officeBench")
        value["maxFrameGapMs"] = max(value.pop("raf"), default=0)
        assert value["retained"] == count
        assert value["paths"] < 256, value
        results.append(value)
        print("OFFICE_STRESS", json.dumps(value), flush=True)
        # Reload the rich fixture at its acknowledged revision before next case.
        js(
            "window.__officeBack=false;(async()=>{await OpenDocApp.action('home');await OpenDocApp.refresh();const title=[...document.querySelectorAll('[data-documents] .library-file-title')].find(b=>b.textContent==='Trabalho acadêmico · demonstração');if(!title)throw Error('Fixture missing');title.click();})().catch(e=>window.__officeBackError=e.message)"
        )
        wait(
            window,
            "document.querySelector('[data-app]').dataset.homeView==='false' && document.querySelector('[data-app]').dataset.workbookView!=='true' || window.__officeBackError",
        )
        js("window.__officeBack=true")
        wait(window, "window.__officeBack===true || window.__officeBackError")
        assert not js("window.__officeBackError||null")
    (OUT / "stress.json").write_text(json.dumps(results, indent=2))
    wait(
        window,
        f"document.querySelector('.ink-overlay')?.dataset.inkPainted==='{results[-1]["count"]}'",
    )
    capture(window, "ink-stress.png")


def capture(window, name):
    # CDP captures exactly what QtWebEngine painted, not an HTML mockup.
    import subprocess

    subprocess.run(
        [
            "node",
            str(Path(__file__).with_name("qa_office_capture.cjs")),
            os.environ.get("QTWEBENGINE_REMOTE_DEBUGGING", "9234"),
            str(OUT / name),
        ],
        check=True,
        timeout=30,
    )


def main():
    errors = []
    original = webview.start

    def qa():
        window = webview.windows[0]
        try:
            exercise(window)
        except Exception as error:  # noqa: BLE001 - report after closing native Qt
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *a, **k: original(qa, gui="qt", debug=False)
    try:
        with TemporaryDirectory(prefix="office-foundation-") as folder:
            app = create_app(Config(Path(folder)))
            services().editor.create_rich_copy(
                "Trabalho acadêmico · demonstração", document("academic-article")
            )
            app.run()
    finally:
        webview.start = original
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

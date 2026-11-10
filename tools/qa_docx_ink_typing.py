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

    info = js("""(() => {
      const root=document.querySelector('[data-app]');
      root.querySelector('[data-ink-mode=cursor]').click();
      const rich=root.querySelector('[data-rich]');
      const response=[...rich.querySelectorAll('p[data-node-id]')].filter(p=>p.textContent==='Resposta').pop();
      const range=document.createRange();
      range.selectNodeContents(response);range.collapse(false);
      rich.focus();
      response.scrollIntoView({block:'center'});
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      const editor=OpenDocApp.editor(),content=editor.snapshot().content;
      const layers=content.ink_layers;window.__inkTypingLayers=layers;
      const size=JSON.stringify(layers).length;
      const metrics={times:[],frames:[],serialized:0,blockSerializations:0};window.__inkTypingMetrics=metrics;
      let started=null;
      const serializer=OpenDocRichSerializer,serialize=serializer.serialize;
      serializer.serialize=(...args)=>{
        if(started!==null)metrics.blockSerializations++;
        return serialize(...args);
      };
      const stringify=JSON.stringify;
      JSON.stringify=function(value,...args){
        if(started!==null && (value?.ink_layers || value?.content?.ink_layers || value===layers))
          metrics.serialized++;
        return stringify.call(this,value,...args);
      };
      window.addEventListener('beforeinput',event=>{
        if(event.inputType==='insertText' && rich.contains(event.target))started=performance.now();
      },true);
      window.addEventListener('input',()=>{
        if(started===null)return;
        const inputStart=started;
        metrics.times.push(performance.now()-inputStart);started=null;
        requestAnimationFrame(()=>metrics.frames.push(performance.now()-inputStart));
      });
      window.__inkTypingBlock=response.dataset.nodeId;
      return {pages:rich.querySelectorAll('.document-page').length,
        inkBytes:size,points:layers.flatMap(l=>l.strokes).reduce((n,s)=>n+s.points.length,0)};
    })()""")
    raster_enabled = not os.environ.get("OPEN_DOC_INK_QA_SVG_BASELINE")
    raster_on_edited_page = """document.querySelector('[data-node-id="'+__inkTypingBlock+'"]')
        .closest('.document-page').querySelector('.ink-raster')"""
    if raster_enabled:
        wait(window, f"Boolean({raster_on_edited_page})")
        assert js(f"""(() => {{
          const canvas={raster_on_edited_page};
          const ctx=canvas.getContext('2d');
          const alpha=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          return alpha.some((value,index)=>index%4===3&&value>0);
        }})()""")
        js("document.querySelector('[data-ink-mode=pen]').click()")
        assert js(f"!({raster_on_edited_page})")
        assert js(
            "!document.querySelector('.document-page > .ink-overlay[style*=hidden]')"
        )
        js("document.querySelector('[data-ink-mode=cursor]').click()")
        wait(window, f"Boolean({raster_on_edited_page})")
        js(f"window.__inkTypingRaster={raster_on_edited_page}")
    sleep(0.25)  # Allow the scroll to the edited page to settle.
    typed = " digitando depois da caneta"
    for character in typed:
        keyboard.type(character, delay=12)
    wait(
        window,
        f"""document.querySelector('[data-node-id="'+__inkTypingBlock+'"]')
        .textContent === {json.dumps("Resposta" + typed)}""",
    )
    sleep(0.25)  # Offscreen Qt can throttle or skip animation frames.
    results = js("__inkTypingMetrics")
    times = sorted(results["times"])
    frames = sorted(results["frames"])
    assert len(times) == len(typed), results
    print(
        "QT_DOCX_INK_TYPING",
        json.dumps(
            {
                **info,
                "keys": len(times),
                "medianMs": round(median(times), 1),
                "p95Ms": round(times[int(len(times) * 0.95)], 1),
                "maxMs": round(max(times), 1),
                "frameSamples": len(frames),
                "frameP95Ms": (
                    round(frames[int(len(frames) * 0.95)], 1) if frames else None
                ),
                "wholeInkEncodesDuringInput": results["serialized"],
                "blockSerializations": results["blockSerializations"],
            }
        ),
        flush=True,
    )
    if not os.environ.get("OPEN_DOC_INK_QA_BASELINE"):
        assert results["serialized"] == 0, "Typing serialized unchanged ink"
    assert js("OpenDocApp.editor().inkLayers()===__inkTypingLayers")
    if raster_enabled:
        assert js(f"({raster_on_edited_page})===__inkTypingRaster")
        js("""(() => {
          const zoom=document.querySelector('[data-zoom]');
          window.__inkTypingRasterWidth=__inkTypingRaster.width;
          zoom.value=80;
          zoom.dispatchEvent(new Event('input',{bubbles:true}));
        })()""")
        wait(window, f"({raster_on_edited_page})?.width<__inkTypingRasterWidth")
        js("document.querySelector('[data-zoom-step=\"0\"]').click()")

    response = """document.querySelector('[data-node-id="'+__inkTypingBlock+'"]').textContent"""
    keyboard.press("Z")
    wait(window, f"{response} !== {json.dumps('Resposta' + typed)}")
    keyboard.press("Y")
    wait(window, f"{response} === {json.dumps('Resposta' + typed)}")
    assert js("OpenDocApp.editor().inkLayers()===__inkTypingLayers")
    js("OpenDocApp.editor().flush()")
    wait(window, "OpenDocApp.editor().isClean()")
    note = services().editor.current()
    assert sum(len(layer["strokes"]) for layer in note["content"]["ink_layers"]) == 112
    assert any(
        typed.strip() in run.get("text", "")
        for block in note["content"]["blocks"]
        for run in block.get("children", [])
    )
    js("""(async () => {
      const editor=OpenDocApp.editor();
      const {token}=await pywebview.api.get_bootstrap();
      const response=await fetch('/api/open_doc/document/open',{
        method:'POST',headers:{'Content-Type':'application/json','X-Open-Doc-Token':token},
        body:JSON.stringify({id:editor.snapshot().id})
      });
      if(!response.ok)throw Error('Failed to reopen the saved DOCX workspace');
      editor.load(await response.json());
      window.__inkTypingReopened=true;
    })()""")
    wait(window, "window.__inkTypingReopened===true")
    assert js(
        "OpenDocApp.editor().inkLayers().reduce((n,l)=>n+l.strokes.length,0)===112"
    )
    assert js("OpenDocApp.editor().isClean()")
    assert js(response) == "Resposta" + typed


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

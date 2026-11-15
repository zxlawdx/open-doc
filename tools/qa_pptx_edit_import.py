"""Edit imported PPTX text and round-trip native parts in actual Qt."""
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT/'tools')]
from qa_stabilization import Config, create_app, services, wait, webview
from qa_docx_list import capture
from qa_runtime import Keyboard
from pptx import Presentation
from apps.presentations.services.exporter import export_pptx

output=Path(sys.argv[1]).resolve();output.mkdir(parents=True,exist_ok=True)
inputs=[Path(p).resolve() for p in sys.argv[2:]]
errors=[];original_start=webview.start

def exercise():
    window=webview.windows[0]
    try:
        wait(window,"document.querySelector('[data-app]')?.dataset.ready==='true'")
        keyboard=Keyboard(window)
        window.evaluate_js("window.__editErrors=[];addEventListener('error',e=>window.__editErrors.push(e.message))")
        if not inputs:
            from qa_pptx_compat import fixture
            path=output/'editable-compat-fixture.pptx';fixture(path)
            deck=Presentation(path);extra=deck.slides.add_slide(deck.slide_layouts[6])
            from pptx.util import Inches
            extra.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1)).text='Segundo slide'
            deck.save(path);inputs.append(path)
        results=[]
        for n,source in enumerate(inputs):
            digest=hashlib.sha256(source.read_bytes()).hexdigest()
            note=services().documents.import_path(source)['document']
            assert note['capabilities']['edit_slides'],source.name
            window.evaluate_js('OpenDocApp.editor().load('+json.dumps(note)+');OpenDocApp.editor().refresh();')
            window.evaluate_js("OpenDocApp.action('resume-editor')")
            wait(window,"document.querySelector('[data-app]').dataset.readerState==='ready' && Boolean(document.querySelector('.slide-active-canvas .slide-object'))")
            capture(output,f'deck-{n+1}-before',1366,900)
            if len(note['content']['surfaces'])>1:
                window.evaluate_js("document.querySelector('[data-thumbnail-index=\"0\"]').click()")
                keyboard.key('Down')
                wait(window,"!!document.querySelector('.slide-active-canvas[data-page-index=\"1\"]')")
                keyboard.key('Up')
                wait(window,"!!document.querySelector('.slide-active-canvas[data-page-index=\"0\"]')")
            keyboard.key('F5')
            wait(window,"!!document.querySelector('.slide-presentation')")
            if len(note['content']['surfaces'])>1:
                keyboard.key('Right')
                wait(window,"document.querySelector('.slide-presentation output').textContent.startsWith('2')")
            capture(output,f'deck-{n+1}-presenting',1366,900)
            keyboard.key('Escape')
            wait(window,"!document.querySelector('.slide-presentation')")
            obj=next(o for o in note['content']['surfaces'][0]['elements'] if o.get('text') and o['type'] not in ('chart','table','image','line'))
            window.evaluate_js("document.querySelector('.slide-active-canvas [data-slide-element=\""+obj['id']+"\"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
            wait(window,"Boolean(document.querySelector('.slide-inline-editor'))")
            keyboard.press('A');keyboard.type('Texto alterado no Open Doc')
            print('INLINE_STATE',window.evaluate_js("({value:document.querySelector('.slide-inline-editor').value,active:document.activeElement.className,errors:window.__editErrors})"),flush=True)
            keyboard.press('Return')
            wait(window,"!document.querySelector('.slide-inline-editor')")
            state=window.evaluate_js('OpenDocApp.editor().snapshot()')
            changed=next(o for o in state['content']['surfaces'][0]['elements'] if o['id']==obj['id'])
            assert changed['text']=='Texto alterado no Open Doc',changed
            capture(output,f'deck-{n+1}-after',1366,900)
            target=output/f'edited-{n+1}.pptx'
            export_pptx(source,state['content'],target)
            deck=Presentation(target)
            assert len(deck.slides)==len(Presentation(source).slides)
            assert any(getattr(s,'text','')=='Texto alterado no Open Doc' for s in deck.slides[0].shapes)
            assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
            results.append({'slides':len(deck.slides),'source_unchanged':True,'edited':True})
        (output/'result.json').write_text(json.dumps(results,indent=2))
        print('QT_PPTX_IMPORTED_EDIT_EXPORT_OK',json.dumps(results),flush=True)
    except Exception as error:
        import traceback;traceback.print_exc();errors.append(error)
    finally:
        window.confirm_close=False;window.destroy()

webview.start=lambda *a,**kw:original_start(exercise,gui='qt',debug=False)
with TemporaryDirectory(prefix='open-doc-edit-pptx-') as directory:
    create_app(Config(Path(directory))).run()
if errors:raise errors[0]

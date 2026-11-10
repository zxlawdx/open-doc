"""Exercise workbook navigation and editing on QtWebEngine."""

import json
from struct import unpack
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from qa_docx_list import capture, wait

import webview

from apps.open_doc.application.context import get_context
from apps.open_doc.services.preferences_service import Config
from config.wsgi import create_app


VIEWPORTS = ((1280, 720), (1366, 768), (1600, 900), (1920, 1080), (2560, 1440))


def capture_viewports(window, output, name):
    for width, height in VIEWPORTS:
        capture(output, f"{name}-{width}x{height}", width=width, height=height)
        wait(window, f"innerWidth==={width} && innerHeight==={height}")
        if name == "pivot":
            check_pivot(window)
    capture(output, f"{name}-split", width=640, height=720)
    wait(window, "innerWidth===640 && innerHeight===720")
    if name == "pivot":
        check_pivot(window)
    if name == "editor":
        window.evaluate_js("document.querySelector('[data-workbook] [data-ribbon-overflow]').click()")
        wait(window, "document.querySelector('[data-workbook] [data-ribbon-overflow]').getAttribute('aria-expanded')==='true'")
        capture(output, "editor-overflow", width=640, height=720)
        window.evaluate_js("document.querySelector('[data-workbook] [data-ribbon-overflow]').click()")
    capture(output, name)


def check_pivot(window):
    assert window.evaluate_js("""(() => {
      const dialog=document.querySelector('[data-book-sidebar]');
      const body=dialog.querySelector('.pivot-v2-content');
      const bounds=dialog.getBoundingClientRect();
      const inViewport=({left,top,right,bottom,width,height})=>
        width>0&&height>0&&left>=0&&top>=0&&right<=innerWidth+1&&bottom<=innerHeight+1;
      if(!dialog.open||!inViewport(bounds)||Math.abs(bounds.left+bounds.right-innerWidth)>2||
        Math.abs(bounds.top+bounds.bottom-innerHeight)>2||body.scrollWidth>body.clientWidth+1)return false;
      const essential=['[data-book-command=close-pivot]','[data-book-command=pivot-create]',
        '.pivot-v2-header button','[data-pivot-totals]'];
      if(!essential.every(selector=>{
        const target=dialog.querySelector(selector),rect=target.getBoundingClientRect();
        return inViewport(rect)&&target.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
      }))return false;
      const selectors=['[data-pivot-available]','[data-pivot-zone=rows]','[data-pivot-zone=columns]',
        '[data-pivot-zone=values]','[data-pivot-zone=filters]','.pivot-v2-preview'];
      const initial=body.scrollTop;
      const reachable=selectors.every(selector=>{
        const field=dialog.querySelector(selector);
        field.scrollIntoView({block:'nearest'});
        const a=field.getBoundingClientRect(),b=body.getBoundingClientRect();
        return a.right<=b.right+1&&a.left>=b.left-1&&a.top<b.bottom&&a.bottom>b.top;
      });
      body.scrollTop=initial;
      return reachable;
    })()"""), "Pivot actions and fields must be reachable within the local viewport"


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    native_start = webview.start

    def exercise():
        window = webview.windows[0]
        js = window.evaluate_js

        def click(selector):
            js(f"document.querySelector({json.dumps(selector)}).click()")

        def type_formula(text):
            js(f"""(() => {{
                const formula=document.querySelector('[data-book-formula]');
                formula.focus();
                formula.value={json.dumps(text)};
                formula.dispatchEvent(new Event('input',{{bubbles:true}}));
                formula.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',bubbles:true}}));
            }})()""")

        try:
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            click(".home-side-nav [data-library-route=xlsx]")
            wait(window, "document.querySelectorAll('[data-template-id^=sheet-]:not([hidden])').length===5")
            capture(output, "templates")
            click("[data-template-id=sheet-budget]")
            wait(window, "!document.querySelector('[data-dialog]').hidden")
            click("[data-dialog-confirm]")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='20'")
            js("""document.querySelector('[data-cell="1,1"]').dispatchEvent(
              new MouseEvent('dblclick',{bubbles:true}));""")
            wait(window, "document.activeElement.matches('[data-book-inline]')")
            capture(output, "inline")
            js("""(() => {
              const field=document.querySelector('[data-book-inline]');
              field.value='2000';
              field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
            })()""")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='520'")
            click("[data-book-command=undo]")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='20'")
            click("[data-book-command=redo]")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='520'")
            click('[data-cell="1,3"]')
            click('[data-book-command=italic]')
            wait(window, "document.querySelector('[data-cell=\"1,3\"]').style.fontStyle==='italic'")
            click('[data-book-command=undo]')
            wait(window, "document.querySelector('[data-cell=\"1,3\"]').style.fontStyle===''")
            click('[data-book-command=redo]')
            wait(window, "document.querySelector('[data-cell=\"1,3\"]').style.fontStyle==='italic'")
            capture_viewports(window, output, "editor")
            click("[data-book-command=add-tab]")
            wait(window, "document.querySelectorAll('[data-book-tabs] button').length===2")
            type_formula("=Exemplo!D2")
            wait(window, "document.querySelector('[data-cell=\"0,0\"]')?.textContent==='520'")
            click(".product")
            wait(window, "document.querySelector('[data-library]').hidden===false")
            wait(window, "document.querySelector('[data-library-recent] .library-file-title')?.textContent==='Orçamento doméstico'")
            assert get_context().workbooks.list()[0]["revision"] == 2
            wait(window, "document.querySelector('.library-file-icon[data-format=xlsx]').textContent==='XLSX'")
            assert js("getComputedStyle(document.querySelector('.statusbar')).display==='none'")
            capture_viewports(window, output, "central")
            click("[data-library-recent] .library-file-title")
            wait(window, "document.querySelector('[data-cell=\"1,3\"]')?.textContent==='520'")
            assert js("document.querySelector('[data-cell=\"1,3\"]').style.fontStyle==='italic'")
            assert js("document.querySelectorAll('[data-cell]').length<1500")
            js("document.querySelector('.workbook-body').style.transform='translateZ(0)'")
            js("document.querySelector('[data-book-command=pivot]').focus()")
            click("[data-book-command=pivot]")
            wait(window, "document.querySelector('[data-book-sidebar]').open")
            assert js("document.querySelector('[data-book-command=pivot-create]').disabled")
            assert js("document.activeElement.matches('[data-pivot-search]')")
            assert js("""(() => {
              const dialog=document.querySelector('[data-book-sidebar]');
              const first=dialog.querySelector('header button');
              const last=dialog.querySelector('footer [data-book-command="close-pivot"]');
              first.focus();
              first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
              const wrapped=document.activeElement===last;
              dialog.querySelector("[data-pivot-search]").focus();
              return wrapped;
            })()""")
            js("document.querySelector('[data-pivot-range]').value='A1:D2'")
            click("[data-book-command=pivot-fields]")
            wait(window, "document.querySelectorAll('[data-pivot-field]').length===4")
            click('[data-pivot-add="0"]')  # Categoria -> Linhas
            js("document.querySelector('[data-pivot-choice=\"3\"]').value='values'")
            click('[data-pivot-add="3"]')  # Saldo -> Valores
            wait(window, """Array.from(document.querySelectorAll('[data-pivot-preview] td'))
              .some(cell=>cell.textContent==='520')""")
            js("document.querySelector('[data-pivot-choice=\"1\"]').value='values'")
            click('[data-pivot-add="1"]')  # Previsto -> segunda métrica
            wait(window, "document.querySelectorAll('[data-pivot-chips=values] .pivot-v2-chip').length===2")
            assert js("""Array.from(document.querySelectorAll('[data-pivot-preview] td'))
              .some(cell=>cell.textContent==='2000')""")
            capture_viewports(window, output, "pivot")
            for scale in (1.25, 1.5, 2):
                capture(output, f"pivot-scale-{scale}", scale=scale)
                file = output / f"pivot-scale-{scale}.png"
                width, height = unpack(">II", file.read_bytes()[16:24])
                assert abs(width - 1366 * scale) <= 1 and abs(height - 768 * scale) <= 1
                check_pivot(window)
            capture(output, "pivot")
            js("document.querySelector('[data-book-sidebar]').dispatchEvent(new Event('cancel',{cancelable:true}))")
            wait(window, "!document.querySelector('[data-book-sidebar]').open")
            assert js("document.activeElement.matches('[data-book-command=pivot]')")
            click("[data-book-command=pivot]")
            js("document.querySelector('[data-pivot-range]').value='A1:D2'")
            click("[data-book-command=pivot-fields]")
            click('[data-pivot-add="0"]')
            js("document.querySelector('[data-pivot-choice=\"3\"]').value='values'")
            click('[data-pivot-add="3"]')
            js("document.querySelector('[data-pivot-choice=\"1\"]').value='values'")
            click('[data-pivot-add="1"]')
            js("document.querySelector('.workbook-body').style.transform=''")
            js("""(() => {
                const option=document.querySelector('[data-pivot-chart]');
                option.value='bar';
                option.dispatchEvent(new Event('change',{bubbles:true}));
            })()""")
            wait(window, "!!document.querySelector('[data-pivot-preview] svg')")
            capture(output, "pivot-chart")
            js("""(() => {
                const option=document.querySelector('[data-pivot-chart]');
                option.value='table';
                option.dispatchEvent(new Event('change',{bubbles:true}));
            })()""")
            wait(window, "!!document.querySelector('[data-pivot-preview] table')")
            click("[data-book-command=pivot-create]")
            wait(window, "document.querySelectorAll('[data-book-tabs] button').length===3")
            wait(window, "document.querySelector('[data-cell=\"1,1\"]')?.textContent==='520'")
            wait(window, "document.querySelector('[data-cell=\"1,2\"]')?.textContent==='2000'")
            click("[data-book-command=undo]")
            wait(window, "document.querySelectorAll('[data-book-tabs] button').length===2")
            click('[data-cell="1,1"]')
            type_formula("2050")
            click("[data-ribbon-tab=code]")
            wait(window, "!!document.querySelector('#book-sql + .dataset-code-editor .cm-editor')")
            click("[data-book-command=run-sql]")
            wait(window, "document.querySelector('[data-book-query-results] tbody tr')?.cells[1]?.textContent==='2050'")
            confirm=window.create_confirmation_dialog
            window.create_confirmation_dialog=lambda *args: True
            try:
                click("[data-book-command=run-python]")
                wait(window, "document.querySelector('[data-book-python-output]').textContent.includes('Total de registros: 2')")
            finally:
                window.create_confirmation_dialog=confirm
            capture(output, "analysis")
            click("[data-book-command=sql-to-sheet]")
            wait(window, "document.querySelectorAll('[data-book-tabs] button').length===3")
            wait(window, "document.querySelector('[data-cell=\"1,1\"]')?.textContent==='2050'")
            capture(output, "sql-to-sheet")
            print("QT_WORKBOOK_INLINE_PIVOT_SQL_PYTHON_OK", flush=True)
        except Exception as error:
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *args, **kwargs: native_start(exercise, gui="qt", debug=False)
    try:
        with TemporaryDirectory(prefix="open-doc-workbook-qa-") as directory:
            create_app(Config(Path(directory)), start_in_library=True).run()
    finally:
        webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

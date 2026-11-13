"""Exercise worksheet drawings in the real Qt application and native XLSX export."""

import base64
import json
import sys
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

import webview
from PIL import Image
from openpyxl import load_workbook

from qa_docx_list import capture, wait
from qa_runtime import Keyboard
from apps.open_doc.application.context import get_context
from apps.open_doc.services.preferences_service import Config
from apps.open_doc.spreadsheets.files import export
from apps.open_doc.spreadsheets.objects import media_directory, store_image
from config.wsgi import create_app


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    original_start = webview.start
    with TemporaryDirectory(prefix="opendoc-sheet-objects-") as temp:
        root = Path(temp)
        pixels = BytesIO()
        Image.new("RGB", (80, 40), "#1a73e8").save(pixels, format="PNG")
        asset = store_image(
            media_directory(root),
            "data:image/png;base64," + base64.b64encode(pixels.getvalue()).decode(),
        )
        source = root / "vendas.xlsx"
        data = {
            "name": "Vendas",
            "cells": {
                "0,0": "Mês",
                "0,1": "Receita",
                "0,2": "Custo",
                "1,0": "Jan",
                "1,1": "20",
                "1,2": "10",
                "2,0": "Fev",
                "2,1": "30",
                "2,2": "12",
            },
            "bold": [],
            "objects": [
                {
                    "id": "photo",
                    "type": "image",
                    "name": "Foto",
                    "media_id": asset["media_id"],
                    "x": 40,
                    "y": 56,
                    "width": 160,
                    "height": 80,
                },
                {
                    "id": "chart",
                    "type": "chart",
                    "name": "Receita mensal",
                    "chart_kind": "bar",
                    "range": [0, 0, 2, 2],
                    "x": 300,
                    "y": 20,
                    "width": 560,
                    "height": 320,
                },
            ],
        }
        export([data], source, "xlsx", media_directory=media_directory(root))

        def exercise():
            window = webview.windows[0]
            js = window.evaluate_js
            original_dialog = window.create_file_dialog
            try:
                wait(
                    window,
                    "document.querySelector('[data-app]')?.dataset.ready==='true'",
                )
                window.create_file_dialog = lambda *args, **kwargs: (str(source),)
                js("OpenDocApp.action('workbook-import')")
                wait(
                    window, "document.querySelectorAll('.workbook-drawing').length===2"
                )
                wait(
                    window,
                    "document.querySelector('.workbook-drawing img')?.naturalWidth===80",
                )
                assert js(
                    "document.querySelector('.workbook-drawing svg')?.getAttribute('aria-label')==='Receita mensal'"
                )
                capture(output, "images-charts")
                js(
                    "Array.from(document.querySelectorAll('.workbook-drawing')).find(n=>n.querySelector('img')).focus()"
                )
                js(
                    "Array.from(document.querySelectorAll('.workbook-drawing')).find(n=>n.querySelector('img')).dispatchEvent(new MouseEvent('click',{bubbles:true}))"
                )
                keyboard = Keyboard(window)
                keyboard.key("Right", shift=True)
                wait(
                    window,
                    "Array.from(document.querySelectorAll('.workbook-drawing')).find(n=>n.querySelector('img')).style.left==='102px'",
                )
                js("document.querySelector('[data-book-command=undo]').click()")
                wait(
                    window,
                    "Array.from(document.querySelectorAll('.workbook-drawing')).find(n=>n.querySelector('img')).style.left==='92px'",
                )
                js("document.querySelector('[data-book-command=redo]').click()")
                wait(
                    window,
                    "Array.from(document.querySelectorAll('.workbook-drawing')).find(n=>n.querySelector('img')).style.left==='102px'",
                )
                js("document.querySelector('[data-book-command=save]').click()")
                wait(
                    window,
                    "document.querySelector('[data-book-status]').textContent==='Salvo neste dispositivo'",
                )
                book = get_context().workbooks.list()[0]
                note = get_context().workbooks.get(book["id"])
                assert note["sheets"][0]["objects"][0]["x"] == 50
                encoded = base64.b64encode(pixels.getvalue()).decode()
                js("""(() => {
                  const bytes=Uint8Array.from(atob(%s),char=>char.charCodeAt(0));
                  const transfer=new DataTransfer();transfer.items.add(new File([bytes],'nova-imagem.png',{type:'image/png'}));
                  const input=document.querySelector('[data-workbook] input[type=file]');input.files=transfer.files;
                  input.dispatchEvent(new Event('change',{bubbles:true}));
                })()""" % json.dumps(encoded))
                wait(
                    window,
                    "document.querySelectorAll('.workbook-drawing img').length===2",
                )
                js(
                    """(() => {const address=document.querySelector('[data-book-address]');address.value='A1:C3';address.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.querySelector('[data-book-command=chart]').click();})()"""
                )
                wait(window, "!document.querySelector('[data-dialog]').hidden")
                assert js("!document.querySelector('[data-dialog-select]')")
                js(
                    "document.querySelector('[data-dialog-input]').value='Gráfico criado na interface';document.querySelector('[data-dialog-confirm]').click()"
                )
                wait(
                    window,
                    "document.querySelectorAll('.workbook-drawing svg').length===2",
                )
                js("document.querySelector('[data-book-command=save]').click()")
                wait(
                    window,
                    "document.querySelector('[data-book-status]').textContent==='Salvo neste dispositivo'",
                )

                def address(value):
                    js(
                        """(() => {const field=document.querySelector('[data-book-address]');field.value=%s;field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()"""
                        % json.dumps(value)
                    )

                def command(name):
                    js(
                        "document.querySelector('[data-book-command="
                        + name
                        + "]').click()"
                    )

                def confirm(value):
                    wait(window, "!document.querySelector('[data-dialog]').hidden")
                    js(
                        "document.querySelector('[data-dialog-input]').value="
                        + json.dumps(value)
                        + ";document.querySelector('[data-dialog-confirm]').click()"
                    )

                address("E1")
                command("checkbox")
                wait(window, "!!document.querySelector('[data-book-checkbox]')")
                js("document.querySelector('[data-book-checkbox]').click()")
                wait(window, "document.querySelector('[data-book-checkbox]').checked")
                address("E2")
                command("choices")
                confirm("Pendente; Concluído")
                wait(window, "!!document.querySelector('[data-book-choice]')")
                js(
                    "const choice=document.querySelector('[data-book-choice]');choice.value='Concluído';choice.dispatchEvent(new Event('change',{bubbles:true}))"
                )
                command("comment")
                confirm("Verificado no Qt")
                address("E3")
                command("hyperlink")
                confirm("https://example.com/dados")
                address("E1:E2")
                command("sort-asc")
                wait(window, "!!document.querySelector('[data-book-choice=\"0,4\"]')")
                assert js(
                    "document.querySelector('[data-cell=\"0,4\"]').title.includes('Verificado no Qt')"
                )
                command("undo")
                wait(window, "!!document.querySelector('[data-book-choice=\"1,4\"]')")
                address("B2:C3")
                command("sparkline")
                wait(
                    window,
                    "document.querySelectorAll('svg[aria-label^=Minigráfico]').length===2",
                )
                address("A7")
                command("shape")
                wait(
                    window, "document.querySelectorAll('.workbook-drawing').length===5"
                )
                js("document.querySelector('[data-book-shape-kind]').value='text'")
                address("A12")
                command("shape")
                confirm("Caixa de texto criada na interface")
                wait(
                    window, "document.querySelectorAll('.workbook-drawing').length===6"
                )
                command("save")
                wait(
                    window,
                    "document.querySelector('[data-book-status]').textContent==='Salvo neste dispositivo'",
                )
                target = output / "images-charts.xlsx"
                window.create_file_dialog = lambda *args, **kwargs: (str(target),)
                js("document.querySelector('[data-book-command=export]').click()")
                wait(
                    window,
                    "document.querySelector('[data-book-status]').textContent.includes('Exportado')",
                )
                native = load_workbook(target)
                assert (
                    len(native.active._images) == 2 and len(native.active._charts) == 2
                )
                assert native.active._images[0].anchor._from.colOff > 0
                assert native.active["E1"].value is True
                assert native.active["E2"].value == "Concluído"
                assert native.active["E2"].comment.text == "Verificado no Qt"
                assert (
                    native.active["E3"].hyperlink.target == "https://example.com/dados"
                )
                assert len(native.active.data_validations.dataValidation) == 1
                from apps.open_doc.spreadsheets.files import read

                reopened = read(target, media_directory=media_directory(root))[0]
                assert sum(obj["type"] == "shape" for obj in reopened["objects"]) == 2
                assert reopened["cell_tools"]["1,3"]["sparkline"]["range"] == [
                    1,
                    1,
                    1,
                    2,
                ]
                assert reopened["cell_tools"]["2,3"]["sparkline"]["range"] == [
                    2,
                    1,
                    2,
                    2,
                ]
                js("document.querySelector('[data-app]').dataset.theme='dark'")
                capture(output, "images-charts-dark")
                js(
                    "document.querySelector('[data-app]').dataset.theme='light';document.querySelector('[data-ribbon-tab=insert]').click()"
                )
                capture(output, "insert-tools")
                fixture = (
                    Path("tools/workbook_objects_fixture.mjs")
                    .read_text()
                    .split("export ", 1)[1]
                )
                js(
                    "window.__sheetFixtureDone=false;window.__sheetFixtureError=null;("
                    + fixture
                    + ")().then(result=>window.__sheetFixtureDone=result.ok).catch(error=>window.__sheetFixtureError=error.message)"
                )
                wait(window, "window.__sheetFixtureDone||window.__sheetFixtureError")
                assert js("window.__sheetFixtureDone"), js("window.__sheetFixtureError")
                capture(output, "packaged-flow-source")
                print("QT_WORKBOOK_NATIVE_IMAGE_CHART_EDIT_EXPORT_OK", flush=True)
            except Exception as exc:
                errors.append(exc)
                capture(output, "failure")
            finally:
                window.create_file_dialog = original_dialog
                window.confirm_close = False
                window.destroy()

        webview.start = lambda *args, **kwargs: original_start(
            exercise, gui="qt", debug=False
        )
        try:
            create_app(Config(root), start_in_library=True).run()
        finally:
            webview.start = original_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

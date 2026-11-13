"""Verify that Qt paints the outer border of a transparent native PPTX table."""

import json
from pathlib import Path
import sys
import tempfile

from qa_docx_list import capture, wait

import webview
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches

from apps.open_doc.readers.pptx.table_style import write_table_style
from apps.open_doc.services.container import services
from apps.open_doc.services.preferences_service import Config
from config.wsgi import create_app


def check_border(window, output, label, selector):
    capture(output, label)
    geometry = window.evaluate_js(f"""
        (() => {{
          const table=document.querySelector({json.dumps(selector)});
          const rect=table.getBoundingClientRect();
          const cells=table.rows[table.rows.length-1].cells;
          return {{
            bottom:rect.bottom,
            centers:Array.from(cells,cell=>{{
              const box=cell.getBoundingClientRect();
              return (box.left+box.right)/2;
            }}),
            viewport:[innerWidth,innerHeight]
          }};
        }})()
    """)
    with Image.open(output / f"{label}.png") as source:
        image = source.convert("RGB")
    width, height = geometry["viewport"]
    y = round(geometry["bottom"] * image.height / height)
    assert 4 <= y < image.height - 3, (label, geometry)
    assert len(geometry["centers"]) == 8, geometry
    for center in geometry["centers"]:
        x = round(center * image.width / width)
        assert 0 <= x < image.width, (label, geometry)
        pixels = [image.getpixel((x, row)) for row in range(y - 4, y + 3)]
        assert any(
            max(
                abs(actual - expected)
                for actual, expected in zip(pixel, (160, 169, 186))
            )
            <= 42
            for pixel in pixels
        ), f"{label}: missing bottom border near ({x}, {y}): {pixels}"
    print("QT_PPTX_TABLE_BOTTOM_BORDER_VISIBLE_OK", label, flush=True)


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    native_start = webview.start

    def exercise():
        window = webview.windows[0]
        try:
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            deck = Presentation()
            deck.slide_width, deck.slide_height = Inches(10), Inches(5.625)
            slide = deck.slides.add_slide(deck.slide_layouts[6])
            slide.background.fill.solid()
            slide.background.fill.fore_color.rgb = RGBColor(12, 22, 34)
            table = slide.shapes.add_table(
                10, 8, Inches(0.4), Inches(0.4), Inches(9.2), Inches(2.95)
            ).table
            write_table_style(
                table,
                {
                    "table_preset": "grid",
                    "table_transparent": True,
                    "table_padding_pt": 3,
                    "font_size_pt": 16,
                },
                new=True,
            )
            fixture = services().config.root / "qa-table-bottom-border.pptx"
            deck.save(fixture)
            note = services().fixed_documents.import_pptx(fixture)
            assert note["capabilities"]["edit_slides"]
            window.evaluate_js(f"OpenDocApp.editor().load({json.dumps(note)})")
            editor = ".fixed-scroll .slide-object-table table"
            wait(window, f"document.querySelector({json.dumps(editor)})")
            # Fix the viewport first, then reproduce the rounded object height
            # at which Qt used to crop the collapsed bottom border.
            capture(output, "pptx-table-initial")
            window.evaluate_js(
                "document.querySelector('.fixed-scroll .slide-object-table').style.height='125px'"
            )
            check_border(window, output, "pptx-table-editor-bottom-border", editor)
            window.evaluate_js(
                "Array.from(document.querySelectorAll('.slide-studio-toolbar button'))"
                ".find(button=>button.textContent==='Apresentar').click()"
            )
            presentation = ".slide-presentation-stage .slide-object-table table"
            wait(window, f"document.querySelector({json.dumps(presentation)})")
            check_border(
                window, output, "pptx-table-presentation-bottom-border", presentation
            )
        except Exception as error:
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    def start(*args, **kwargs):
        native_start(exercise, gui="qt", debug=False)

    webview.start = start
    try:
        with tempfile.TemporaryDirectory(prefix="open-doc-table-qa-") as directory:
            create_app(Config(Path(directory))).run()
    finally:
        webview.start = native_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

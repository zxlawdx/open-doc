"""Render paragraph inheritance and curved presets in actual Qt without LibreOffice."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from time import sleep

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from qa_stabilization import Config, create_app, services, wait, webview
from qa_docx_list import capture
from pptx import Presentation
from pptx.util import Inches
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.xmlchemy import OxmlElement
import apps.open_doc.services.fixed_document_service as fixed_service


def fixture(path):
    deck = Presentation()
    deck.slide_width, deck.slide_height = Inches(14), Inches(7.875)
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    from pptx.dml.color import RGBColor

    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = RGBColor.from_string("173630")
    wave = slide.shapes.add_shape(MSO_SHAPE.WAVE, Inches(8), 0, Inches(6), Inches(3))
    wave.fill.solid()
    wave.fill.fore_color.rgb = RGBColor.from_string("377591")
    shape = slide.shapes.add_textbox(Inches(0.8), Inches(1), Inches(7), Inches(3))
    p = shape.text_frame.paragraphs[0]
    props = p._p.get_or_add_pPr()
    defaults = OxmlElement("a:defRPr")
    defaults.set("sz", "3000")
    defaults.set("b", "1")
    fill = OxmlElement("a:solidFill")
    color = OxmlElement("a:srgbClr")
    color.set("val", "FFFFFF")
    fill.append(color)
    defaults.append(fill)
    face = OxmlElement("a:latin")
    face.set("typeface", "Arial")
    defaults.append(face)
    props.append(defaults)
    p.add_run().text = "TÍTULO DE TESTE"
    p = shape.text_frame.add_paragraph()
    props = p._p.get_or_add_pPr()
    defaults = OxmlElement("a:defRPr")
    defaults.set("sz", "2400")
    fill = OxmlElement("a:solidFill")
    color = OxmlElement("a:srgbClr")
    color.set("val", "D2E5D7")
    fill.append(color)
    defaults.append(fill)
    props.append(defaults)
    p.add_run().text = "Texto herdado e legível"
    deck.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("presentations", nargs="*", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    inputs = [p.resolve(strict=True) for p in args.presentations]
    errors = []
    original_start = webview.start
    fixed_service.libreoffice_executable = lambda: None

    def exercise():
        window = webview.windows[0]
        try:
            wait(window, "document.querySelector('[data-app]')?.dataset.ready==='true'")
            results = []
            for deck_index, source in enumerate(inputs):
                digest = hashlib.sha256(source.read_bytes()).hexdigest()
                imported = services().documents.import_path(source)["document"]
                assert imported["capabilities"]["edit_slides"]
                window.evaluate_js(
                    "OpenDocApp.editor().load("
                    + json.dumps(imported)
                    + ");OpenDocApp.editor().refresh();"
                )
                window.evaluate_js("OpenDocApp.action('resume-editor')")
                wait(
                    window,
                    "document.querySelector('[data-app]').dataset.readerState==='ready' && Boolean(document.querySelector('.pptx-content svg'))",
                )
                if args.presentations:
                    (output / f"deck-{deck_index+1}-dom.json").write_text(
                        json.dumps(
                            window.evaluate_js("""(() => {
                      const surface=document.querySelector('.slide-active-canvas');
                      return [...surface.querySelectorAll('span')].filter(n=>n.style.fontSize).slice(0,8).map(n=>({html:n.outerHTML,font:getComputedStyle(n).fontFamily}));
                    })()"""),
                            indent=2,
                        )
                    )
                count = len(Presentation(source).slides)
                for index in range(count):
                    window.evaluate_js(
                        f"document.querySelector('.fixed-sidebar [data-thumbnail-index=\"{index}\"]').click()"
                    )
                    wait(
                        window,
                        f"Boolean(document.querySelector('.slide-active-canvas[data-page-index=\"{index}\"] svg'))",
                    )
                    sleep(0.08)
                    if not args.presentations:
                        detail = window.evaluate_js(
                            """(() => {
                          const surface=document.querySelector('.slide-active-canvas');
                          const span=[...surface.querySelectorAll('span')].find(n=>n.textContent==='TÍTULO DE TESTE'&&n.style.fontSize);
                          return {color:getComputedStyle(span).color,size:parseFloat(getComputedStyle(span).fontSize),bold:getComputedStyle(span).fontWeight,
                            waves:[...surface.querySelectorAll('path')].filter(p=>(p.getAttribute('d')||'').includes(' C ')).length};})()"""
                        )
                        assert detail["color"] == "rgb(255, 255, 255)", detail
                        assert detail["size"] == 40 and detail["bold"] in (
                            "700",
                            "bold",
                        ), detail
                        assert detail["waves"] == 1, detail
                    capture(output, f"deck-{deck_index+1}-slide-{index+1}", 1366, 900)
                assert (
                    source.read_bytes()
                    and hashlib.sha256(source.read_bytes()).hexdigest() == digest
                )
                results.append(
                    {"slides": count, "sha256": digest, "source_unchanged": True}
                )
            (output / "result.json").write_text(json.dumps(results, indent=2))
            print(
                "QT_PPTX_COMPAT_PARAGRAPH_DEFAULTS_WAVE_OK",
                json.dumps(results),
                flush=True,
            )
        except Exception as error:
            import traceback

            traceback.print_exc()
            errors.append(error)
        finally:
            window.confirm_close = False
            window.destroy()

    webview.start = lambda *a, **kw: original_start(exercise, gui="qt", debug=False)
    try:
        with TemporaryDirectory(prefix="open-doc-pptx-compat-") as directory:
            app = create_app(Config(Path(directory)))
            if not inputs:
                path = Path(directory) / "compatibility.pptx"
                fixture(path)
                inputs.append(path)
            app.run()
    finally:
        webview.start = original_start
    if errors:
        raise errors[0]


if __name__ == "__main__":
    main()

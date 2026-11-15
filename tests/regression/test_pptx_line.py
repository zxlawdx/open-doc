"""Native straight connectors remain editable after PPTX round trips."""

from pptx import Presentation
from pptx.enum.shapes import MSO_CONNECTOR

from shared.contracts.fixed_document.slide_model import SlideModelValidator
from apps.presentations.services.exporter import SlideDeckExporter
from apps.presentations.services.native_importer import read_editable_deck


def test_native_line_keeps_endpoints_on_import_and_export(tmp_path):
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, 3_000_000, 1_000_000,
                               1_000_000, 1_000_000)
    original = tmp_path / "original-line.pptx"
    presentation.save(original)
    model = read_editable_deck(original)
    model["source_kind"] = "pptx"
    line = model["surfaces"][0]["elements"][0]
    assert line["height"] == 0
    assert line["line_flip_h"] is True
    assert line["line_flip_v"] is False
    line.update(width=0, height=.2, line_flip_h=False, line_flip_v=True)
    SlideModelValidator().validate(model)
    edited = tmp_path / "edited-line.pptx"
    SlideDeckExporter(original, model).write(edited)
    connector = Presentation(edited).slides[0].shapes[0]
    assert connector.begin_x == connector.end_x
    assert connector.begin_y > connector.end_y
    reopened = read_editable_deck(edited)["surfaces"][0]["elements"][0]
    assert reopened["width"] == 0
    assert reopened["line_flip_v"] is True
    fresh = tmp_path / "new-line.pptx"
    model["preserve_source"] = False
    SlideDeckExporter(None, model).write(fresh)
    connector = Presentation(fresh).slides[0].shapes[0]
    assert connector.begin_x == connector.end_x
    assert connector.begin_y > connector.end_y

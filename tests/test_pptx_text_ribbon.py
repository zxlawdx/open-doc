"""PPTX-native paragraph formatting, validation, and editable round-trip."""
from copy import deepcopy

import pytest
from pptx import Presentation
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn

from apps.open_doc.fixed_document.slide_model import SlideModelValidator
from apps.open_doc.readers.pptx.exporter import SlideDeckExporter
from apps.open_doc.readers.pptx.native_importer import read_editable_deck


def deck_model():
    return {
        "source_kind": "pptx",
        "editable_deck": True,
        "surfaces": [{
            "index": 0, "width_pt": 960, "height_pt": 540,
            "background": "#FFFFFF", "strokes": [], "text_overlays": [],
            "notes": "", "elements": [{
                "id": "native-text-1", "type": "text",
                "x": .1, "y": .1, "width": .6, "height": .3,
                "text": "Primeira linha\nSegunda linha",
                "font_family": "Liberation Serif", "font_size_pt": 30,
                "font_bold": True, "font_italic": False, "font_underline": True,
                "paragraph_alignment": "center", "list_style": "bullet",
                "text_indent_pt": 12, "line_spacing": 1.5,
                "color": "#123456", "fill": "#FFFFFF", "stroke": "#004AC6",
            }]
        }]
    }


def test_ribbon_styles_are_native_editable_pptx_xml(tmp_path):
    model = deck_model()
    SlideModelValidator().validate(model)
    target = tmp_path / "formatted.pptx"
    SlideDeckExporter(None, model).write(target)
    presentation = Presentation(target)
    shape = presentation.slides[0].shapes[0]
    assert shape.has_text_frame
    assert len(shape.text_frame.paragraphs) == 2
    for paragraph in shape.text_frame.paragraphs:
        assert paragraph.alignment == PP_ALIGN.CENTER
        assert paragraph.line_spacing == pytest.approx(1.5)
        assert paragraph._p.pPr.find(qn("a:buChar")) is not None
        assert paragraph.runs[0].font.underline is True
        assert paragraph.runs[0].font.bold is True
        assert paragraph._p.pPr.get("marL") is not None

    imported = read_editable_deck(target)
    assert imported is not None
    rebuilt = imported["surfaces"][0]["elements"][0]
    assert rebuilt["paragraph_alignment"] == "center"
    assert rebuilt["list_style"] == "bullet"
    assert rebuilt["line_spacing"] == pytest.approx(1.5)
    assert rebuilt["font_underline"] is True

    edited = deepcopy(imported)
    edited["surfaces"][0]["elements"][0].update(
        paragraph_alignment="right", list_style="number",
        font_underline=False, text_indent_pt=24
    )
    destination = tmp_path / "updated.pptx"
    SlideDeckExporter(target, edited).write(destination)
    revised = Presentation(destination).slides[0].shapes[0].text_frame.paragraphs[0]
    assert revised.alignment == PP_ALIGN.RIGHT
    assert revised._p.pPr.find(qn("a:buAutoNum")) is not None
    assert revised.runs[0].font.underline is False


@pytest.mark.parametrize("key,value", [
    ("paragraph_alignment", "diagonal"), ("list_style", "wrong"),
    ("text_indent_pt", -1), ("text_indent_pt", 300),
    ("line_spacing", 3), ("font_underline", "true"),
])
def test_invalid_slide_paragraph_values_are_rejected(key, value):
    model = deck_model()
    model["surfaces"][0]["elements"][0][key] = value
    with pytest.raises(ValueError):
        SlideModelValidator().validate(model)

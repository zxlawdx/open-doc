"""PPTX external rich-text edits preserve original run formatting and shape."""
from copy import deepcopy

import pytest
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt

from apps.open_doc.readers.pptx.native_importer import read_editable_deck
from apps.open_doc.readers.pptx.exporter import export_pptx
from apps.open_doc.fixed_document.slide_model import SlideModelValidator


def make_deck(path):
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    shape = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(7), Inches(2))
    p = shape.text_frame.paragraphs[0]
    a = p.add_run()
    a.text = "Introdução "
    a.font.bold = True
    a.font.color.rgb = RGBColor(200, 10, 10)
    a.font.size = Pt(24)
    b = p.add_run()
    b.text = "Arqueologia amazônica"
    b.font.italic = True
    b.font.color.rgb = RGBColor(10, 20, 200)
    b.font.size = Pt(30)
    deck.save(path)


def test_edit_one_run_preserves_other_run_and_oooxml_style(tmp_path):
    source = tmp_path / "external.pptx"
    make_deck(source)
    model = read_editable_deck(source)
    assert model is not None
    obj = model["surfaces"][0]["elements"][0]
    assert len(obj["text_runs"]) == 1 and len(obj["text_runs"][0]) == 2
    original = Presentation(source).slides[0].shapes[0]
    untouched = original.text_frame.paragraphs[0].runs[1]._r.xml
    edited = deepcopy(model)
    elem = edited["surfaces"][0]["elements"][0]
    elem["text_runs"][0][0]["text"] = "Metodologia "
    elem["text"] = "Metodologia Arqueologia amazônica"
    SlideModelValidator().validate(dict(edited, source_kind="pptx"))
    target = tmp_path / "updated.pptx"
    export_pptx(source, edited, target)
    result = Presentation(target).slides[0].shapes[0]
    runs = result.text_frame.paragraphs[0].runs
    assert [r.text for r in runs] == ["Metodologia ", "Arqueologia amazônica"]
    assert runs[1]._r.xml == untouched
    assert runs[0].font.bold is True
    assert runs[0].font.color.rgb == RGBColor(200, 10, 10)
    assert runs[1].font.italic is True
    again = read_editable_deck(target)
    assert again["surfaces"][0]["elements"][0]["text_runs"][0][0]["text"] == "Metodologia "


def test_changed_run_styles_fail_closed(tmp_path):
    source = tmp_path / "external.pptx"
    make_deck(source)
    model = deepcopy(read_editable_deck(source))
    obj = model["surfaces"][0]["elements"][0]
    obj["text_runs"][0][0]["color"] = "#FFFFFF"
    target = tmp_path / "unsafe.pptx"
    with pytest.raises(ValueError, match="estilos de runs"):
        export_pptx(source, model, target)
    assert not target.exists()


def test_restructure_runs_fails_closed(tmp_path):
    source = tmp_path / "external.pptx"
    make_deck(source)
    model = deepcopy(read_editable_deck(source))
    obj = model["surfaces"][0]["elements"][0]
    obj["text_runs"][0].pop()
    target = tmp_path / "unsafe.pptx"
    with pytest.raises(ValueError, match="quantidade de runs"):
        export_pptx(source, model, target)
    assert not target.exists()

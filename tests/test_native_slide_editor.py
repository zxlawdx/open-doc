"""Native slide studio: persistence, OOXML editability and safe boundaries."""
from copy import deepcopy

import pytest
from pptx import Presentation

from apps.open_doc.services.container import configure
from apps.open_doc.services.preferences_service import Config
from apps.open_doc.fixed_document.validation import validate
from apps.open_doc.services.document_service import RevisionConflict


def element(uid="text-1", kind="text"):
    return {
        "id": uid, "type": kind, "x": .12, "y": .15,
        "width": .56, "height": .20, "text": "Apresentação de pesquisa",
        "font_family": "Inter", "font_size_pt": 28,
        "color": "#191C1E", "fill": "#DAE2FD", "stroke": "#004AC6",
    }


def test_new_presentation_creates_valid_original_and_editable_model(tmp_path):
    ctx = configure(Config(tmp_path))
    note = ctx.documents.create({
        "content_format": "opendoc-presentation-v1",
        "title": "Projeto de pesquisa",
    })
    assert note["source_kind"] == "pptx"
    assert note["capabilities"]["edit_slides"] is True
    assert note["content"]["editable_deck"] is True
    assert len(note["content"]["surfaces"]) == 1
    original = ctx.fixed_documents.source(note["id"]).read_bytes()
    slide = note["content"]["surfaces"][0]
    deck = Presentation(ctx.fixed_documents.source(note["id"]))
    assert len(deck.slides) == 1
    assert not deck.slides[0].shapes
    assert slide["elements"] == []

    model = deepcopy(note["content"])
    model["surfaces"][0]["elements"] = [
        element(), {**element("rect-1", "rect"), "text": ""},
        {**element("ellipse-1", "ellipse"), "text": ""},
    ]
    model["surfaces"][0]["notes"] = "Explicar metodologia de pesquisa"
    next_slide = deepcopy(model["surfaces"][0])
    next_slide["index"] = 1
    next_slide["background"] = "#DDEAFF"
    next_slide["elements"] = [{**element("second-1"), "text": "Resultados"}]
    model["surfaces"].append(next_slide)

    saved = ctx.fixed_documents.save(note["id"], note["title"], model, note["revision"])
    assert saved["revision"] == note["revision"] + 1
    assert ctx.fixed_documents.get(note["id"])["content"] == model
    with pytest.raises(RevisionConflict):
        ctx.fixed_documents.save(note["id"], note["title"], model, note["revision"])

    destination = tmp_path / "pesquisa-export.pptx"
    ctx.fixed_documents.export(note["id"], saved["revision"], "pptx", destination)
    exported = Presentation(destination)
    assert len(exported.slides) == 2
    assert len(exported.slides[0].shapes) == 3
    assert exported.slides[0].shapes[0].text == "Apresentação de pesquisa"
    assert exported.slides[0].shapes[0].text_frame.paragraphs[0].runs[0].font.size.pt == 28
    assert exported.slides[1].shapes[0].text == "Resultados"
    assert exported.slides[0].notes_slide.notes_text_frame.text == "Explicar metodologia de pesquisa"
    assert ctx.fixed_documents.source(note["id"]).read_bytes() == original

    duplicate = ctx.fixed_documents.duplicate(note["id"])
    assert duplicate["id"] != note["id"]
    assert duplicate["content"]["editable_deck"] is True
    assert len(duplicate["content"]["surfaces"]) == 2
    assert ctx.fixed_documents.source(duplicate["id"]).read_bytes() != b""


def test_native_slide_validation_rejects_overflow_and_duplicate_ids(tmp_path):
    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation()
    base = deepcopy(note["content"])
    for patch in [
        {"x": .95, "width": .3},
        {"width": 0},
        {"type": "script"},
        {"color": "url(javascript:evil)"},
        {"font_size_pt": float("nan")},
    ]:
        invalid = deepcopy(base)
        invalid["surfaces"][0]["elements"] = [{**element(), **patch}]
        with pytest.raises(ValueError):
            validate(invalid)

    invalid = deepcopy(base)
    invalid["surfaces"][0]["elements"] = [element(), element()]
    with pytest.raises(ValueError, match="duplicado"):
        validate(invalid)

    invalid = deepcopy(base)
    invalid["surfaces"][0]["width_pt"] += 5
    with pytest.raises(ValueError):
        ctx.fixed_documents.save(note["id"], note["title"], invalid, note["revision"])


def test_native_ink_does_not_cover_editable_shapes(tmp_path, monkeypatch):
    """PowerPoint shape order must match the layer ordering in the editor."""
    from PIL import Image
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    from apps.open_doc.readers.pptx import exporter as pptx_exporter

    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation()
    model = deepcopy(note["content"])
    slide = model["surfaces"][0]
    slide["strokes"] = [{"id": "test-stroke"}]
    slide["elements"] = [
        {**element("rect-1", "rect"), "text": ""},
        {**element("ellipse-1", "ellipse"), "text": ""},
    ]
    monkeypatch.setattr(
        pptx_exporter,
        "render_layer",
        lambda strokes, width, height: Image.new("RGBA", (width, height)),
    )
    destination = tmp_path / "camadas-editaveis.pptx"
    pptx_exporter.export_pptx(ctx.fixed_documents.source(note["id"]), model, destination)
    shapes = Presentation(destination).slides[0].shapes
    assert len(shapes) == 3
    assert shapes[0].shape_type == MSO_SHAPE_TYPE.PICTURE
    assert shapes[1].shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE
    assert shapes[2].shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE

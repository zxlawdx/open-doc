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


def test_extended_shapes_export_as_editable_powerpoint_objects(tmp_path):
    from pptx.enum.shapes import MSO_SHAPE, MSO_SHAPE_TYPE

    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation()
    model = deepcopy(note["content"])
    kinds = ["round_rect", "line", "arrow", "triangle", "diamond"]
    model["surfaces"][0]["elements"] = [
        {**element(f"shape-{i}", kind), "text": "", "name": f"Forma {i}",
         "stroke_width": 3, "rotation": 25}
        for i, kind in enumerate(kinds)
    ]
    validate(model)
    saved = ctx.fixed_documents.save(note["id"], note["title"], model, note["revision"])
    destination = tmp_path / "formas-editaveis.pptx"
    ctx.fixed_documents.export(note["id"], saved["revision"], "pptx", destination)
    shapes = Presentation(destination).slides[0].shapes
    assert len(shapes) == len(kinds)
    assert shapes[0].auto_shape_type == MSO_SHAPE.ROUNDED_RECTANGLE
    assert shapes[1].shape_type == MSO_SHAPE_TYPE.LINE
    assert shapes[2].auto_shape_type == MSO_SHAPE.RIGHT_ARROW
    assert shapes[3].auto_shape_type == MSO_SHAPE.ISOSCELES_TRIANGLE
    assert shapes[4].auto_shape_type == MSO_SHAPE.DIAMOND
    assert shapes[0].rotation == 25
    assert [shape.name for shape in shapes] == [f"Forma {i}" for i in range(len(kinds))]
    assert shapes[0].line.width.pt == 3
    assert ctx.fixed_documents.get(note["id"])["content"]["surfaces"][0]["elements"] == model["surfaces"][0]["elements"]


def test_native_images_roundtrip_as_editable_pptx_picture_shapes(tmp_path):
    """One deck asset may back multiple shapes without embedding it twice in JSON."""
    import base64
    from io import BytesIO
    from PIL import Image
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation()
    original = ctx.fixed_documents.source(note["id"]).read_bytes()
    model = deepcopy(note["content"])
    stream = BytesIO()
    Image.new("RGB", (3, 2), color=(40, 100, 210)).save(stream, "PNG")
    encoded = base64.b64encode(stream.getvalue()).decode("ascii")
    model["assets"] = {"asset-1": {"mime": "image/png", "data": encoded}}
    picture = {
        **element("image-1", "image"), "name": "Imagem da pesquisa",
        "asset_id": "asset-1", "text": "",
    }
    model["surfaces"][0]["elements"] = [
        picture, {**picture, "id": "image-2", "x": .30, "name": "Duplicada"},
    ]
    validate(model)
    saved = ctx.fixed_documents.save(note["id"], note["title"], model, note["revision"])
    reopened = ctx.fixed_documents.get(note["id"])
    assert reopened["content"]["assets"] == model["assets"]
    assert len(reopened["content"]["surfaces"][0]["elements"]) == 2
    dest = tmp_path / "imagens-nativas.pptx"
    ctx.fixed_documents.export(note["id"], saved["revision"], "pptx", dest)
    exported = Presentation(dest).slides[0].shapes
    assert len(exported) == 2
    assert all(shape.shape_type == MSO_SHAPE_TYPE.PICTURE for shape in exported)
    assert [shape.name for shape in exported] == ["Imagem da pesquisa", "Duplicada"]
    assert all(shape.image.ext == "png" for shape in exported)
    assert exported[0].image.blob == stream.getvalue()
    assert ctx.fixed_documents.source(note["id"]).read_bytes() == original


def test_native_image_validation_rejects_external_urls_missing_assets_and_false_mime(tmp_path):
    import base64
    from io import BytesIO
    from PIL import Image

    ctx = configure(Config(tmp_path))
    base = deepcopy(ctx.fixed_documents.create_presentation()["content"])
    base["surfaces"][0]["elements"] = [{
        **element("image-1", "image"), "asset_id": "asset-1", "text": ""
    }]
    for payload in [
        {},
        {"asset-1": {"mime": "image/png", "data": "https://example.com/image.png"}},
        {"asset-1": {"mime": "image/png", "data": "not-base64"}},
        {"asset-1": {"mime": "text/html", "data": "PGh0bWw+"}},
    ]:
        invalid = deepcopy(base)
        invalid["assets"] = payload
        with pytest.raises(ValueError):
            validate(invalid)

    stream = BytesIO()
    Image.new("RGB", (3, 2)).save(stream, "PNG")
    bad = deepcopy(base)
    bad["assets"] = {"asset-1": {
        "mime": "image/jpeg",
        "data": base64.b64encode(stream.getvalue()).decode("ascii"),
    }}
    with pytest.raises(ValueError):
        validate(bad)


@pytest.mark.parametrize(
    ("mime", "image_format", "expected_ext"),
    [
        ("image/jpeg", "JPEG", "jpg"),
        ("image/webp", "WEBP", "png"),
    ],
)
def test_native_jpeg_and_webp_export_with_editable_picture_shape(
    tmp_path, mime, image_format, expected_ext
):
    from io import BytesIO
    import base64
    from PIL import Image, features
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    if image_format == "WEBP" and not features.check("webp"):
        pytest.skip("Pillow foi compilado sem suporte WebP.")
    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation()
    model = deepcopy(note["content"])
    stream = BytesIO()
    Image.new("RGBA" if image_format == "WEBP" else "RGB", (5, 4), "blue").save(
        stream, image_format
    )
    model["assets"] = {"picture-1": {
        "mime": mime, "data": base64.b64encode(stream.getvalue()).decode("ascii"),
    }}
    model["surfaces"][0]["elements"] = [{
        **element("image-1", "image"),
        "text": "",
        "name": "Imagem externa editável",
        "asset_id": "picture-1",
    }]
    validate(model)
    saved = ctx.fixed_documents.save(note["id"], note["title"], model, note["revision"])
    result = tmp_path / f"native-{image_format.lower()}.pptx"
    ctx.fixed_documents.export(note["id"], saved["revision"], "pptx", result)
    picture = Presentation(result).slides[0].shapes[0]
    assert picture.shape_type == MSO_SHAPE_TYPE.PICTURE
    assert picture.image.ext == expected_ext
    assert picture.image.size == (5, 4)
    assert picture.name == "Imagem externa editável"


def test_native_images_reject_non_hashable_metadata(tmp_path):
    """Untrusted JSON arrays and dictionaries must raise ValueError, not TypeError."""
    from io import BytesIO
    import base64
    from PIL import Image

    ctx = configure(Config(tmp_path))
    base = deepcopy(ctx.fixed_documents.create_presentation()["content"])
    stream = BytesIO()
    Image.new("RGB", (2, 2), "red").save(stream, "PNG")
    base["assets"] = {"asset-1": {
        "mime": "image/png", "data": base64.b64encode(stream.getvalue()).decode("ascii"),
    }}
    base["surfaces"][0]["elements"] = [{
        **element("image-1", "image"), "asset_id": "asset-1", "text": "",
    }]
    for field, bad in [("type", []), ("asset_id", []), ("asset_id", {})]:
        invalid = deepcopy(base)
        invalid["surfaces"][0]["elements"][0][field] = bad
        with pytest.raises(ValueError):
            validate(invalid)

    invalid = deepcopy(base)
    invalid["assets"]["asset-1"]["mime"] = ["image/png"]
    with pytest.raises(ValueError):
        validate(invalid)

def test_native_image_mirror_flags_export_as_editable_ooxml_transform(tmp_path):
    """Flips survive persistence and are stored as native a:xfrm flags, not rasterized."""
    import base64
    from io import BytesIO
    from PIL import Image

    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation()
    model = deepcopy(note["content"])
    stream = BytesIO()
    Image.new("RGB", (4, 3), "green").save(stream, "PNG")
    model["assets"] = {"asset-1": {"mime": "image/png", "data": base64.b64encode(stream.getvalue()).decode("ascii")}}
    model["surfaces"][0]["elements"] = [{
        **element("mirror-1", "image"), "text": "", "asset_id": "asset-1",
        "flip_h": True, "flip_v": True, "rotation": 12,
    }]
    saved = ctx.fixed_documents.save(note["id"], note["title"], model, note["revision"])
    reopened = ctx.fixed_documents.get(note["id"])
    assert reopened["content"]["surfaces"][0]["elements"][0]["flip_h"] is True
    result = tmp_path / "mirrored.pptx"
    ctx.fixed_documents.export(note["id"], saved["revision"], "pptx", result)
    picture = Presentation(result).slides[0].shapes[0]
    transform = picture._pic.spPr.xfrm
    assert transform.flipH is True and transform.flipV is True
    assert picture.rotation == 12
    assert picture.image.size == (4, 3)

    for invalid in (1, "true", {}, []):
        changed = deepcopy(model)
        changed["surfaces"][0]["elements"][0]["flip_h"] = invalid
        with pytest.raises(ValueError, match="Espelhamento"):
            validate(changed)

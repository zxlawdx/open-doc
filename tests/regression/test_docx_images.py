"""New pictures are immutable assets with editable native Word geometry."""

import base64
from io import BytesIO
from zipfile import ZipFile

import pytest
from PIL import Image
from docx import Document
from lxml import etree

from shared.contracts.document_model.images import store_image, prepare_image, NS
from shared.contracts.document_model.schema import RichDocument
from shared.contracts.document_model.validate import validate_rich_document
from apps.documents.services.exporters.docx_exporter import export_docx
from apps.documents.services.document_service import Editor
from shared.services.preferences_service import Config


def image_url(kind="PNG", size=(120, 80)):
    output = BytesIO()
    Image.new("RGB", size, "#a82266").save(output, format=kind)
    mime = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp"}[kind]
    return f"data:image/{mime};base64," + base64.b64encode(output.getvalue()).decode()


@pytest.mark.parametrize("kind", ["PNG", "JPEG", "WEBP"])
def test_insert_save_reopen_export_reimport_native_picture(tmp_path, kind):
    editor = Editor(Config(tmp_path / "workspace"))
    note = editor.create("Imagens", "Texto preservado")
    directory = editor.package_directory(note["id"])
    asset = store_image(directory, image_url(kind), "Fotografia de cerâmica")
    from dataclasses import asdict

    model = asdict(RichDocument())
    picture = {
        **asset["node"],
        "x_pt": 123.5,
        "y_pt": 201.25,
        "width_pt": 90,
        "height_pt": 60,
    }
    model["media"][picture["media_id"]] = asset["media"]
    model["blocks"] = [
        {
            "id": "paragraph",
            "type": "paragraph",
            "style": {},
            "children": [
                {"id": "text", "type": "text", "text": "Texto preservado", "style": {}},
                picture,
            ],
        }
    ]
    saved = editor.save(
        note["id"],
        note["title"],
        "",
        note["revision"],
        content=model,
        content_format="opendoc-rich-v1",
    )
    reopened = Editor(editor.config).get(note["id"])
    assert reopened["content"] == model
    target = tmp_path / "pictures.docx"
    export_docx(reopened["content"], target, note["title"], package_directory=directory)
    with ZipFile(target) as archive:
        assert archive.testzip() is None
        xml = etree.fromstring(archive.read("word/document.xml"))
        anchors = xml.findall(".//wp:anchor", NS)
        assert len(anchors) == 1
        anchor = anchors[0]
        assert anchor.find("wp:positionH", NS).get("relativeFrom") == "page"
        assert int(anchor.find("wp:positionH/wp:posOffset", NS).text) == round(
            123.5 * 12700
        )
        assert anchor.find("wp:wrapNone", NS) is not None
        assert (
            archive.read(asset["media"]["part"])
            == (directory / "media" / picture["media_id"]).read_bytes()
        )
    imported = editor.import_docx(target)["content"]
    images = [
        n
        for b in imported["blocks"]
        for n in b.get("children", [])
        if n["type"] == "image"
    ]
    assert len(images) == 1
    assert images[0]["placement"] == "floating"
    assert images[0]["x_pt"] == 123.5 and images[0]["y_pt"] == 201.25
    assert images[0]["width_pt"] == 90 and images[0]["height_pt"] == 60
    assert images[0]["alt_text"] == "Fotografia de cerâmica"
    assert Document(target).paragraphs[0].text == "Texto preservado"
    assert saved["revision"] == note["revision"] + 1


def test_image_asset_deduplicates(tmp_path):
    first = store_image(tmp_path, image_url(), "um")
    second = store_image(tmp_path, image_url(), "dois")
    assert first["node"]["media_id"] == second["node"]["media_id"]
    assert first["node"]["id"] != second["node"]["id"]
    assert len(list((tmp_path / "media").iterdir())) == 1


@pytest.mark.parametrize(
    "value",
    [
        "https://example.org/image.png",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/png;base64,!!!!",
        "data:image/png;base64," + base64.b64encode(b"not an image").decode(),
        "data:image/png;base64," + "A" * (6 * 1024 * 1024),
    ],
)
def test_invalid_images_do_not_create_files(tmp_path, value):
    with pytest.raises(ValueError):
        store_image(tmp_path, value)
    assert not (tmp_path / "media").exists()


def test_mime_mismatch_and_excessive_dimensions_are_rejected():
    with pytest.raises(ValueError):
        prepare_image(image_url().replace("image/png", "image/jpeg"))
    with pytest.raises(ValueError):
        prepare_image(image_url(size=(8001, 1)))


@pytest.mark.parametrize(
    "key,value",
    [
        ("x_pt", -1),
        ("width_pt", 0),
        ("height_pt", float("inf")),
        ("placement", "evil"),
        ("alt_text", "x" * 1001),
    ],
)
def test_invalid_image_geometry_is_rejected(tmp_path, key, value):
    from dataclasses import asdict

    asset = store_image(tmp_path, image_url())
    model = asdict(RichDocument())
    model["media"][asset["node"]["media_id"]] = asset["media"]
    model["blocks"] = [
        {
            "id": "p",
            "type": "paragraph",
            "children": [{**asset["node"], key: value}],
            "style": {},
        }
    ]
    with pytest.raises(ValueError):
        validate_rich_document(model)


def test_image_upload_endpoint_requires_session_and_keeps_revision(tmp_path):
    from config.composition import configure
    from apps.documents.api import document_image_asset

    context = configure(Config(tmp_path))
    note = context.editor.create("Imagem")
    payload = {"id": note["id"], "data_url": image_url(), "alt_text": "Teste"}
    denied = document_image_asset({"json": payload, "headers": {}})
    assert denied.status == 403
    accepted = document_image_asset(
        {"json": payload, "headers": {"X-Open-Doc-Token": context.token}}
    )
    assert accepted["node"]["type"] == "image"
    assert context.editor.get(note["id"])["revision"] == note["revision"]
    invalid = document_image_asset(
        {
            "json": {**payload, "data_url": "https://example.org/a.png"},
            "headers": {"X-Open-Doc-Token": context.token},
        }
    )
    assert invalid.status == 400


def test_move_existing_inline_image_preserves_media_without_duplicate_payload(tmp_path):
    from docx.shared import Pt

    source = tmp_path / "existing.docx"
    photo = tmp_path / "photo.png"
    Image.new("RGB", (120, 80), "blue").save(photo)
    document = Document()
    document.add_paragraph("Antes")
    document.add_picture(str(photo), width=Pt(90))
    document.add_paragraph("Depois")
    document.save(source)
    editor = Editor(Config(tmp_path / "workspace"))
    note = editor.import_docx(source)
    content = note["content"]
    picture = next(
        n
        for b in content["blocks"]
        for n in b.get("children", [])
        if n["type"] == "image"
    )
    picture.update(
        geometry_edited=True,
        placement="floating",
        x_pt=111,
        y_pt=99,
        width_pt=135,
        height_pt=90,
    )
    target = tmp_path / "moved.docx"
    export_docx(
        content,
        target,
        note["title"],
        package_directory=editor.package_directory(note["id"]),
    )
    with ZipFile(target) as archive:
        media = [name for name in archive.namelist() if name.startswith("word/media/")]
        assert len(media) == 1
        assert archive.read(media[0]) == photo.read_bytes()
        xml = etree.fromstring(archive.read("word/document.xml"))
        ids = [node.get("id") for node in xml.findall(".//wp:docPr", NS)]
        assert len(ids) == len(set(ids))
    imported = editor.import_docx(target)["content"]
    picture = next(
        n
        for b in imported["blocks"]
        for n in b.get("children", [])
        if n["type"] == "image"
    )
    assert picture["x_pt"] == 111 and picture["width_pt"] == 135
    assert "Antes" in str(imported) and "Depois" in str(imported)


def test_jpeg_exif_orientation_is_normalized_before_sizing():
    stream = BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (120, 80), "green").save(stream, format="JPEG", exif=exif)
    value = "data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode()
    blob, mime, width, height = prepare_image(value)
    assert mime == "jpeg" and (width, height) == (80, 120)
    with Image.open(BytesIO(blob)) as image:
        assert image.size == (80, 120)
        assert image.getexif().get(274, 1) == 1

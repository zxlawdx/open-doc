"""Regression tests for semantic markup without altering source PDF bytes."""

from copy import deepcopy
import hashlib
from io import BytesIO

import pytest
from fpdf import FPDF
from pypdf import PdfReader, PdfWriter

from shared.contracts.fixed_document.annotations import (
    add_native_annotations,
    rotation_transform,
    validate_annotations,
)
from shared.contracts.fixed_document.schema import create
from config.composition import configure
from shared.services.preferences_service import Config


def source_pdf(tmp_path, rotation=0):
    pdf = FPDF(unit="pt", format=(300, 400))
    pdf.add_page()
    pdf.set_font("Helvetica", size=14)
    pdf.text(20, 50, "Texto selecionavel")
    writer = PdfWriter()
    page = PdfReader(BytesIO(bytes(pdf.output()))).pages[0]
    if rotation:
        page.rotate(rotation)
    writer.add_page(page)
    path = tmp_path / "article.pdf"
    with path.open("wb") as file:
        writer.write(file)
    return path


def markup(kind="highlight", identifier="mark-1", page_index=0):
    return {
        "id": identifier,
        "kind": kind,
        "page_index": page_index,
        "selected_text": "Texto selecionavel",
        "quad_points": [[20, 355, 180, 355, 20, 340, 180, 340]],
        "color": "#f5cc54",
        "opacity": 0.35,
        "comment": "Passagem importante",
    }


def model_for(path):
    reader = PdfReader(path)
    page = reader.pages[0]
    return create(
        "pdf",
        hashlib.sha256(path.read_bytes()).hexdigest(),
        [{
            "index": 0,
            "width_pt": float(page.cropbox.width),
            "height_pt": float(page.cropbox.height),
            "rotation": page.rotation,
            "strokes": [],
            "text_overlays": [],
        }],
    )


def test_legacy_models_and_invalid_semantic_geometry(tmp_path):
    model = model_for(source_pdf(tmp_path))
    assert validate_annotations(model) == []
    model["annotations"] = [markup()]
    assert validate_annotations(model) == model["annotations"]
    for bad in [
        [markup(identifier="duplicate"), markup(identifier="duplicate")],
        [{**markup(), "page_index": 10}],
        [{**markup(), "quad_points": [[1, 2, 3]]}],
        [{**markup(), "quad_points": [[0, 0, 0, 0, 0, 0, 0, 0]]}],
        [{**markup(), "color": "javascript:bad"}],
        [{**markup(), "opacity": float("nan")}],
    ]:
        invalid = deepcopy(model)
        invalid["annotations"] = bad
        with pytest.raises(ValueError):
            validate_annotations(invalid)


def test_persist_export_reopen_and_original_integrity(tmp_path):
    context = configure(Config(tmp_path))
    source = source_pdf(tmp_path)
    original = source.read_bytes()
    service = context.fixed_documents
    note = service.import_pdf(source)
    updated = deepcopy(note["content"])
    updated["annotations"] = [
        markup("highlight", "highlight-1"),
        markup("underline", "underline-1"),
        markup("strikeout", "strikeout-1"),
    ]
    saved = service.save(note["id"], note["title"], updated, note["revision"])
    reopened = service.get(note["id"])
    assert reopened["content"]["annotations"] == updated["annotations"]
    assert reopened["revision"] == saved["revision"]
    target = tmp_path / "article-annotated.pdf"
    service.export(note["id"], saved["revision"], "pdf", target)
    assert source.read_bytes() == original
    assert service.source(note["id"]).read_bytes() == original
    annotations = [
        ref.get_object() for ref in PdfReader(target).pages[0]["/Annots"]
    ]
    assert [str(a["/Subtype"]) for a in annotations] == [
        "/Highlight", "/Underline", "/StrikeOut",
    ]
    for a in annotations:
        assert len(a["/QuadPoints"]) == 8
        assert a["/Contents"] == "Passagem importante"
        assert a["/T"] == "Open Doc"
        assert len(a["/C"]) == 3
    assert len(PdfReader(target).pages) == 1


@pytest.mark.parametrize("angle", [0, 90, 180, 270])
def test_rotation_transform_preserves_quad_coordinates(tmp_path, angle):
    path = source_pdf(tmp_path, rotation=angle)
    model = model_for(path)
    model["annotations"] = [markup()]
    writer = PdfWriter(clone_from=path)
    page = writer.pages[0]
    transform = rotation_transform(page) if angle else None
    if angle:
        page.transfer_rotation_to_content()
    add_native_annotations(writer, model, {0: transform} if transform else {})
    destination = tmp_path / "rotated-annotated.pdf"
    with destination.open("wb") as out:
        writer.write(out)
    reader = PdfReader(destination)
    saved = reader.pages[0]["/Annots"][0].get_object()
    source_quad = model["annotations"][0]["quad_points"][0]
    expected = (
        [
            value
            for i in (0, 2, 4, 6)
            for value in transform.apply_on((source_quad[i], source_quad[i + 1]))
        ]
        if transform else source_quad
    )
    assert list(saved["/QuadPoints"]) == pytest.approx(expected, abs=1e-4)
    assert str(saved["/Subtype"]) == "/Highlight"


def test_sticky_note_preserves_source_and_exports_native_text_annotation(tmp_path):
    path = source_pdf(tmp_path)
    original = path.read_bytes()
    context = configure(Config(tmp_path))
    service = context.fixed_documents
    note = service.import_pdf(path)
    model = deepcopy(note["content"])
    sticky = {
        **markup("note", identifier="sticky-1"),
        "selected_text": "Nota na página 1",
        "quad_points": [[30, 350, 48, 350, 30, 332, 48, 332]],
        "comment": "Revisar a citação no artigo",
        "color": "#f5cc54",
        "opacity": 1.0,
    }
    model["annotations"] = [sticky]
    assert validate_annotations(model) == [sticky]
    saved = service.save(note["id"], note["title"], model, note["revision"])
    output = tmp_path / "sticky-export.pdf"
    service.export(note["id"], saved["revision"], "pdf", output)
    assert path.read_bytes() == original
    assert service.get(note["id"])["content"]["annotations"] == [sticky]
    native = PdfReader(output).pages[0]["/Annots"][0].get_object()
    assert str(native["/Subtype"]) == "/Text"
    assert str(native["/Contents"]) == "Revisar a citação no artigo"
    assert native["/NM"] == "sticky-1"
    assert len(native["/C"]) == 3


def test_sticky_notes_require_single_quad(tmp_path):
    model = model_for(source_pdf(tmp_path))
    note = markup("note", identifier="sticky-invalid")
    note["quad_points"].append(note["quad_points"][0])
    model["annotations"] = [note]
    with pytest.raises(ValueError):
        validate_annotations(model)


def test_reader_view_survives_restart_without_document_revision(tmp_path):
    config = Config(tmp_path)
    fixed = configure(config).fixed_documents
    note = fixed.import_pdf(source_pdf(tmp_path))
    view = {"page": 0, "offset": 0.35, "left": 20, "zoom": 1.75}
    fixed.save_pdf_view(note["id"], view)

    restarted = configure(Config(tmp_path)).fixed_documents
    loaded = restarted.current()
    assert loaded["reader_view"] == view
    assert loaded["revision"] == note["revision"]
    assert loaded["content"] == note["content"]
    for invalid in (
        {**view, "zoom": float("nan")},
        {**view, "offset": 1.5},
        {**view, "page": True},
    ):
        with pytest.raises(ValueError):
            restarted.save_pdf_view(note["id"], invalid)
    assert restarted.current()["reader_view"] == view
    restarted.delete(note["id"], note["revision"])
    with pytest.raises(ValueError):
        restarted.save_pdf_view(note["id"], view)

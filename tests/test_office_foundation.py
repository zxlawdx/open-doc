import hashlib
from zipfile import ZipFile

import pytest

from apps.open_doc.document_model.validate import validate_rich_document
from apps.open_doc.office import academic, capabilities
from apps.open_doc.office import opendocument as odf


def package(path, content="<document/>", manifest="<manifest/>", extra=None):
    with ZipFile(path, "w") as archive:
        archive.writestr("mimetype", odf.MIME[path.suffix[1:]])
        archive.writestr("content.xml", content)
        archive.writestr("META-INF/manifest.xml", manifest)
        for name, value in (extra or {}).items():
            archive.writestr(name, value)
    return path


def test_registry_has_eight_formats_and_explicit_fidelity(monkeypatch):
    monkeypatch.setattr(odf, "executable", lambda: None)
    matrix = {item["extension"]: item for item in capabilities.matrix()}
    assert set(matrix) == {"docx", "pdf", "xlsx", "csv", "tsv", "pptx", "odt", "odp"}
    assert not matrix["odt"]["available"]
    assert matrix["pdf"]["level"] == "annotatable"
    assert all(item["limitations"] for item in matrix.values())


@pytest.mark.parametrize(
    "content,manifest,extra",
    [
        ("<document/>", "<manifest/>", {"../escape": "bad"}),
        (
            '<document xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://example.org/a.png"/></document>',
            "<manifest/>",
            None,
        ),
        ("<document/>", "<manifest><encryption-data/></manifest>", None),
    ],
)
def test_odf_preflight_rejects_unsafe_packages(tmp_path, content, manifest, extra):
    with pytest.raises(ValueError):
        odf.inspect_package(package(tmp_path / "input.odt", content, manifest, extra))


def test_missing_converter_preserves_input_and_existing_output(tmp_path, monkeypatch):
    source = package(tmp_path / "input.odt")
    before = source.read_bytes()
    output = tmp_path / "output.docx"
    output.write_bytes(b"previous")
    monkeypatch.setattr(odf, "executable", lambda: None)
    with pytest.raises(ValueError, match="LibreOffice"):
        odf.convert(source, output, "docx")
    assert source.read_bytes() == before
    assert output.read_bytes() == b"previous"


def test_failed_conversion_is_atomic(tmp_path, monkeypatch):
    source = package(tmp_path / "input.odp")
    output = tmp_path / "output.pptx"
    output.write_bytes(b"previous")
    monkeypatch.setattr(odf, "executable", lambda: "/fake/soffice")
    monkeypatch.setattr(odf.subprocess, "run", lambda *a, **k: None)
    with pytest.raises(ValueError, match="não gerou"):
        odf.convert(source, output, "pptx")
    assert output.read_bytes() == b"previous"


def test_odf_rejects_mismatched_type_and_symlink(tmp_path):
    source = package(tmp_path / "input.odt")
    wrong = tmp_path / "wrong.odp"
    wrong.write_bytes(source.read_bytes())
    with pytest.raises(ValueError, match="extensão"):
        odf.inspect_package(wrong)
    link = tmp_path / "link.odt"
    try:
        link.symlink_to(source)
    except OSError:
        pytest.skip("symlinks unavailable")
    with pytest.raises(ValueError):
        odf.convert(link, tmp_path / "out.docx", "docx")


def test_all_original_academic_templates_validate_without_shared_mutation():
    for identifier in academic.SCAFFOLDS:
        first = academic.document(identifier)
        validate_rich_document(first)
        first["blocks"].clear()
        assert academic.document(identifier)["blocks"]


@pytest.mark.parametrize("kind", ["text", "presentation"])
def test_real_libreoffice_roundtrip_preserves_source(tmp_path, kind):
    if not odf.executable():
        pytest.skip("optional LibreOffice not installed")
    if kind == "text":
        from docx import Document

        source = tmp_path / "source.docx"
        document = Document()
        document.add_paragraph("Interoperabilidade acadêmica 2026")
        document.save(source)
        target, native, required = "odt", "docx", "word/document.xml"
    else:
        from pptx import Presentation

        source = tmp_path / "source.pptx"
        document = Presentation()
        slide = document.slides.add_slide(document.slide_layouts[1])
        slide.shapes.title.text = "Apresentação editável 2026"
        document.save(source)
        target, native, required = "odp", "pptx", "ppt/presentation.xml"
    before = hashlib.sha256(source.read_bytes()).digest()
    converted = tmp_path / ("converted." + target)
    assert odf.convert(source, converted, target)["lossy"]
    result = tmp_path / ("roundtrip." + native)
    odf.convert(converted, result, native)
    with ZipFile(result) as archive:
        assert required in archive.namelist()
    assert hashlib.sha256(source.read_bytes()).digest() == before


@pytest.mark.parametrize(
    "extension", ["docx", "pdf", "xlsx", "csv", "tsv", "pptx", "odt", "odp"]
)
def test_unified_import_opens_editable_or_annotation_model(tmp_path, extension):
    from docx import Document
    from openpyxl import Workbook
    from pptx import Presentation
    from pypdf import PdfWriter

    from apps.open_doc.application.context import configure
    from apps.open_doc.services.preferences_service import Config

    context = configure(Config(tmp_path / "workspace"))
    source = tmp_path / ("input." + extension)
    if extension in {"docx", "odt"}:
        native = source.with_suffix(".docx")
        note = Document()
        note.add_paragraph("Texto para editar")
        note.save(native)
    elif extension in {"pptx", "odp"}:
        native = source.with_suffix(".pptx")
        deck = Presentation()
        slide = deck.slides.add_slide(deck.slide_layouts[1])
        slide.shapes.title.text = "Slide para editar"
        deck.save(native)
    elif extension == "pdf":
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        writer.write(source)
    elif extension == "xlsx":
        book = Workbook()
        book.active["A1"] = "Dados"
        book.active["B2"] = "=SUM(1,2)"
        book.save(source)
    else:
        source.write_text(
            "nome" + ("\t" if extension == "tsv" else ",") + "valor\nAna,123\n",
            encoding="utf-8",
        )
    if extension in {"odt", "odp"}:
        if not odf.executable():
            pytest.skip("optional LibreOffice not installed")
        odf.convert(native, source, extension)
    before = source.read_bytes()
    result = context.documents.import_path(source)
    assert result["opened"]
    assert source.read_bytes() == before
    if extension in {"xlsx", "csv", "tsv"}:
        assert result["view"] == "workbook"
        assert result["workbook"]["sheets"]
    else:
        document = result["document"]
        assert document["content_format"] in {"opendoc-rich-v1", "opendoc-fixed-v1"}
        if extension in {"pptx", "odp"}:
            assert document["content"]["source_kind"] == "pptx"
            assert document["content"]["editable_deck"] is True
            assert document["capabilities"]["edit_slides"] is True
        if extension == "odt":
            assert document["conversion_warnings"]
            exported = context.documents.export_temporary(
                {
                    "id": document["id"],
                    "revision": document["revision"],
                    "format": "odt",
                },
                "test.odt",
            )
            assert exported["lossy"]
            odf.inspect_package(exported["path"])

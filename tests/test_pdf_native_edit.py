"""Native PDF content modification contract — source PDF is never overwritten."""
from __future__ import annotations

import hashlib

import pytest
from fpdf import FPDF
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream

from apps.open_doc.readers.pdf.native_edit import PdfNativeEditError, PdfNativeEditor


def pdf_with_text(tmp_path, text="Relatorio de atividade de 2025"):
    filename = tmp_path / "before.pdf"
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=14)
    pdf.text(10, 30, text)
    pdf.text(10, 40, "Pagina sem modificacoes")
    pdf.add_page()
    pdf.text(10, 30, "Segunda pagina original")
    pdf.output(str(filename))
    return filename


def test_replace_native_text_operands_and_preserve_other_pages(tmp_path):
    original = pdf_with_text(tmp_path)
    before = original.read_bytes()
    output = tmp_path / "after.pdf"
    result = PdfNativeEditor.apply(
        original, output, {
            "kind": "replace_text", "page": 0, "old": "atividade",
            "new": "atividades", "allow_expansion": True,
        },
        expected_sha256=hashlib.sha256(before).hexdigest(),
    )
    assert result["kind"] == "replace_text"
    assert original.read_bytes() == before
    reader = PdfReader(str(output))
    assert len(reader.pages) == 2
    assert "atividades" in reader.pages[0].extract_text()
    assert "atividade de" not in reader.pages[0].extract_text()
    assert "Pagina sem modificacoes" in reader.pages[0].extract_text()
    assert reader.pages[1].extract_text() == PdfReader(str(original)).pages[1].extract_text()
    contents = ContentStream(reader.pages[0].get_contents(), reader)
    assert any(op == b"Tj" and "atividades" in str(args[0])
               for args, op in contents.operations)


def test_ambiguous_occurrences_require_exact_selection(tmp_path):
    original = pdf_with_text(tmp_path, "erro e outro erro")
    with pytest.raises(PdfNativeEditError, match="Mais de uma ocorrência"):
        PdfNativeEditor.apply(
            original, tmp_path / "blocked.pdf",
            {"kind": "replace_text", "page": 0, "old": "erro", "new": "certo", "allow_expansion": True},
        )
    assert not (tmp_path / "blocked.pdf").exists()
    result = PdfNativeEditor.apply(
        original, tmp_path / "changed.pdf",
        {"kind": "replace_text", "page": 0, "old": "erro",
         "new": "certo", "occurrence": 0, "allow_expansion": True},
    )
    assert result["occurrence"] == 0
    assert "certo" in PdfReader(str(tmp_path / "changed.pdf")).pages[0].extract_text()


def test_rejects_overwriting_original_or_stale_sha(tmp_path):
    original = pdf_with_text(tmp_path)
    operation = {"kind": "replace_text", "page": 0,
                 "old": "atividade", "new": "tarefa"}
    with pytest.raises(PdfNativeEditError, match="original"):
        PdfNativeEditor.apply(original, original, operation)
    with pytest.raises(PdfNativeEditError, match="mudou"):
        PdfNativeEditor.apply(original, tmp_path / "changed.pdf", operation,
                              expected_sha256="0" * 64)
    assert not (tmp_path / "changed.pdf").exists()


def test_moves_image_occurrence_without_changing_shared_image_resource(tmp_path):
    image = tmp_path / "square.png"
    Image.new("RGB", (40, 40), "red").save(image)
    source = tmp_path / "images.pdf"
    pdf = FPDF()
    pdf.add_page()
    pdf.image(str(image), x=20, y=20, w=30, h=30)
    pdf.image(str(image), x=75, y=75, w=30, h=30)
    pdf.output(str(source))
    before = PdfReader(str(source))
    original_ops = ContentStream(before.pages[0].get_contents(), before).operations
    before_cm = [list(args) for args, op in original_ops if op == b"cm"]
    output = tmp_path / "moved.pdf"
    PdfNativeEditor.apply(
        source, output,
        {"kind": "move_image", "page": 0, "occurrence": 0, "dx": 24, "dy": -10},
    )
    after = PdfReader(str(output))
    updated = ContentStream(after.pages[0].get_contents(), after).operations
    after_cm = [list(args) for args, op in updated if op == b"cm"]
    assert float(after_cm[0][4]) - float(before_cm[0][4]) == pytest.approx(24)
    assert float(after_cm[0][5]) - float(before_cm[0][5]) == pytest.approx(-10)
    assert after_cm[1] == before_cm[1], "shared resource other occurrence must be unchanged"
    assert len(list(after.pages[0].images)) == len(list(before.pages[0].images))
    assert len(list(after.pages[0].images)) >= 1


def test_unsupported_fonts_are_refused_instead_of_fake_overlays(tmp_path):
    original = pdf_with_text(tmp_path)
    output = tmp_path / "no-change.pdf"
    with pytest.raises(PdfNativeEditError, match="codificação|representa"):
        PdfNativeEditor.apply(
            original, output,
            {"kind": "replace_text", "page": 0,
             "old": "atividade", "new": "測試"},
        )
    assert not output.exists()

"""User-like transactional PDF editing: all operations or no output."""
from hashlib import sha256

import pytest
from fpdf import FPDF
from pypdf import PdfReader

from apps.open_doc.readers.pdf.native_edit import PdfNativeEditor, PdfNativeEditError


def sample(tmp_path):
    path = tmp_path / "source.pdf"
    doc = FPDF()
    doc.add_page()
    doc.set_font("Helvetica", size=14)
    doc.text(20, 25, "Aluno pesquisa arqueologia")
    doc.text(20, 36, "Professor revisa metodologia")
    doc.add_page()
    doc.text(20, 25, "Documento original conservado")
    doc.output(str(path))
    return path


def test_batch_modifies_two_places_without_touching_source(tmp_path):
    source = sample(tmp_path)
    original = source.read_bytes()
    destination = tmp_path / "batch.pdf"
    operations = [
        {"kind": "replace_text", "page": 0, "old": "Aluno", "new": "Equipe"},
        {"kind": "replace_text", "page": 0, "old": "Professor", "new": "Orientador",
         "allow_expansion": True},
    ]
    result = PdfNativeEditor.apply(source, destination,
        {"kind": "batch", "operations": operations},
        expected_sha256=sha256(original).hexdigest())
    assert result["kind"] == "batch" and len(result["operations"]) == 2
    assert source.read_bytes() == original
    assert "Equipe" in PdfReader(destination).pages[0].extract_text()
    assert "Orientador" in PdfReader(destination).pages[0].extract_text()
    assert PdfReader(destination).pages[1].extract_text() == (
        PdfReader(source).pages[1].extract_text())


def test_batch_failure_does_not_write_or_replace_destination(tmp_path):
    source = sample(tmp_path)
    destination = tmp_path / "existing.pdf"
    destination.write_bytes(b"untouched")
    with pytest.raises(PdfNativeEditError):
        PdfNativeEditor.apply(source, destination, {"kind": "batch", "operations": [
            {"kind": "replace_text", "page": 0, "old": "Aluno", "new": "Equipe"},
            {"kind": "replace_text", "page": 0, "old": "sem-existir", "new": "errado"},
        ]})
    assert destination.read_bytes() == b"untouched"
    assert not list(tmp_path.glob(".open-doc-native-*.pdf"))


@pytest.mark.parametrize("invalid", [
    {"kind": "batch", "operations": []},
    {"kind": "batch", "operations": [{}]},
    {"kind": "batch", "operations": [{"kind": "replace_text",
       "page": 0, "old": "Aluno", "new": "Aluno"}]},
    {"kind": "move_image", "page": 0, "occurrence": 0,
     "dx": float("nan"), "dy": 0},
])
def test_invalid_operations_fail_closed(tmp_path, invalid):
    source = sample(tmp_path)
    with pytest.raises(PdfNativeEditError):
        PdfNativeEditor.apply(source, tmp_path / "blocked.pdf", invalid)
    assert not (tmp_path / "blocked.pdf").exists()

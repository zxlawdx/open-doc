"""Editable matrix table: bounds, OOXML cell spacing, preserved content."""
from dataclasses import asdict

import pytest
from docx import Document
from apps.open_doc.document_model.schema import (
    RichDocument, Table, TableRow, TableCell, Paragraph, TextRun
)
from apps.open_doc.document_model.validate import validate_rich_document
from apps.open_doc.exporters.docx_exporter import export_docx
from apps.open_doc.parsers.docx.package import DocxPackage
from apps.open_doc.parsers.docx.namespaces import NS


def editable_matrix():
    cells = [
        TableCell(blocks=[asdict(Paragraph(children=[
            asdict(TextRun(text=label))
        ]))])
        for label in ("Receita", "Quantidade", "2026", "42")
    ]
    table = Table(rows=[
        TableRow(cells=cells[:2]),
        TableRow(cells=cells[2:]),
    ], style_preset="matrix", cell_spacing_pt=12)
    model = RichDocument().to_dict()
    model["blocks"] = [asdict(table)]
    return model


def test_editable_matrix_roundtrip_to_docx_with_cell_spacing(tmp_path):
    model = editable_matrix()
    validate_rich_document(model)
    target = tmp_path / "matriz-editavel.docx"
    export_docx(model, target, "Tabela Matricial")
    actual = Document(target)
    assert len(actual.tables) == 1
    assert [[cell.text for cell in row.cells] for row in actual.tables[0].rows] == [
        ["Receita", "Quantidade"], ["2026", "42"],
    ]
    xml = DocxPackage.open(target).xml("word/document.xml")
    cell_spacing = xml.find(".//w:tblCellSpacing", NS)
    assert cell_spacing is not None
    assert cell_spacing.get("{" + NS["w"] + "}w") == "240"
    assert cell_spacing.get("{" + NS["w"] + "}type") == "dxa"


@pytest.mark.parametrize("value", [-1, 37, float("nan"), float("inf"), "12px", True])
def test_matrix_invalid_spacing_rejected(value):
    model = editable_matrix()
    model["blocks"][0]["cell_spacing_pt"] = value
    with pytest.raises(ValueError, match="Espaçamento"):
        validate_rich_document(model)


def test_invalid_template_rejected():
    model = editable_matrix()
    model["blocks"][0]["style_preset"] = "script"
    with pytest.raises(ValueError, match="Modelo"):
        validate_rich_document(model)

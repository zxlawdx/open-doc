"""Regression: foreign PPTX table geometry must survive the editable import."""
import pytest
from pptx import Presentation
from pptx.util import Inches

from apps.presentations.services.native_importer import read_editable_deck
from shared.contracts.fixed_document.slide_model import SlideModelValidator


def test_import_preserves_unequal_table_tracks(tmp_path):
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    shape = slide.shapes.add_table(3, 2, Inches(1), Inches(1), Inches(8), Inches(3))
    table = shape.table
    table.columns[0].width = Inches(2)
    table.columns[1].width = Inches(6)
    table.rows[0].height = Inches(.5)
    table.rows[1].height = Inches(1)
    table.rows[2].height = Inches(1.5)
    table.cell(0, 0).text = "Grupo"
    table.cell(0, 1).text = "Instruções (opcode em hexadecimal)"
    path = tmp_path / "unequal-tables.pptx"
    deck.save(path)

    model = read_editable_deck(path)
    assert model is not None
    imported = model["surfaces"][0]["elements"][0]
    assert imported["type"] == "table"
    assert imported["table_cells"][0][1] == "Instruções (opcode em hexadecimal)"
    assert imported["table_col_widths"] == pytest.approx([.25, .75])
    assert imported["table_row_heights"] == pytest.approx([1/6, 1/3, 1/2])
    SlideModelValidator().validate({"source_kind": "pptx", **model})


@pytest.mark.parametrize("field,invalid", [
    ("table_row_heights", [.5, .5]),
    ("table_col_widths", [.6, .6]),
    ("table_col_widths", [-.2, 1.2]),
    ("table_col_widths", ["1", 0]),
])
def test_imported_table_rejects_invalid_tracks(tmp_path, field, invalid):
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    slide.shapes.add_table(3, 2, Inches(1), Inches(1), Inches(8), Inches(3))
    path = tmp_path / "table.pptx"
    deck.save(path)
    model = read_editable_deck(path)
    assert model is not None
    model["surfaces"][0]["elements"][0][field] = invalid
    with pytest.raises(ValueError, match="Proporções|Coordenada ou dimensão"):
        SlideModelValidator().validate({"source_kind": "pptx", **model})

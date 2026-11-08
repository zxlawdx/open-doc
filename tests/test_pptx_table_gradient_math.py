"""PPTX table, gradient and equation features survive native export and import."""

from zipfile import ZipFile

from pptx import Presentation
from pptx.enum.dml import MSO_FILL

from apps.open_doc.fixed_document.slide_model import SlideModelValidator
from apps.open_doc.readers.pptx.exporter import SlideDeckExporter
from apps.open_doc.readers.pptx.native_importer import read_editable_deck


def test_native_table_gradient_and_math_roundtrip(tmp_path):
    gradient = {"start": "#000000", "end": "#285A99", "angle": 115}
    cells = [["Categoria", "Valor"], ["Pesquisa\nEducação", "39,2"]]
    math = [{"kind": "sqrt", "radicand": [
        {"kind": "superscript", "base": "x", "power": "2"}
    ]}]

    def element(kind, **properties):
        return dict(id=kind, type=kind, x=.1, y=.1, width=.6, height=.3,
                    rotation=0, font_size_pt=18, **properties)

    model = {"source_kind": "pptx", "editable_deck": True, "surfaces": [{
        "index": 0, "width_pt": 960, "height_pt": 540, "background": "#000000",
        "background_gradient": gradient, "elements": [
            element("table", table_cells=cells, table_preset="matrix",
                    table_transparent=True, table_padding_pt=7, color="#FFFFFF"),
            element("rect", fill_gradient=gradient),
            element("math", math_blocks=math),
        ],
    }]}
    SlideModelValidator().validate(model)
    target = tmp_path / "native.pptx"
    SlideDeckExporter(None, model).write(target)

    slide = Presentation(target).slides[0]
    assert slide.background.fill.type == MSO_FILL.GRADIENT
    assert slide.shapes[1].fill.type == MSO_FILL.GRADIENT
    table = slide.shapes[0].table
    assert table.cell(0, 0).fill.type == MSO_FILL.BACKGROUND
    assert table.cell(1, 1).margin_left.pt == 7
    assert table.cell(1, 0).text == "Pesquisa\nEducação"
    with ZipFile(target) as package:
        xml = package.read("ppt/slides/slide1.xml")
        assert b"<m:oMath>" in xml and b"<m:rad>" in xml and b"<m:sSup>" in xml
        assert not any(path.startswith("ppt/media/") for path in package.namelist())

    reopened = read_editable_deck(target)["surfaces"][0]
    assert reopened["background_gradient"] == gradient
    native_table, rect, equation = reopened["elements"]
    assert native_table["table_cells"] == cells
    assert native_table["table_preset"] == "matrix"
    assert native_table["table_transparent"] is True
    assert native_table["table_padding_pt"] == 7
    assert native_table["color"] == "#FFFFFF"
    assert rect["fill_gradient"] == gradient
    assert equation["type"] == "math"
    assert equation["math_blocks"] == math

"""Native structured formula export, import and rejection boundaries."""
from copy import deepcopy
from zipfile import ZipFile

import pytest
from pptx import Presentation

from shared.contracts.fixed_document.validation import validate
from shared.contracts.fixed_document.slide_model import SlideModelValidator
from apps.presentations.services.native_importer import read_editable_deck, _shape_element
from shared.services.native_math import read_math
from apps.presentations.services.exporter import export_pptx
from config.composition import configure
from shared.services.preferences_service import Config


BLOCKS = [
    {"kind": "text", "value": "∫₀^π sen(x) dx = "},
    {"kind": "fraction", "numerator": "x²+1", "denominator": "x+1"},
    {"kind": "text", "value": " + "},
    {"kind": "nary", "operator": "∑", "lower": "k=1", "upper": "n", "body": "k"},
    {"kind": "superscript", "base": "x", "power": "2"},
    {"kind": "sqrt", "radicand": "x²+1"},
]


def math_element(blocks=None):
    return dict(id="native-math-1", type="math", name="Equação editável",
                x=.1, y=.2, width=.78, height=.3, rotation=0,
                font_family="Cambria Math", font_size_pt=28,
                color="#191C1E", fill="#FFFFFF", stroke="#004AC6",
                stroke_width=1.5, text="", math_blocks=deepcopy(blocks or BLOCKS))


def test_math_exports_as_structured_office_equation_not_png(tmp_path):
    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation()
    model = deepcopy(note["content"])
    model["surfaces"][0]["elements"] = [math_element()]
    validate(model)
    target = tmp_path / "nativa.pptx"
    export_pptx(ctx.fixed_documents.source(note["id"]), model, target)
    with ZipFile(target) as archive:
        xml = archive.read("ppt/slides/slide1.xml").decode("utf-8")
        assert "oMath" in xml
        assert "a14:m" in xml
        assert "m:f" in xml and "m:num" in xml and "m:den" in xml
        assert "m:nary" in xml and "m:sSup" in xml and "m:rad" in xml
        assert not any(name.startswith("ppt/media/") for name in archive.namelist())
    assert len(Presentation(target).slides[0].shapes) == 1
    imported = read_editable_deck(target)
    assert imported is not None
    block = imported["surfaces"][0]["elements"][0]
    assert block["type"] == "math"
    assert block["math_blocks"] == BLOCKS


def test_editing_imported_equation_preserves_native_omml(tmp_path):
    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation()
    model = deepcopy(note["content"])
    model["surfaces"][0]["elements"] = [math_element()]
    src = tmp_path / "source.pptx"
    export_pptx(ctx.fixed_documents.source(note["id"]), model, src)
    imported = read_editable_deck(src)
    edited = deepcopy(imported)
    blocks = edited["surfaces"][0]["elements"][0]["math_blocks"]
    blocks[1]["numerator"] = "x³ + 1"
    SlideModelValidator().validate(dict(edited, source_kind="pptx"))
    out = tmp_path / "edited.pptx"
    export_pptx(src, edited, out)
    deck_again = Presentation(out)
    assert len(deck_again.slides[0].shapes) == 1
    shape_again = deck_again.slides[0].shapes[0]
    assert read_math(shape_again)[1]["numerator"] == "x³ + 1"
    assert _shape_element(shape_again, deck_again.slide_width, deck_again.slide_height, {})["type"] == "math"
    again = read_editable_deck(out)
    assert again is not None
    assert again["surfaces"][0]["elements"][0]["math_blocks"][1]["numerator"] == "x³ + 1"


@pytest.mark.parametrize("blocks", [
    [],
    [{"kind": "html", "value": "<script>"}],
    [{"kind": "fraction", "numerator": "x", "denominator": ""}],
    [{"kind": "nary", "operator": "?", "lower": "", "upper": "", "body": "x"}],
    [{"kind": "text", "value": "x" * 161}],
    [{"kind": "text", "value": "\x00"}],
])
def test_invalid_math_fails_validation(tmp_path, blocks):
    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation()
    model = deepcopy(note["content"])
    model["surfaces"][0]["elements"] = [math_element(blocks) if blocks else
                                           dict(math_element(), math_blocks=[])]
    with pytest.raises(ValueError):
        validate(model)

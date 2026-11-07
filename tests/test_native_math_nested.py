"""Nested native OMML: equations remain editable and are never bitmaps."""
from copy import deepcopy
from lxml import etree
import pytest
from pptx import Presentation

from apps.open_doc.readers.pptx.native_math import (
    M, build_word_omath, parse_word_omath, read_math, validate_math_blocks,
    write_math,
)

def nested_formula():
    return [
        {"kind": "text", "value": "y = "},
        {"kind": "fraction",
         "numerator": [{"kind": "sqrt", "radicand": [
             {"kind": "superscript", "base": "x", "power": "2"},
             {"kind": "text", "value": "+1"},
         ]}],
         "denominator": [{"kind": "nary", "operator": "∑",
                          "lower": "k=1", "upper": "n", "body": "k"}]},
        {"kind": "text", "value": " + "},
        {"kind": "matrix", "rows": [
            ["a", [{"kind": "fraction", "numerator": "1", "denominator": "2"}]],
            ["c", "d"],
        ]},
        {"kind": "limit", "base": "lim", "lower": "x→0"},
        {"kind": "root", "index": "3", "radicand": "x"},
        {"kind": "subscript", "base": "x", "sub": "i"},
    ]

def test_nested_roundtrip_pptx_and_docx(tmp_path):
    blocks = nested_formula()
    validate_math_blocks(blocks)
    root = build_word_omath(blocks)
    assert len(root.xpath(".//m:f", namespaces={"m": M})) == 2
    assert len(root.xpath(".//m:m", namespaces={"m": M})) == 1
    assert parse_word_omath(etree.fromstring(etree.tostring(root))) == blocks
    pptx = Presentation()
    slide = pptx.slides.add_slide(pptx.slide_layouts[6])
    shape = slide.shapes.add_textbox(0, 0, pptx.slide_width, pptx.slide_height)
    write_math(shape, blocks)
    target = tmp_path / "native-nested.pptx"
    pptx.save(target)
    opened = Presentation(target)
    assert read_math(opened.slides[0].shapes[0]) == blocks
    changed = deepcopy(blocks)
    changed[1]["numerator"][0]["radicand"][0]["power"] = "4"
    write_math(opened.slides[0].shapes[0], changed)
    assert len(list(opened.slides[0].shapes[0]._element.iter(
        "{http://schemas.microsoft.com/office/drawing/2010/main}m"))) == 1
    assert read_math(opened.slides[0].shapes[0]) == changed

@pytest.mark.parametrize("invalid", [
    [{"kind": "matrix", "rows": [["a"], ["b", "c"]]}],
    [{"kind": "matrix", "rows": [["x"] * 7]}],
    [{"kind": "fraction", "numerator": [], "denominator": "1"}],
    [{"kind": "root", "index": "", "radicand": "x"}],
    [{"kind": "text", "value": "x" * 161}],
    [{"kind": "text", "value": "\x00"}],
    [{"kind": "fraction", "numerator": [[{"kind": "text", "value": "x"}]], "denominator": "2"}],
])
def test_invalid_nested_math_fails_safely(invalid):
    with pytest.raises(ValueError):
        validate_math_blocks(invalid)

def test_depth_budget_enforced():
    value = "x"
    for _ in range(8):
        value = [{"kind": "sqrt", "radicand": value}]
    with pytest.raises(ValueError):
        validate_math_blocks(value)

def test_unknown_external_math_is_not_silently_converted():
    xml = build_word_omath([{"kind": "text", "value": "x"}])
    etree.SubElement(xml, "{%s}func" % M)
    with pytest.raises(ValueError):
        parse_word_omath(xml)

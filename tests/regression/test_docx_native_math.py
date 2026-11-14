"""DOCX formula objects must survive editable import/export as Word-native OMML."""
from copy import deepcopy
from zipfile import ZipFile

import pytest
from docx import Document

from shared.contracts.document_model.validate import validate_rich_document
from apps.documents.services.exporters.docx_exporter import export_docx
from shared.utils.ooxml_package import DocxPackage
from shared.services.native_math import build_word_omath
from apps.documents.services.document_service import Editor
from shared.services.preferences_service import Config

BLOCKS = [
    {"kind": "text", "value": "f(x) = "},
    {"kind": "fraction", "numerator": "x² + 1", "denominator": "x + 1"},
    {"kind": "text", "value": " + "},
    {"kind": "nary", "operator": "∫", "lower": "0", "upper": "π", "body": "sen(x) dx"},
    {"kind": "superscript", "base": "x", "power": "3"},
]


def test_docx_native_math_import_edit_export_roundtrip(tmp_path):
    source = tmp_path / "math.docx"
    doc = Document()
    p = doc.add_paragraph("Resultado: ")
    p._p.append(build_word_omath(BLOCKS))
    doc.save(source)
    editor = Editor(Config(tmp_path / "workspace"))
    note = editor.import_docx(source)
    content = deepcopy(note["content"])
    math = [node for b in content["blocks"] for node in b.get("children", [])
            if node["type"] == "math"]
    assert len(math) == 1 and math[0]["math_blocks"] == BLOCKS
    math[0]["math_blocks"][1]["numerator"] = "x³ + 2"
    validate_rich_document(content)
    target = tmp_path / "edited.docx"
    export_docx(content, target, note["title"],
                package_directory=editor.package_directory(note["id"]))
    assert ZipFile(target).testzip() is None
    xml = ZipFile(target).read("word/document.xml").decode("utf-8")
    assert "oMath" in xml and "m:f" in xml and "m:nary" in xml
    assert "x³ + 2" in xml
    reimported = editor.import_docx(target)["content"]
    formulas = [n for b in reimported["blocks"] for n in b.get("children", []) if n["type"] == "math"]
    assert len(formulas) == 1
    assert formulas[0]["math_blocks"][1]["numerator"] == "x³ + 2"


def test_docx_unsupported_external_math_is_preserved_as_opaque(tmp_path):
    from lxml import etree
    doc = Document()
    p = doc.add_paragraph()
    math = build_word_omath([{"kind": "text", "value": "x"}])
    math.append(etree.Element("{http://schemas.openxmlformats.org/officeDocument/2006/math}unknown"))
    p._p.append(math)
    source = tmp_path / "unsupported.docx"
    doc.save(source)
    editor = Editor(Config(tmp_path / "workspace"))
    content = editor.import_docx(source)["content"]
    nodes = [n for b in content["blocks"] for n in b.get("children", [])]
    assert any(n["type"] == "opaque-ooxml" for n in nodes)
    assert not any(n["type"] == "math" for n in nodes)


def test_invalid_rich_math_nodes_are_rejected():
    from shared.contracts.document_model.schema import RichDocument
    model = RichDocument().to_dict()
    from uuid import uuid4
    model["blocks"] = [{
        "id": str(uuid4()), "type": "paragraph", "style": {},
        "children": [{"id": str(uuid4()), "type": "math", "math_blocks": [
            {"kind": "fraction", "numerator": "1", "denominator": ""}]}]
    }]
    with pytest.raises(ValueError):
        validate_rich_document(model)

import sqlite3
from dataclasses import asdict
import pytest
from apps.open_doc.document_model.schema import RichDocument, Paragraph, TextRun
from apps.open_doc.document_model.serialization import serialize_document, load_document
from apps.open_doc.document_model.migration import migrate_documents
from apps.open_doc.document_model.validate import validate_rich_document


def model():
    m = RichDocument().to_dict()
    m["blocks"] = [asdict(Paragraph(children=[asdict(TextRun(text="Preservar"))]))]
    return m


def test_model_roundtrip():
    m = model()
    assert load_document(serialize_document(m)) == m


@pytest.mark.parametrize(
    "key,value",
    [
        ("color", "url(x)"),
        ("font_size_pt", 513),
        ("font_family", "<script>"),
        ("highlight", "url(x)"),
    ],
)
def test_invalid_style(key, value):
    m = model()
    m["blocks"][0]["children"][0]["style"][key] = value
    with pytest.raises(ValueError):
        validate_rich_document(m)


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "text", "text": "bad"},
        {
            "id": "n",
            "type": "paragraph",
            "children": [],
            "style": {"alignment": "url(x)"},
        },
        {"id": "n", "type": "paragraph", "children": None, "style": {}},
    ],
)
def test_invalid_graph(bad):
    m = model()
    m["blocks"] = [bad]
    with pytest.raises(ValueError):
        validate_rich_document(m)


def test_idempotent_migration(tmp_path):
    c = sqlite3.connect(tmp_path / "old.db")
    c.row_factory = sqlite3.Row
    c.executescript(
        'CREATE TABLE documents (id TEXT,markdown TEXT);CREATE TABLE recovery (id TEXT,markdown TEXT);INSERT INTO documents VALUES ("old","# Original");'
    )
    migrate_documents(c)
    migrate_documents(c)
    row = dict(c.execute("SELECT * FROM documents").fetchone())
    assert (
        row["markdown"] == "# Original"
        and row["content_format"] == "markdown"
        and row["content_json"] is None
    )
    c.close()

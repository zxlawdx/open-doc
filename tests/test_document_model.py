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


def test_save_reuses_the_json_checked_by_validation(monkeypatch):
    import apps.open_doc.document_model.validate as validation

    dumps = validation.json.dumps
    encodes = []

    def measured(*args, **kwargs):
        encodes.append(1)
        return dumps(*args, **kwargs)

    monkeypatch.setattr(validation.json, "dumps", measured)
    value = model()
    encoded = serialize_document(value)
    assert len(encodes) == 1
    assert encoded == dumps(
        value, ensure_ascii=False, allow_nan=False, separators=(",", ":")
    )
    assert load_document(encoded) == value


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -float("inf")])
def test_single_encoding_still_rejects_nonfinite_metadata(invalid):
    value = model()
    value["metadata"]["invalid"] = invalid
    with pytest.raises(ValueError):
        serialize_document(value)


def test_canonical_size_limit_is_identical_on_save_and_reopen(monkeypatch):
    import apps.open_doc.document_model.validate as validation

    value = model()
    value["blocks"][0]["children"][0]["text"] = "Cálculo 🐧"
    encoded = serialize_document(value)
    monkeypatch.setattr(
        validation, "MAX_MODEL_JSON_BYTES", len(encoded.encode("utf-8"))
    )
    assert load_document(serialize_document(value)) == value
    monkeypatch.setattr(
        validation, "MAX_MODEL_JSON_BYTES", len(encoded.encode("utf-8")) - 1
    )
    with pytest.raises(ValueError, match="128 MB"):
        serialize_document(value)
    with pytest.raises(ValueError, match="128 MB"):
        load_document(encoded)

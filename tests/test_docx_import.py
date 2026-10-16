from pathlib import Path
from zipfile import ZipFile
import pytest
from app.config import Config
from app.editor import Editor
from app.importers.docx.package import DocxPackage
from docx_fixtures import fixture_docx


@pytest.fixture
def imported(tmp_path):
    editor = Editor(Config(tmp_path / "workspace"))
    source = fixture_docx(tmp_path / "fixture.docx")
    return editor, editor.import_docx(source), source


def test_runs_fonts_colors(imported):
    runs = imported[1]["content"]["blocks"][2]["children"]
    assert {r.get("style", {}).get("font_family") for r in runs} >= {
        "Arial",
        "Times New Roman",
        "Courier New",
        "Aptos",
    }
    r = next(r for r in runs if r.get("text") == "Formatado")
    assert all(r["style"][k] for k in ["bold", "italic", "underline", "strike"])
    assert r["style"]["color"] == "FF0000" and r["style"]["highlight"] == "yellow"
    assert {"superscript", "subscript"} <= {
        r.get("style", {}).get("vertical_align") for r in runs
    }


def test_multilevel_lists(imported):
    info = [
        p["list_info"] for p in imported[1]["content"]["blocks"] if p.get("list_info")
    ]
    assert [(i["level"], i["format"]) for i in info[:3]] == [
        (0, "decimal"),
        (1, "lowerLetter"),
        (2, "lowerRoman"),
    ]
    assert info[-1]["format"] == "bullet"


def test_tables_merges(imported):
    t = next(b for b in imported[1]["content"]["blocks"] if b["type"] == "table")
    assert t["rows"][0]["cells"][0]["col_span"] == 2
    assert t["rows"][1]["cells"][2]["row_span"] == 2
    assert t["rows"][2]["cells"][2]["merge_continue"]
    assert t["rows"][0]["cells"][0]["shading"] == "FFFF00"


def test_images_sections_headers_links_breaks(imported):
    editor, note, source = imported
    m = note["content"]
    assert len(m["media"]) == 1 and len(m["sections"]) == 2
    assert m["sections"][1]["page_width_pt"] == 792
    assert "Cabeçalho original" in str(m["headers"]) and "Rodapé original" in str(
        m["footers"]
    )
    assert (
        editor.package_directory(note["id"]) / "original.docx"
    ).read_bytes() == source.read_bytes()
    children = [c for p in m["blocks"] for c in p.get("children", [])]
    assert any(c.get("break_type") == "page" for c in children)
    assert any(c.get("href") == "https://example.com" for c in children)


def test_notes_and_fields(imported):
    m = imported[1]["content"]
    assert "Nota footnotes" in str(m["footnotes"]) and "Nota endnotes" in str(
        m["endnotes"]
    )
    children = [r for p in m["blocks"] for r in p.get("children", [])]
    assert len([r for r in children if r["type"] == "note-reference"]) == 2
    f = next(r for r in children if r["type"] == "field")
    assert (
        f["instruction"].strip() == "PAGE"
        and f["display"] == "7"
        and len(f["xml_parts"]) == 5
    )


@pytest.mark.parametrize(
    "name,data",
    [
        ("../escape.xml", b"<x/>"),
        (
            "word/document.xml",
            b'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>',
        ),
        ("word/document.xml", "<!DOCTYPE x><x/>".encode("utf-16")),
    ],
)
def test_package_security(tmp_path, name, data):
    path = tmp_path / "bad.docx"
    with ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", b"<x/>")
        z.writestr("_rels/.rels", b"<x/>")
        z.writestr(name, data)
    with pytest.raises(ValueError):
        DocxPackage.open(path)


def test_persistence_recovery_legacy_backup(imported):
    e, note, _ = imported
    m = note["content"]
    m["blocks"][0]["children"][0]["text"] = "Editado"
    assert e.stash_recovery(
        note["id"],
        note["title"],
        note["markdown"],
        note["revision"],
        m,
        "opendoc-rich-v1",
    )["stored"]
    assert e.get(note["id"])["recovery"]["content"] == m
    e.save(
        note["id"],
        note["title"],
        note["markdown"],
        note["revision"],
        m,
        "opendoc-rich-v1",
    )
    assert Editor(e.config).current()["content"] == m
    old = e.create("Antigo", "# Original")
    e.save(old["id"], old["title"], old["markdown"], 1, m, "opendoc-rich-v1")
    with e._connect() as c:
        assert (
            c.execute(
                "SELECT markdown FROM legacy_backups WHERE id=?", (old["id"],)
            ).fetchone()[0]
            == "# Original"
        )


def test_rich_copy_preserves_package_and_media(imported):
    e, note, source = imported
    copied = e.create_rich_copy("Cópia", note["content"], note["id"])
    assert copied["id"] != note["id"] and copied["content"] == note["content"]
    assert (
        e.package_directory(copied["id"]) / "original.docx"
    ).read_bytes() == source.read_bytes()
    for mid in note["content"]["media"]:
        assert (e.package_directory(copied["id"]) / "media" / mid).read_bytes() == (
            e.package_directory(note["id"]) / "media" / mid
        ).read_bytes()

import json
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor

import pytest

from apps.documents.services.document_service import Editor, RevisionConflict
from shared.services.preferences_service import Config


def test_hundred_versions_reopen_restore_and_continue(tmp_path):
    config = Config(tmp_path)
    editor = Editor(config)
    note = editor.current()
    identifier = note["id"]
    for number in range(1, 100):
        note = editor.save(identifier, "Caderno", str(number), note["revision"])

    editor = Editor(config)
    versions = editor.versions(identifier, "list")["versions"]
    assert len(versions) == 100
    assert [entry["parent_id"] for entry in versions] == [
        entry["id"] for entry in versions[1:]
    ] + [None]
    target = versions[49]["id"]
    comparison = editor.versions(identifier, "inspect", version_id=target)
    assert comparison["selected"]["markdown"] == "50"
    assert comparison["current"]["markdown"] == "99"

    result = editor.versions(
        identifier, "restore", version_id=target, revision=note["revision"]
    )
    assert [v["reason"] for v in result["versions"][:2]] == [
        "restored",
        "before_restore",
    ]
    restored = editor.get(identifier)
    assert restored["markdown"] == "50"
    editor.save(identifier, "Caderno", "51", restored["revision"])
    assert len(editor.versions(identifier, "list")["versions"]) == 103
    assert Editor(config).current()["markdown"] == "51"


def test_recovery_conflict_and_corruption_leave_history_unchanged(tmp_path):
    editor = Editor(Config(tmp_path))
    note = editor.current()
    identifier, revision = note["id"], note["revision"]
    versions = editor.versions(identifier, "list")["versions"]
    version_id = versions[0]["id"]
    editor.stash_recovery(identifier, note["title"], "Rascunho", revision)
    with pytest.raises(RevisionConflict, match="rascunho"):
        editor.versions(identifier, "restore", revision=revision, version_id=version_id)
    assert Editor(editor.config).get(identifier)["recovery"]["markdown"] == "Rascunho"
    editor.discard_recovery(identifier)
    with editor._connect() as connection:
        connection.execute("UPDATE version_payloads SET payload=?", (json.dumps({}),))
    with pytest.raises(ValueError, match="integridade"):
        editor.versions(identifier, "restore", revision=revision, version_id=version_id)
    assert editor.get(identifier)["revision"] == revision
    assert editor.versions(identifier, "list")["versions"] == versions


def test_failed_snapshot_write_rolls_back_document_and_recovery(tmp_path):
    editor = Editor(Config(tmp_path))
    note = editor.current()
    identifier, revision = note["id"], note["revision"]
    editor.versions(identifier, "list")
    editor.stash_recovery(identifier, note["title"], "Rascunho", revision)
    with editor._connect() as connection:
        connection.execute("""
            CREATE TRIGGER fail_history BEFORE INSERT ON document_versions
            BEGIN SELECT RAISE(ABORT, 'write failed'); END
        """)
    import sqlite3

    with pytest.raises(sqlite3.IntegrityError, match="write failed"):
        editor.save(identifier, note["title"], "Alteração", revision)
    reopened = Editor(editor.config).get(identifier)
    assert reopened["markdown"] == note["markdown"]
    assert reopened["revision"] == revision
    assert reopened["recovery"]["markdown"] == "Rascunho"


def test_concurrent_saves_append_only_the_winning_change(tmp_path):
    config = Config(tmp_path)
    editor = Editor(config)
    note = editor.current()

    def save(text):
        try:
            Editor(config).save(note["id"], note["title"], text, note["revision"])
            return True
        except RevisionConflict:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, ["A", "B"])) == [False, True]
    assert len(editor.versions(note["id"], "list")["versions"]) == 2


def test_named_copy_and_safe_delete(tmp_path):
    editor = Editor(Config(tmp_path))
    identifier = editor.current()["id"]
    versions = editor.versions(identifier, "create", name="Primeira versão")["versions"]
    named = versions[0]
    copied = editor.versions(
        identifier, "duplicate", version_id=named["id"], name="Cópia"
    )["versions"][0]
    assert copied["hash"] == named["hash"]
    assert copied["id"] != named["id"]
    with pytest.raises(ValueError, match="mais recente"):
        editor.versions(identifier, "delete", version_id=named["id"])
    editor.versions(identifier, "rename", version_id=named["id"], name="Revisada")
    versions = editor.versions(identifier, "delete", version_id=copied["id"])[
        "versions"
    ]
    assert versions[0]["name"] == "Revisada"
    with editor._connect() as connection:
        assert (
            connection.execute("SELECT count(*) FROM version_payloads").fetchone()[0]
            == 1
        )


@pytest.mark.parametrize("kind", ["docx", "pdf", "pptx"])
def test_history_roundtrip_through_http_for_each_editor(tmp_path, kind, monkeypatch):
    from docx import Document
    from fpdf import FPDF
    from webtest import TestApp

    from config.composition import get_context
    from config.wsgi import create_app

    import vela.core.app as runtime

    class Window:
        def __init__(self, **kwargs):
            pass

        def run(self):
            pass

    monkeypatch.setattr(runtime, "DesktopWindow", Window)
    app = create_app(Config(tmp_path))
    app.run()
    ctx = get_context()
    client = TestApp(app.api_server.app)
    headers = {"X-Open-Doc-Token": ctx.token}

    if kind == "docx":
        path = tmp_path / "document.docx"
        document = Document()
        document.add_paragraph("Texto original")
        document.save(path)
        original = ctx.editor.import_docx(path)
    elif kind == "pdf":
        path = tmp_path / "document.pdf"
        pdf = FPDF()
        pdf.add_page()
        pdf.output(path)
        original = ctx.fixed_documents.import_pdf(path)
    else:
        original = ctx.fixed_documents.create_presentation("Apresentação")

    def post(endpoint, data, **kwargs):
        return client.post_json(
            "/api/open_doc/document/" + endpoint, data, headers=headers, **kwargs
        ).json

    def history(operation, **kwargs):
        return post(
            "versions", {"id": original["id"], "operation": operation, **kwargs}
        )

    client.post_json(
        "/api/open_doc/document/versions",
        {"id": original["id"], "operation": "list"},
        status=403,
    )
    baseline = history("list")["versions"][0]
    if kind == "pdf":
        reader_view = {"page": 0, "offset": 0.25, "left": 0, "zoom": 1.25}
        post("pdf-view", {"id": original["id"], "view": reader_view})
        assert history("list")["versions"] == [baseline]
    edited = deepcopy(original["content"])
    if kind == "docx":
        edited["blocks"][0]["children"][0]["text"] = "Texto revisado"
    elif kind == "pdf":
        from test_pdf_semantic_annotations import markup

        edited["annotations"] = [markup()]
    else:
        from test_native_slide_editor import element

        edited["surfaces"][0]["elements"] = [element()]
    changed = post("save", {**original, "title": "Título revisado", "content": edited})
    inspection = history("inspect", version_id=baseline["id"])
    assert inspection["current"]["title"] == "Título revisado"
    assert json.loads(inspection["current"]["content_json"]) == edited
    assert inspection["selected"]["title"] == original["title"]
    result = history("restore", version_id=baseline["id"], revision=changed["revision"])
    assert result["document"]["title"] == original["title"]
    assert result["document"]["content"] == original["content"]
    assert result["document"]["revision"] == changed["revision"] + 1
    if kind == "pdf":
        assert result["document"]["reader_view"] == reader_view


def test_restore_one_slide_keeps_newer_edits_and_recovery_point(tmp_path):
    from config.composition import configure
    from test_native_slide_editor import element

    context = configure(Config(tmp_path))
    fixed = context.fixed_documents
    document = fixed.create_presentation("Apresentação")
    original = deepcopy(document["content"])
    second = {**deepcopy(original["surfaces"][0]), "index": 1}
    original["surfaces"].append(second)
    original["surfaces"][0]["elements"] = [element()]
    document = fixed.save(
        document["id"], document["title"], original, document["revision"]
    )
    versions = context.documents.versions({"id": document["id"], "operation": "list"})
    version_id = versions["versions"][0]["id"]
    edited = deepcopy(original)
    edited["surfaces"][0]["elements"][0]["text"] = "Texto revisado"
    edited["surfaces"][1]["elements"] = [element()]
    newer = fixed.save(document["id"], "Título recente", edited, document["revision"])

    restore = {
        "id": document["id"],
        "operation": "restore_slide",
        "version_id": version_id,
        "revision": newer["revision"],
        "slide_index": 0,
    }
    with pytest.raises(ValueError, match="duas versões"):
        context.documents.versions({**restore, "slide_index": 2})
    result = context.documents.versions(restore)
    restored = result["document"]
    assert restored["title"] == newer["title"]
    assert restored["revision"] == newer["revision"] + 1
    assert restored["content"]["surfaces"] == [
        original["surfaces"][0],
        edited["surfaces"][1],
    ]
    undo_id = next(
        v["id"] for v in result["versions"] if v["reason"] == "before_restore"
    )
    before = context.documents.versions(
        {
            "id": document["id"],
            "operation": "inspect",
            "version_id": undo_id,
        }
    )
    assert json.loads(before["selected"]["content_json"]) == edited
    with pytest.raises(RevisionConflict):
        context.documents.versions(restore)

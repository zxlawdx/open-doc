import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from apps.open_doc.services.document_service import Editor, RevisionConflict
from apps.open_doc.services.preferences_service import Config


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

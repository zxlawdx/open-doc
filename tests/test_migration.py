"""Regressões de branding, workspace legado e preferências Open Doc."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from apps.open_doc.services.preferences_service import APP_TITLE, Config
from apps.open_doc.services.document_service import Editor
from apps.open_doc.services.workspace_service import resolve_workspace


def test_workspace_copy_preserves_documents_settings_and_original(
    tmp_path: Path,
) -> None:
    """Copia notas, recovery, exports e preferências sem remover o legado."""
    legacy = tmp_path / "VelaWriter"
    config = Config(legacy)
    editor = Editor(config)
    note = editor.create("Ciência", "# Nota antiga\n\nOlá, ação.")
    editor.stash_recovery(note["id"], note["title"], "Recuperável", note["revision"])
    config.save_settings({"sidebar_collapsed": True})
    for folder, filename in [
        ("notes", "nota.md"),
        ("exports", "saida.pdf"),
        ("documents/docx", "doc.docx"),
    ]:
        (legacy / folder / filename).write_bytes(b"preservar")
    destination = resolve_workspace(tmp_path)
    assert destination == tmp_path / "OpenDoc"
    restored = Editor(Config(destination)).current()
    assert restored["id"] == note["id"]
    assert restored["markdown"] == note["markdown"]
    assert restored["recovery"]["markdown"] == "Recuperável"
    assert Config(destination).load_settings()["sidebar_collapsed"] is True
    assert (legacy / "notes/nota.md").read_bytes() == (
        destination / "notes/nota.md"
    ).read_bytes()
    assert (legacy / "exports/saida.pdf").exists()
    assert (destination / "documents/docx/doc.docx").exists()
    report = json.loads((destination / ".veladata/migration.json").read_text())
    assert report["outcome"] == "copied" and report["original_preserved"]
    assert resolve_workspace(tmp_path) == destination


def test_existing_workspace_is_never_merged_or_overwritten(tmp_path: Path) -> None:
    """Se ambos existem, o novo ganha sem mescla implícita."""
    old = Editor(Config(tmp_path / "VelaWriter"))
    old.create("Antigo", "antigo")
    current = Editor(Config(tmp_path / "OpenDoc"))
    note = current.create("Novo", "novo")
    root = resolve_workspace(tmp_path)
    assert Editor(Config(root)).current()["id"] == note["id"]
    assert old.current()["markdown"] == "antigo"
    assert (
        json.loads((root / ".veladata/migration.json").read_text())["outcome"]
        == "kept-existing"
    )


def test_live_wal_database_copied_with_sqlite_backup(tmp_path: Path) -> None:
    """Backup lê conteúdo commitado em WAL, sem depender de cópia crua."""
    legacy = tmp_path / "VelaWriter"
    config = Config(legacy)
    editor = Editor(config)
    with sqlite3.connect(editor.path) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        note = editor.create("WAL", "conteúdo em WAL")
        destination = resolve_workspace(tmp_path)
        assert Editor(Config(destination)).current()["id"] == note["id"]


def test_failed_migration_keeps_original(tmp_path: Path) -> None:
    """Banco inválido não publica cópia parcial nem remove o original."""
    legacy = tmp_path / "VelaWriter/.veladata"
    legacy.mkdir(parents=True)
    database = legacy / "writer.sqlite3"
    database.write_bytes(b"invalid sqlite")
    with pytest.raises(sqlite3.DatabaseError):
        resolve_workspace(tmp_path)
    assert database.read_bytes() == b"invalid sqlite"
    assert not (tmp_path / "OpenDoc").exists()


def test_preferences_migrate_and_persist_theme_zoom(tmp_path: Path) -> None:
    """Configuração antiga ganha defaults e preserva preferência após relaunch."""
    config = Config(tmp_path)
    config.settings_path.write_text('{"sidebar_collapsed": true}', encoding="utf-8")
    assert config.load_settings()["theme"] == "system"
    config.save_settings({"theme": "dark", "zoom": 120})
    restored = Config(tmp_path).load_settings()
    assert restored == {
        "sidebar_collapsed": True,
        "theme": "dark",
        "zoom": 120,
        "view_mode": "pages",
    }
    with pytest.raises(ValueError):
        config.save_settings({"theme": "purple"})
    with pytest.raises(ValueError):
        config.save_settings({"zoom": 999})


def test_open_doc_branding_and_namespace() -> None:
    """Nenhum branding antigo ou fases aparecem nos templates finais."""
    assert APP_TITLE == "Open Doc"
    root = Path(__file__).resolve().parents[1]
    templates = "\n".join(
        path.read_text() for path in (root / "apps/open_doc/templates").glob("*.html")
    )
    for old in (
        "Vela Writer",
        "VelaWriter",
        "vela-writer",
        "Fase 1",
        "Fase 2",
        "NO HORIZONTE",
    ):
        assert old not in templates
    assert (root / "apps/open_doc/views/__init__.py").exists()
    assert not (root / "apps/writer").exists()

"""Editor SQLite readers remain available during concurrent writes."""

from apps.documents.services.document_service import Editor
from shared.services.preferences_service import Config
from shared.services.fixed_document_service import FixedDocumentService


def test_wal_keeps_fixed_session_readable_during_exclusive_writer(tmp_path):
    config = Config(tmp_path)
    editor = Editor(config)
    fixed = FixedDocumentService(editor, config, fonts=None)
    fixed.activate("pptx")
    with editor._connect() as writer:
        assert writer.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        writer.execute("BEGIN EXCLUSIVE")
        writer.execute("UPDATE session SET value=value WHERE key='active_kind'")
        assert fixed.active_kind() == "pptx"

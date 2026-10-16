"""
Módulo: editor.py.
Responsabilidade: persistir documentos e sessões com controle de revisões.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import UUID, uuid4

from apps.open_doc.services.preferences_service import Config

AUTOSAVE_SECONDS = 30
MAX_TITLE_LENGTH = 180
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
INITIAL_REVISION = 1


class RevisionConflict(ValueError):
    """Indica edição concorrente sem permitir sobrescrita silenciosa."""


class Editor:
    """Armazena documentos e documento ativo em transações SQLite."""

    def __init__(self, config: Config) -> None:
        """Inicializa o banco do workspace e restaura a sessão."""
        self.config = config
        self.path = config.root / ".veladata" / "writer.sqlite3"
        self._lock = RLock()
        with self._connect() as connection:
            connection.executescript(
                "CREATE TABLE IF NOT EXISTS documents ("
                "id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL,"
                "revision INTEGER NOT NULL, updated_at TEXT NOT NULL);"
                "CREATE TABLE IF NOT EXISTS session ("
                "key TEXT PRIMARY KEY, value TEXT NOT NULL);"
                "CREATE TABLE IF NOT EXISTS recovery ("
                "id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL,"
                "revision INTEGER NOT NULL);"
            )
        from apps.open_doc.document_model.migration import migrate_documents

        with self._connect() as connection:
            migrate_documents(connection)
        if not self.list_documents():
            self.create("Sem título", "")

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _validate(
        self, title: Any, markdown: Any, rich: bool = False
    ) -> tuple[str, str]:
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Informe um título.")
        if len(title) > MAX_TITLE_LENGTH:
            raise ValueError("O título ultrapassa 180 caracteres.")
        if not isinstance(markdown, str):
            raise ValueError("O conteúdo precisa ser texto.")
        if not rich and len(markdown.encode("utf-8")) > MAX_DOCUMENT_BYTES:
            raise ValueError("O documento ultrapassa 5 MB.")
        return title.strip(), markdown

    def _identifier(self, identifier: Any) -> str:
        if not isinstance(identifier, str):
            raise ValueError("Identificador inválido.")
        return str(UUID(identifier))

    def create(self, title: str, markdown: str = "") -> dict[str, Any]:
        """Cria um documento e o torna ativo."""
        title, markdown = self._validate(title, markdown)
        identifier = str(uuid4())
        updated = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO documents (id,title,markdown,revision,updated_at) VALUES (?, ?, ?, ?, ?)",
                (identifier, title, markdown, INITIAL_REVISION, updated),
            )
            connection.execute(
                "INSERT OR REPLACE INTO session VALUES ('active', ?)",
                (identifier,),
            )
        return self.get(identifier)

    def list_documents(self) -> list[dict[str, Any]]:
        """Lista metadados dos documentos por atualização."""
        with self._connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    "SELECT id, title, revision, updated_at FROM documents "
                    "ORDER BY updated_at DESC, id"
                )
            ]

    def get(self, identifier: str) -> dict[str, Any]:
        """Lê um documento pelo UUID, sem aceitar caminhos de arquivos."""
        identifier = self._identifier(identifier)
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM documents WHERE id = ?", (identifier,)
            ).fetchone()
        if row is None:
            raise ValueError("Documento não encontrado.")
        document = dict(row)
        with self._connect() as connection:
            recovery = connection.execute(
                "SELECT * FROM recovery WHERE id = ?", (identifier,)
            ).fetchone()
        document["recovery"] = dict(recovery) if recovery else None
        from apps.open_doc.document_model.serialization import load_document

        for item in (document, document["recovery"]):
            if item and item.get("content_json"):
                item["content"] = load_document(item["content_json"])
        return document

    def stash_recovery(
        self,
        identifier: str,
        title: str,
        markdown: str,
        revision: int,
        content=None,
        content_format="markdown",
    ) -> dict[str, bool]:
        """Mantém uma recuperação persistente independente da origem HTTP."""
        identifier = self._identifier(identifier)
        encoded = self._rich_payload(content, content_format)
        if encoded is not None:
            from apps.open_doc.document_model.serialization import rich_to_markdown

            markdown = rich_to_markdown(content)
        title, markdown = self._validate(title, markdown, rich=encoded is not None)
        with self._lock, self._connect() as connection:
            current = connection.execute(
                "SELECT revision, title, markdown, content_json FROM documents WHERE id = ?",
                (identifier,),
            ).fetchone()
            if current is None or current["revision"] != revision:
                return {"stored": False}
            if (
                current["title"] == title
                and current["markdown"] == markdown
                and current["content_json"] == encoded
            ):
                connection.execute("DELETE FROM recovery WHERE id = ?", (identifier,))
            else:
                connection.execute(
                    "INSERT OR REPLACE INTO recovery (id,title,markdown,revision,content_json,content_format) VALUES (?, ?, ?, ?, ?, ?)",
                    (identifier, title, markdown, revision, encoded, content_format),
                )
        return {"stored": True}

    def discard_recovery(self, identifier: str) -> dict[str, bool]:
        """Descarta uma recuperação somente por ação explícita ou salvamento."""
        identifier = self._identifier(identifier)
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM recovery WHERE id = ?", (identifier,))
        return {"ok": True}

    def current(self) -> dict[str, Any]:
        """Restaura o último documento ativo da sessão."""
        with self._connect() as connection:
            active = connection.execute(
                "SELECT value FROM session WHERE key = 'active'"
            ).fetchone()
        return (
            self.get(active["value"])
            if active
            else self.get(self.list_documents()[0]["id"])
        )

    def select(self, identifier: str) -> dict[str, Any]:
        """Seleciona um documento existente para restaurar na próxima execução."""
        document = self.get(identifier)
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO session VALUES ('active', ?)",
                (document["id"],),
            )
        return document

    def save(
        self,
        identifier: str,
        title: str,
        markdown: str,
        revision: int,
        content=None,
        content_format="markdown",
    ) -> dict[str, Any]:
        """Salva apenas se a revisão lida ainda for a atual.

        Raises:
            RevisionConflict: Quando outra janela salvou uma revisão mais nova.
            ValueError: Quando campos ou identificador são inválidos.
        """
        identifier = self._identifier(identifier)
        if type(revision) is not int or revision < INITIAL_REVISION:
            raise ValueError("Revisão inválida.")
        encoded = self._rich_payload(content, content_format)
        if encoded is not None:
            from apps.open_doc.document_model.serialization import rich_to_markdown

            markdown = rich_to_markdown(content)
        title, markdown = self._validate(title, markdown, rich=encoded is not None)
        updated = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as connection:
            current = connection.execute(
                "SELECT * FROM documents WHERE id=?", (identifier,)
            ).fetchone()
            if current and current["content_format"] != "markdown" and encoded is None:
                raise ValueError("Documento rico exige modelo estruturado.")
            if (
                current
                and current["content_format"] == "markdown"
                and encoded is not None
            ):
                connection.execute(
                    "INSERT OR IGNORE INTO legacy_backups VALUES (?,?)",
                    (identifier, current["markdown"]),
                )
            cursor = connection.execute(
                "UPDATE documents SET title = ?, markdown = ?, "
                "content_json = ?, content_format = ?, revision = revision + 1, updated_at = ? "
                "WHERE id = ? AND revision = ?",
                (
                    title,
                    markdown,
                    encoded,
                    content_format,
                    updated,
                    identifier,
                    revision,
                ),
            )
            if cursor.rowcount != INITIAL_REVISION:
                raise RevisionConflict(
                    "Existe uma revisão mais recente. Salve uma cópia."
                )
            connection.execute("DELETE FROM recovery WHERE id = ?", (identifier,))
            row = connection.execute(
                "SELECT * FROM documents WHERE id = ?", (identifier,)
            ).fetchone()
        return dict(row)

    def import_note(self, source: Path) -> dict[str, Any]:
        """Abre uma cópia de Markdown/TXT sem alterar o arquivo importado."""
        if source.suffix.lower() not in {".md", ".txt"}:
            raise ValueError("A edição suporta Markdown e TXT nesta versão.")
        if source.stat().st_size > MAX_DOCUMENT_BYTES:
            raise ValueError("O documento ultrapassa 5 MB.")
        return self.create(source.stem, source.read_text(encoding="utf-8"))

    def _rich_payload(self, content, content_format):
        if content_format == "markdown":
            if content is not None:
                raise ValueError("Modelo sem formato rico.")
            return None
        if content_format != "opendoc-rich-v1" or content is None:
            raise ValueError("Formato inválido.")
        from apps.open_doc.document_model.serialization import serialize_document

        return serialize_document(content)

    def package_directory(self, identifier):
        return (
            self.config.root / ".veladata" / "packages" / self._identifier(identifier)
        )

    def import_docx(self, source):
        import shutil
        from apps.open_doc.parsers.docx.importer import DocxImporter
        from apps.open_doc.document_model.serialization import (
            serialize_document,
            rich_to_markdown,
        )

        identifier = str(uuid4())
        directory = self.package_directory(identifier)
        directory.mkdir(parents=True, exist_ok=False)
        committed = False
        try:
            model = DocxImporter().import_file(
                source, document_id=identifier, package_directory=directory
            )
            with self._lock, self._connect() as c:
                c.execute(
                    "INSERT INTO documents (id,title,markdown,revision,updated_at,content_format,content_json,source_kind,source_path,source_sha256) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (
                        identifier,
                        source.stem[:180],
                        rich_to_markdown(model),
                        1,
                        datetime.now(timezone.utc).isoformat(),
                        "opendoc-rich-v1",
                        serialize_document(model),
                        "docx",
                        str(source),
                        model["metadata"]["source_sha256"],
                    ),
                )
                c.execute(
                    "INSERT OR REPLACE INTO session VALUES ('active',?)", (identifier,)
                )
            committed = True
            return self.get(identifier)
        except BaseException:
            if not committed:
                shutil.rmtree(directory, ignore_errors=True)
            raise

    def create_rich_copy(self, title, content, source_id=None):
        import shutil
        from apps.open_doc.document_model.serialization import rich_to_markdown

        encoded = self._rich_payload(content, "opendoc-rich-v1")
        title, markdown = self._validate(title, rich_to_markdown(content), rich=True)
        identifier = str(uuid4())
        directory = self.package_directory(identifier)
        committed = False
        try:
            if source_id:
                source = self.package_directory(source_id)
                if source.exists():
                    shutil.copytree(source, directory)
            if content.get("media") and not directory.exists():
                raise ValueError("A cópia exige o pacote original e a mídia.")
            with self._lock, self._connect() as c:
                c.execute(
                    "INSERT INTO documents (id,title,markdown,revision,updated_at,content_format,content_json) VALUES (?,?,?,?,?,?,?)",
                    (
                        identifier,
                        title,
                        markdown,
                        1,
                        datetime.now(timezone.utc).isoformat(),
                        "opendoc-rich-v1",
                        encoded,
                    ),
                )
                c.execute(
                    "INSERT OR REPLACE INTO session VALUES ('active',?)", (identifier,)
                )
            committed = True
            return self.get(identifier)
        except BaseException:
            if not committed and directory.exists():
                shutil.rmtree(directory, ignore_errors=True)
            raise

    def rename(self, identifier, title, revision):
        note = self.get(identifier)
        if note["revision"] != revision:
            raise RevisionConflict(
                "O documento foi alterado. Abra novamente antes de renomear."
            )
        return self.save(
            identifier,
            title,
            note["markdown"],
            revision,
            note.get("content"),
            note["content_format"],
        )

    def delete(self, identifier, revision):
        """Exclui somente o registro interno; arquivos importados são preservados."""
        identifier = self._identifier(identifier)
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM documents WHERE id=? AND revision=?",
                (identifier, revision),
            )
            if cursor.rowcount != 1:
                raise RevisionConflict("O documento foi alterado ou já foi excluído.")
            connection.execute("DELETE FROM recovery WHERE id=?", (identifier,))
            connection.execute("DELETE FROM legacy_backups WHERE id=?", (identifier,))
            connection.execute(
                "DELETE FROM session WHERE key='active' AND value=?", (identifier,)
            )
        # Package snapshots are retained: deleting a record never touches an original.
        return {"deleted": True}

    def duplicate(self, identifier):
        note = self.get(identifier)
        if note.get("content"):
            return self.create_rich_copy(
                note["title"][:170] + " (cópia)", note["content"], identifier
            )
        return self.create(note["title"][:170] + " (cópia)", note["markdown"])

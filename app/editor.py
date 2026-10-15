"""
Módulo: editor.py.
Responsabilidade: persistir documentos e sessões com controle de revisões.
Autor: Vela Writer Contributors
Criado em: 2026
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import UUID, uuid4

from app.config import Config

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
        self.path = config.root / ".veladata" / "writer.sqlite3"
        self._lock = RLock()
        with self._connect() as connection:
            connection.executescript(
                "CREATE TABLE IF NOT EXISTS documents ("
                "id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL,"
                "revision INTEGER NOT NULL, updated_at TEXT NOT NULL);"
                "CREATE TABLE IF NOT EXISTS session ("
                "key TEXT PRIMARY KEY, value TEXT NOT NULL);"
            )
        if not self.list_documents():
            self.create("Sem título", "")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _validate(self, title: Any, markdown: Any) -> tuple[str, str]:
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Informe um título.")
        if len(title) > MAX_TITLE_LENGTH:
            raise ValueError("O título ultrapassa 180 caracteres.")
        if not isinstance(markdown, str):
            raise ValueError("O conteúdo precisa ser texto.")
        if len(markdown.encode("utf-8")) > MAX_DOCUMENT_BYTES:
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
                "INSERT INTO documents VALUES (?, ?, ?, ?, ?)",
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
                dict(row) for row in connection.execute(
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
        return dict(row)

    def current(self) -> dict[str, Any]:
        """Restaura o último documento ativo da sessão."""
        with self._connect() as connection:
            active = connection.execute(
                "SELECT value FROM session WHERE key = 'active'"
            ).fetchone()
        return self.get(active["value"]) if active else self.get(
            self.list_documents()[0]["id"]
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
        self, identifier: str, title: str, markdown: str, revision: int
    ) -> dict[str, Any]:
        """Salva apenas se a revisão lida ainda for a atual.

        Raises:
            RevisionConflict: Quando outra janela salvou uma revisão mais nova.
            ValueError: Quando campos ou identificador são inválidos.
        """
        identifier = self._identifier(identifier)
        title, markdown = self._validate(title, markdown)
        if type(revision) is not int or revision < INITIAL_REVISION:
            raise ValueError("Revisão inválida.")
        updated = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE documents SET title = ?, markdown = ?, "
                "revision = revision + 1, updated_at = ? "
                "WHERE id = ? AND revision = ?",
                (title, markdown, updated, identifier, revision),
            )
            if cursor.rowcount != INITIAL_REVISION:
                raise RevisionConflict(
                    "Existe uma revisão mais recente. Salve uma cópia."
                )
            row = connection.execute(
                "SELECT * FROM documents WHERE id = ?", (identifier,)
            ).fetchone()
        return dict(row)

    def import_note(self, source: Path) -> dict[str, Any]:
        """Abre uma cópia de Markdown/TXT sem alterar o arquivo importado."""
        if source.suffix.lower() not in {".md", ".txt"}:
            raise ValueError("A edição suporta Markdown e TXT nesta fase.")
        if source.stat().st_size > MAX_DOCUMENT_BYTES:
            raise ValueError("O documento ultrapassa 5 MB.")
        return self.create(source.stem, source.read_text(encoding="utf-8"))

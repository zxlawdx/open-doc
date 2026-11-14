"""Transactional document snapshots backed by the workspace database."""

import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4


class VersionHistory:
    def initialize(self, connection):
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS version_payloads (
                hash TEXT PRIMARY KEY, payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS document_versions (
                sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
                document_id TEXT NOT NULL, parent_id TEXT, hash TEXT NOT NULL,
                name TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS version_document_sequence
                ON document_versions(document_id, sequence);
        """)

    @staticmethod
    def fields(row):
        return {
            "title": row["title"],
            "content_json": row["content_json"],
            "markdown": row["markdown"] if "markdown" in row.keys() else None,
            "content_format": (
                row["content_format"]
                if "content_format" in row.keys()
                else "opendoc-fixed-v1"
            ),
            "source_sha256": row["source_sha256"],
        }

    @staticmethod
    def _hash(payload):
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def capture(self, connection, row, reason, name=None):
        return self.append(connection, row["id"], self.fields(row), reason, name)

    def append(self, connection, document_id, fields, reason, name=None):
        payload = json.dumps(fields, sort_keys=True, ensure_ascii=False)
        digest = self._hash(payload)
        latest = connection.execute(
            "SELECT id, hash FROM document_versions WHERE document_id=? "
            "ORDER BY sequence DESC LIMIT 1",
            (document_id,),
        ).fetchone()
        if latest and latest["hash"] == digest and reason == "automatic":
            return latest["id"]
        identifier = str(uuid4())
        connection.execute(
            "INSERT OR IGNORE INTO version_payloads VALUES (?, ?)", (digest, payload)
        )
        connection.execute(
            "INSERT INTO document_versions "
            "(id, document_id, parent_id, hash, name, reason, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                identifier,
                document_id,
                latest["id"] if latest else None,
                digest,
                name,
                reason,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        return identifier

    def ensure_baseline(self, connection, row):
        exists = connection.execute(
            "SELECT 1 FROM document_versions WHERE document_id=? LIMIT 1", (row["id"],)
        ).fetchone()
        if not exists:
            self.capture(connection, row, "automatic")

    def list(self, connection, document_id):
        return [
            dict(row)
            for row in connection.execute(
                "SELECT id, parent_id, hash, name, reason, created_at "
                "FROM document_versions WHERE document_id=? ORDER BY sequence DESC",
                (document_id,),
            )
        ]

    def read(self, connection, document_id, version_id):
        row = connection.execute(
            "SELECT v.hash, p.payload FROM document_versions v "
            "LEFT JOIN version_payloads p ON p.hash=v.hash "
            "WHERE v.document_id=? AND v.id=?",
            (document_id, version_id),
        ).fetchone()
        if row is None:
            raise ValueError("Versão não encontrada neste documento.")
        if row["payload"] is None or self._hash(row["payload"]) != row["hash"]:
            raise ValueError("A versão falhou na verificação de integridade.")
        return json.loads(row["payload"])

    def rename(self, connection, document_id, version_id, name):
        cursor = connection.execute(
            "UPDATE document_versions SET name=? WHERE document_id=? AND id=?",
            (name, document_id, version_id),
        )
        if cursor.rowcount != 1:
            raise ValueError("Versão não encontrada neste documento.")

    def delete(self, connection, document_id, version_id):
        latest = self.list(connection, document_id)
        if not latest or latest[0]["id"] != version_id:
            raise ValueError("Só é possível excluir a versão mais recente.")
        connection.execute("DELETE FROM document_versions WHERE id=?", (version_id,))
        connection.execute(
            "DELETE FROM version_payloads WHERE hash=? AND NOT EXISTS "
            "(SELECT 1 FROM document_versions WHERE hash=?)",
            (latest[0]["hash"], latest[0]["hash"]),
        )

"""Workbook persistence using the shared workspace and revision history."""

import json
from datetime import datetime, timezone
from uuid import uuid4

from apps.open_doc.services.document_service import RevisionConflict

ROWS = 10000
COLUMNS = 100
MAX_CELLS = 50000
FORMAT = "opendoc-workbook-v1"


def empty_sheet(name="Planilha1"):
    return {"name": name, "cells": {}, "bold": []}


def validate(sheets):
    if not isinstance(sheets, list) or not 1 <= len(sheets) <= 20:
        raise ValueError("A pasta deve ter entre 1 e 20 abas.")
    names = set()
    count = 0
    for sheet in sheets:
        if not isinstance(sheet, dict) or set(sheet) != {"name", "cells", "bold"}:
            raise ValueError("Aba inválida.")
        name, cells, bold = sheet["name"], sheet["cells"], sheet["bold"]
        if (not isinstance(name, str) or not name.strip() or len(name) > 31
                or any(char in name for char in '[]:*?/\\') or name.startswith("'")
                or name.endswith("'") or name.casefold() in names):
            raise ValueError("Use nomes únicos e válidos de até 31 caracteres para as abas.")
        names.add(name.casefold())
        if not isinstance(cells, dict) or not isinstance(bold, list):
            raise ValueError("Células inválidas.")
        count += len(cells) + len(bold)
        if count > MAX_CELLS:
            raise ValueError("Limite de 50 mil valores e estilos por pasta.")
        for key in (*cells, *bold):
            if not isinstance(key, str) or len(key) > 8:
                raise ValueError("Endereço inválido.")
            parts = key.split(",")
            if len(parts) != 2 or not all(part.isascii() and part.isdecimal() for part in parts):
                raise ValueError("Endereço inválido.")
            row, col = map(int, parts)
            if not (0 <= row < ROWS and 0 <= col < COLUMNS) or key != f"{row},{col}":
                raise ValueError("Endereço fora dos limites da planilha.")
        if any(not isinstance(value, str) or len(value) > 8192 for value in cells.values()):
            raise ValueError("Célula inválida ou acima de 8.192 caracteres.")
    data = json.dumps(sheets, ensure_ascii=False, separators=(",", ":"))
    if len(data.encode("utf-8")) > 5 * 1024 * 1024:
        raise ValueError("A pasta ultrapassa 5 MB.")
    return data


class Workbooks:
    def __init__(self, editor):
        self.editor = editor
        with editor._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS workbooks (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL,
                updated_at TEXT NOT NULL, content_json TEXT NOT NULL,
                content_format TEXT NOT NULL, source_sha256 TEXT, imported INTEGER NOT NULL
            )""")

    @staticmethod
    def _get(db, identifier):
        row = db.execute("SELECT * FROM workbooks WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise ValueError("Planilha não encontrada.")
        return row

    @staticmethod
    def _snapshot(row):
        return {key: row[key] for key in ("id", "title", "revision", "updated_at")} | {
            "source_kind": "xlsx", "sheets": json.loads(row["content_json"])
        }

    def list(self):
        with self.editor._connect() as db:
            return [dict(row) | {"source_kind": "xlsx"} for row in db.execute(
                "SELECT id,title,revision,updated_at,imported FROM workbooks"
            )]

    def get(self, identifier):
        with self.editor._connect() as db:
            return self._snapshot(self._get(db, self.editor._identifier(identifier)))

    def create(self, title="Nova planilha", sheets=None, *, imported=False):
        title, _ = self.editor._validate(title, "")
        data = validate([empty_sheet()] if sheets is None else sheets)
        identifier = str(uuid4())
        with self.editor._lock, self.editor._connect() as db:
            db.execute("INSERT INTO workbooks VALUES (?,?,1,?,?,?,NULL,?)",
                       (identifier, title, datetime.now(timezone.utc).isoformat(), data, FORMAT, imported))
            row = self._get(db, identifier)
            self.editor.history.capture(db, row, "automatic")
            return self._snapshot(row)

    def save(self, identifier, revision, title, sheets, *, restore=None):
        identifier = self.editor._identifier(identifier)
        with self.editor._lock, self.editor._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._get(db, identifier)
            if type(revision) is not int or row["revision"] != revision:
                raise RevisionConflict("A planilha foi alterada em outra janela.")
            if restore is not None:
                old = self.editor.history.read(db, identifier, restore)
                title, sheets = old["title"], json.loads(old["content_json"])
            title, _ = self.editor._validate(title, "")
            data = validate(sheets)
            if title == row["title"] and data == row["content_json"]:
                return self._snapshot(row)
            db.execute("UPDATE workbooks SET title=?, content_json=?, revision=revision+1, updated_at=? WHERE id=?",
                       (title, data, datetime.now(timezone.utc).isoformat(), identifier))
            saved = self._get(db, identifier)
            self.editor.history.capture(db, saved, "restored" if restore is not None else "automatic")
            return self._snapshot(saved)

    def versions(self, identifier):
        identifier = self.editor._identifier(identifier)
        with self.editor._connect() as db:
            self._get(db, identifier)
            return self.editor.history.list(db, identifier)

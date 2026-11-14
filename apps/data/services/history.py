"""Durable transactional dataset edit/type history.

Entries contain bounded per-cell deltas rather than copies of million-row datasets.
The history lives in the same SQLite transaction as the edit, survives relaunches,
and supports undo/redo across value edits, type changes and confirmed conversions.
"""
import json

MAX_HISTORY = 100


def initialize(db):
    db.execute("""CREATE TABLE IF NOT EXISTS dataset_edit_history(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset_id TEXT NOT NULL REFERENCES datasets(id),
        operation TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        undone INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    db.execute("""CREATE INDEX IF NOT EXISTS dataset_history_recent
                  ON dataset_edit_history(dataset_id, undone, id)""")


def remember(db, identifier, operation, before, after):
    if before == after:
        return False
    db.execute("DELETE FROM dataset_edit_history WHERE dataset_id=? AND undone=1", (identifier,))
    db.execute(
        "INSERT INTO dataset_edit_history(dataset_id,operation,before_json,after_json) VALUES(?,?,?,?)",
        (identifier, operation,
         json.dumps(before, ensure_ascii=False, separators=(",", ":")),
         json.dumps(after, ensure_ascii=False, separators=(",", ":"))),
    )
    db.execute(
        "DELETE FROM dataset_edit_history WHERE dataset_id=? AND id NOT IN "
        "(SELECT id FROM dataset_edit_history WHERE dataset_id=? ORDER BY id DESC LIMIT ?)",
        (identifier, identifier, MAX_HISTORY),
    )
    return True


def apply_patch(db, identifier, patch):
    """Apply only stored changes and never replace unrelated rows or cell overrides."""
    values = patch.get("values", [])
    types = patch.get("types", [])
    if not isinstance(values, list) or not isinstance(types, list):
        raise ValueError("Histórico inválido.")
    by_row = {}
    for row, column, value in values:
        by_row.setdefault(row, []).append((column, value))
    for row, changes in by_row.items():
        original = db.execute(
            "SELECT values_json FROM dataset_rows WHERE dataset_id=? AND number=?",
            (identifier, row),
        ).fetchone()
        if original is None:
            raise ValueError("Linha do histórico não encontrada.")
        cells = json.loads(original[0])
        for column, value in changes:
            if not isinstance(value, str) or not 0 <= column < len(cells):
                raise ValueError("Célula do histórico inválida.")
            cells[column] = value
        db.execute(
            "UPDATE dataset_rows SET values_json=? WHERE dataset_id=? AND number=?",
            (json.dumps(cells, ensure_ascii=False, separators=(",", ":")), identifier, row),
        )
    for scope, row, column, kind in types:
        if kind is None:
            db.execute(
                "DELETE FROM dataset_field_types WHERE dataset_id=? AND scope=? "
                "AND row_number=? AND column_number=?",
                (identifier, scope, row, column),
            )
        else:
            db.execute(
                "INSERT OR REPLACE INTO dataset_field_types"
                "(dataset_id,scope,row_number,column_number,kind) VALUES(?,?,?,?,?)",
                (identifier, scope, row, column, kind),
            )


def traverse(db, identifier, redo=False):
    chosen = db.execute(
        "SELECT id, operation, before_json, after_json FROM dataset_edit_history "
        "WHERE dataset_id=? AND undone=? ORDER BY id "
        + ("ASC LIMIT 1" if redo else "DESC LIMIT 1"),
        (identifier, 1 if redo else 0),
    ).fetchone()
    if chosen is None:
        return {"changed": False, "message": "Nada para refazer." if redo else "Nada para desfazer."}
    patch = json.loads(chosen["after_json" if redo else "before_json"])
    apply_patch(db, identifier, patch)
    db.execute(
        "UPDATE dataset_edit_history SET undone=? WHERE id=? AND dataset_id=?",
        (0 if redo else 1, chosen["id"], identifier),
    )
    return {"changed": True, "operation": chosen["operation"],
            "direction": "redo" if redo else "undo", "version": chosen["id"]}


def list_history(db, identifier, limit=25):
    rows = db.execute(
        "SELECT id, operation, undone, created_at FROM dataset_edit_history "
        "WHERE dataset_id=? ORDER BY id DESC LIMIT ?",
        (identifier, min(100, max(1, int(limit)))),
    )
    return [dict(row) for row in rows]

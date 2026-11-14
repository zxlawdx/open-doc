"""Additive and idempotent; original Markdown is retained for rollback."""


def migrate_documents(connection):
    additions = {
        "content_format": "TEXT NOT NULL DEFAULT 'markdown'",
        "content_json": "TEXT",
        "source_kind": "TEXT NOT NULL DEFAULT 'native'",
        "source_path": "TEXT",
        "source_sha256": "TEXT",
    }
    for table in ("documents", "recovery"):
        columns = {
            r["name"] for r in connection.execute("PRAGMA table_info(" + table + ")")
        }
        for name, decl in additions.items():
            if name not in columns:
                connection.execute(
                    "ALTER TABLE " + table + " ADD COLUMN " + name + " " + decl
                )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS legacy_backups (id TEXT PRIMARY KEY, markdown TEXT NOT NULL)"
    )

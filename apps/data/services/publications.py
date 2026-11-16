"""Transactional adoption of versioned resources into the virtualized table."""

import csv
import json

from shared.contracts.errors import RevisionConflict
from . import history


class DatasetPublications:
    def __init__(self, store, resources):
        self.store, self.resources = store, resources
        store._apply_resource = self.apply
        with store.connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS dataset_resource_bindings (dataset_id TEXT PRIMARY KEY, token_json TEXT NOT NULL, resource_id TEXT NOT NULL, revision INTEGER NOT NULL)"
            )

    def token(self, identifier, db=None):
        if db is None:
            with self.store.connect() as connection:
                return self.token(identifier, connection)
        dataset = self.store.get(db, identifier)
        row = db.execute(
            "SELECT COALESCE(MAX(id),0),COALESCE(SUM(undone),0) FROM dataset_edit_history WHERE dataset_id=?",
            (identifier,),
        ).fetchone()
        return [dataset["row_count"], row[0], row[1]]

    def bound_resource(self, identifier):
        with self.store.connect() as db:
            row = db.execute(
                "SELECT token_json,resource_id,revision FROM dataset_resource_bindings WHERE dataset_id=?",
                (identifier,),
            ).fetchone()
            if row is not None and json.loads(row[0]) == self.token(identifier, db):
                return self.resources.snapshot(row[1], row[2]).to_dict()
        return None

    def bind_resource(self, identifier, handle, expected_token):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if self.token(identifier, db) != expected_token:
                raise RevisionConflict(
                    "A tabela mudou durante a preparação do recurso."
                )
            db.execute(
                "INSERT OR REPLACE INTO dataset_resource_bindings VALUES(?,?,?,?)",
                (
                    identifier,
                    json.dumps(expected_token),
                    handle["resource_id"],
                    handle["revision"],
                ),
            )
        self.resources.replace_pins("dataset_binding_" + identifier, [handle])

    def apply(self, db, identifier, patch):
        handle = patch["resource"]
        snapshot = self.resources.snapshot(handle["resource_id"], handle["revision"])
        path = self.resources.open_path(snapshot.resource_id, snapshot.revision)
        if snapshot.media_type == "text/csv":
            with path.open(encoding="utf-8", newline="") as stream:
                reader = csv.reader(stream)
                columns = next(reader)
                self._replace(db, identifier, columns, reader)
            profile = patch.get("import_schema")
        else:
            import pyarrow.parquet as pq
            from .inference import from_arrow
            from datetime import date, datetime
            from decimal import Decimal

            with pq.ParquetFile(path) as parquet:
                columns = parquet.schema_arrow.names
                profile = patch.get("import_schema") or from_arrow(parquet.schema_arrow)

                def rows():
                    for batch in parquet.iter_batches(batch_size=1000):
                        values = batch.to_pydict()
                        for index in range(batch.num_rows):
                            yield [
                                (values[name][index].isoformat() if isinstance(values[name][index],(date,datetime))
                                 else float(values[name][index]) if isinstance(values[name][index],Decimal)
                                 else values[name][index])
                                for name in columns
                            ]

                self._replace(db, identifier, columns, rows())
        db.execute("DELETE FROM dataset_import_schema WHERE dataset_id=?",(identifier,))
        if profile is not None:
            db.execute("INSERT INTO dataset_import_schema VALUES (?,?,?)",(identifier,json.dumps(profile["schema"]),json.dumps(profile["options"])))

    def _replace(self, db, identifier, columns, rows):
        if (
            not columns
            or any(not isinstance(name, str) or not name.strip() for name in columns)
            or len(set(columns)) != len(columns)
        ):
            raise ValueError("DataFrame precisa de colunas únicas e preenchidas.")
        db.execute("DELETE FROM dataset_rows WHERE dataset_id=?", (identifier,))
        batch, count = [], 0
        for values in rows:
            count += 1
            if len(values) != len(columns):
                raise ValueError("Esquema da transformação inválido.")
            batch.append(
                (
                    identifier,
                    count,
                    json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
                )
            )
            if len(batch) >= 1000:
                db.executemany("INSERT INTO dataset_rows VALUES(?,?,?)", batch)
                batch.clear()
        db.executemany("INSERT INTO dataset_rows VALUES(?,?,?)", batch)
        db.execute(
            "UPDATE datasets SET columns_json=?, row_count=? WHERE id=?",
            (json.dumps(columns, ensure_ascii=False), count, identifier),
        )
        db.execute("DELETE FROM dataset_field_types WHERE dataset_id=?", (identifier,))
        # Restore type metadata without putting the whole table in a JSON patch.

    def adopt(self, identifier, before, after, expected_token):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if self.token(identifier, db) != expected_token:
                raise RevisionConflict(
                    "A tabela mudou desde a abertura do notebook. Recarregue o DataFrame antes de publicar."
                )
            types = [
                list(row)
                for row in db.execute(
                    "SELECT scope,row_number,column_number,kind FROM dataset_field_types WHERE dataset_id=?",
                    (identifier,),
                )
            ]
            before_profile = self.store.import_schema(identifier,db)
            self.apply(db, identifier, {"resource": after})
            history.remember(
                db,
                identifier,
                "resource-publication",
                {"resource": before, "field_types": types, "import_schema":before_profile},
                {"resource": after, "field_types": [], "import_schema":self.store.import_schema(identifier,db)},
            )
            adopted_token = self.token(identifier, db)
            db.execute(
                "INSERT OR REPLACE INTO dataset_resource_bindings VALUES(?,?,?,?)",
                (
                    identifier,
                    json.dumps(adopted_token),
                    after["resource_id"],
                    after["revision"],
                ),
            )
        with self.store.connect() as db:
            handles = []
            for row in db.execute(
                "SELECT before_json,after_json FROM dataset_edit_history WHERE operation='resource-publication'"
            ):
                for payload in row:
                    handle = json.loads(payload).get("resource")
                    if handle:
                        handles.append(handle)
        self.resources.replace_pins("dataset_history", handles)
        self.resources.replace_pins("dataset_binding_" + identifier, [after])
        return {"id": identifier, "resource": after, "token": adopted_token}

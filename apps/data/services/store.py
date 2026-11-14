"""Disk-backed, append-only tables for delimited files."""

import csv
import json
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import uuid4

BATCH_SIZE = 1000
from shared.utils.tabular import ENCODINGS, DELIMITERS, delimited, typed_value


def preview(value):
    return value if len(value) <= 512 else value[:512] + "…"


class Datasets:
    def __init__(self, root):
        self.path = root / ".veladata" / "datasets.sqlite3"

    @contextmanager
    def connect(self):
        with closing(sqlite3.connect(self.path, timeout=10)) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            with db:
                yield db

    def initialize(self):
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS datasets (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL,
                    columns_json TEXT NOT NULL, row_count INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sources (
                    id INTEGER PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES datasets(id),
                    filename TEXT NOT NULL, first_row INTEGER NOT NULL, row_count INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS dataset_rows (
                    dataset_id TEXT NOT NULL REFERENCES datasets(id), number INTEGER NOT NULL,
                    values_json TEXT NOT NULL, PRIMARY KEY(dataset_id, number)
                ) WITHOUT ROWID;
                CREATE TABLE IF NOT EXISTS dataset_field_types (
                    dataset_id TEXT NOT NULL REFERENCES datasets(id),
                    scope TEXT NOT NULL, row_number INTEGER NOT NULL, column_number INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    PRIMARY KEY(dataset_id,scope,row_number,column_number)
                ) WITHOUT ROWID;
            """)
            from . import history
            history.initialize(db)

    @staticmethod
    def get(db, identifier):
        row = db.execute("SELECT * FROM datasets WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise ValueError("Dataset não encontrado.")
        return row

    def list(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT id,title,row_count FROM datasets ORDER BY rowid DESC"
            )]

    def import_files(self, paths, identifier=None, *, encoding="utf-8-sig", delimiter="auto"):
        paths = list(map(Path, paths))
        if not paths or any(path.suffix.lower() not in (".csv", ".tsv") for path in paths):
            raise ValueError("Selecione arquivos CSV ou TSV.")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if identifier is None:
                identifier = str(uuid4())
                columns, count = None, 0
            else:
                dataset = self.get(db, identifier)
                columns, count = json.loads(dataset["columns_json"]), dataset["row_count"]
            initial = count
            for path in paths:
                try:
                    with delimited(path, encoding, delimiter) as (header, reader):
                        if columns is None:
                            columns = header
                            db.execute("INSERT INTO datasets VALUES (?,?,?,0)", (
                                identifier, path.stem, json.dumps(columns, ensure_ascii=False)
                            ))
                        if set(header) != set(columns):
                            raise ValueError(f"{path.name}: as colunas não correspondem ao dataset.")
                        indexes = {name: index for index, name in enumerate(header)}
                        order = [indexes[name] for name in columns]
                        first, batch, buffered = count, [], 0
                        for row in reader:
                            if not row:
                                continue
                            if len(row) != len(columns):
                                raise ValueError(f"{path.name}: registro até a linha {reader.line_num} tem {len(row)} campos; esperado {len(columns)}.")
                            count += 1
                            values = json.dumps(
                                [row[index] for index in order], ensure_ascii=False, separators=(",", ":")
                            )
                            batch.append((identifier, count, values))
                            buffered += len(values)
                            if len(batch) >= BATCH_SIZE or buffered >= 1024 * 1024:
                                db.executemany("INSERT INTO dataset_rows VALUES (?,?,?)", batch)
                                batch.clear()
                                buffered = 0
                        db.executemany("INSERT INTO dataset_rows VALUES (?,?,?)", batch)
                        db.execute(
                            "INSERT INTO sources(dataset_id,filename,first_row,row_count) VALUES (?,?,?,?)",
                            (identifier, path.name, first + 1, count - first),
                        )
                except UnicodeError as error:
                    raise ValueError(f"{path.name}: arquivo incompatível com a codificação selecionada.") from error
                except csv.Error as error:
                    raise ValueError(f"{path.name}: CSV inválido ({error}).") from error
            db.execute("UPDATE datasets SET row_count=? WHERE id=?", (count, identifier))
            return {"id": identifier, "added": count - initial, "row_count": count}

    def page(self, identifier, row, column):
        if type(row) is not int or type(column) is not int or not (0 <= row < 2**63-1 and 0 <= column < 2**63-1):
            raise ValueError("Posição inválida.")
        with self.connect() as db:
            db.execute("BEGIN")
            dataset = self.get(db, identifier)
            names = json.loads(dataset["columns_json"])
            if row >= max(1, dataset["row_count"]) or column >= len(names):
                raise ValueError("Posição fora do dataset.")
            columns = names[column:column + 12]
            records = db.execute(
                "SELECT values_json FROM dataset_rows WHERE dataset_id=? AND number>? ORDER BY number LIMIT 50",
                (identifier, row),
            ).fetchall()
            column_types, cell_types = {}, {}
            for entry in db.execute(
                "SELECT scope,row_number,column_number,kind FROM dataset_field_types "
                "WHERE dataset_id=? AND column_number>=? AND column_number<? "
                "AND (scope='column' OR (row_number>? AND row_number<=?))",
                (identifier, column, column + len(columns), row, row + len(records)),
            ):
                if entry["scope"] == "column":
                    column_types[str(entry["column_number"])] = entry["kind"]
                else:
                    cell_types[f'{entry["row_number"]},{entry["column_number"]}'] = entry["kind"]
            return {
                "id": identifier, "title": dataset["title"], "row_count": dataset["row_count"],
                "column_count": len(names), "columns": [preview(name) for name in columns],
                "rows": [[preview(value) for value in json.loads(item[0])[column:column + len(columns)]]
                         for item in records],
                "types": {"columns": column_types, "cells": cell_types},
                "source_count": db.execute(
                    "SELECT COUNT(*) FROM sources WHERE dataset_id=?", (identifier,)
                ).fetchone()[0],
            }

    def cell(self, identifier, row, column, *, for_query=False):
        """Fetch the untruncated raw cell for in-grid editing."""
        if type(row) is not int or type(column) is not int or row < 1 or column < 0:
            raise ValueError("Endereço inválido.")
        with self.connect() as db:
            dataset = self.get(db, identifier)
            if row > dataset["row_count"] or column >= len(json.loads(dataset["columns_json"])):
                raise ValueError("Célula fora do dataset.")
            result = db.execute(
                "SELECT values_json FROM dataset_rows WHERE dataset_id=? AND number=?",
                (identifier, row),
            ).fetchone()
            if result is None:
                raise ValueError("Linha não encontrada.")
            value = json.loads(result["values_json"])[column]
            if for_query:
                kind = db.execute(
                    "SELECT kind FROM dataset_field_types WHERE dataset_id=? AND column_number=? "
                    "AND (scope='column' OR (scope='cell' AND row_number=?)) ORDER BY scope LIMIT 1",
                    (identifier, column, row),
                ).fetchone()
                value = typed_value(value, kind["kind"] if kind else "auto")
                if isinstance(value, str):
                    # A text literal with NUL must use a blob cast because SQL
                    # source strings cannot contain literal NUL characters.
                    literal = ("CAST(X'" + value.encode().hex() + "' AS TEXT)" if "\x00" in value
                               else "'" + value.replace("'", "''") + "'")
                else:
                    literal = "NULL" if value is None else repr(value)
                if len(literal) > 11000:
                    raise ValueError("Valor longo demais para a consulta de filtro.")
                return {"literal": literal}
            return {"row": row, "column": column, "value": value}

    def edit_cell(self, identifier, row, column, value):
        """Atomically edit one stored data cell without rewriting a large CSV."""
        if (type(row) is not int or type(column) is not int or
                not isinstance(value, str) or len(value) > 8192 or row < 1 or column < 0):
            raise ValueError("Célula ou valor inválido.")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            dataset = self.get(db, identifier)
            names = json.loads(dataset["columns_json"])
            if row > dataset["row_count"] or column >= len(names):
                raise ValueError("Célula fora do dataset.")
            record = db.execute(
                "SELECT values_json FROM dataset_rows WHERE dataset_id=? AND number=?",
                (identifier, row),
            ).fetchone()
            if record is None:
                raise ValueError("Linha não encontrada.")
            cells = json.loads(record["values_json"])
            previous = cells[column]
            cells[column] = value
            db.execute(
                "UPDATE dataset_rows SET values_json=? WHERE dataset_id=? AND number=?",
                (json.dumps(cells, ensure_ascii=False, separators=(",", ":")), identifier, row),
            )
            from . import history
            history.remember(
                db, identifier, "edit", {"values": [[row, column, previous]]},
                {"values": [[row, column, value]]},
            )
            return {"row": row, "column": column, "previous": previous, "value": value}

    def set_type(self, identifier, scope, column, kind, row=None, last_row=None, last_column=None):
        """Store non-destructive column/cell type overrides; raw values remain intact."""
        allowed = {"auto", "text", "integer", "decimal", "currency", "percent",
                   "date", "time", "datetime", "boolean"}
        if (scope not in {"column", "cell", "selection"} or kind not in allowed or
                type(column) is not int or column < 0):
            raise ValueError("Tipo, coluna ou escopo inválido.")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            dataset = self.get(db, identifier)
            names = json.loads(dataset["columns_json"])
            if column >= len(names):
                raise ValueError("Coluna fora do dataset.")
            if scope == "column":
                positions = [(0, column)]
            else:
                if type(row) is not int or not 1 <= row <= dataset["row_count"]:
                    raise ValueError("Linha fora do dataset.")
                if scope == "cell":
                    positions = [(row, column)]
                else:
                    if (type(last_row) is not int or type(last_column) is not int or
                            not row <= last_row <= dataset["row_count"] or
                            not column <= last_column < len(names) or
                            (last_row-row+1)*(last_column-column+1) > 50000):
                        raise ValueError("Seleção inválida ou maior que 50 mil células.")
                    positions = [(r, c) for r in range(row, last_row+1)
                                 for c in range(column, last_column+1)]
            storage_scope = "column" if scope == "column" else "cell"
            previous = {}
            for entry in db.execute(
                    "SELECT row_number,column_number,kind FROM dataset_field_types "
                    "WHERE dataset_id=? AND scope=? AND column_number>=? AND column_number<=?",
                    (identifier, storage_scope, column,
                     last_column if scope == "selection" else column)):
                previous[(entry["row_number"], entry["column_number"])] = entry["kind"]
            before_types = [
                [storage_scope, r, c, previous.get((r, c))] for r, c in positions
            ]
            new_kind = None if kind == "auto" and storage_scope == "column" else kind
            after_types = [[storage_scope, r, c, new_kind] for r, c in positions]
            if kind == "auto" and storage_scope == "column":
                db.executemany(
                    "DELETE FROM dataset_field_types WHERE dataset_id=? AND scope=? AND row_number=? AND column_number=?",
                    ((identifier, storage_scope, r, c) for r, c in positions),
                )
            else:
                db.executemany(
                    "INSERT OR REPLACE INTO dataset_field_types "
                    "(dataset_id,scope,row_number,column_number,kind) VALUES (?,?,?,?,?)",
                    ((identifier, storage_scope, r, c, kind) for r, c in positions),
                )
            from . import history
            history.remember(db, identifier, "type",
                             {"types": before_types}, {"types": after_types})
            return {"updated": len(positions), "scope": scope, "kind": kind}

    def conversion_preview(self, identifier, scope, column, kind, row=None,
                           last_row=None, last_column=None):
        """Read-only, bounded sample and full mismatch counts; no mutation."""
        from . import conversion
        with self.connect() as db:
            db.execute("BEGIN")
            dataset = self.get(db, identifier)
            report = conversion.plan(db, dataset, scope, column, kind,
                                     row, last_row, last_column)
            return {key: value for key, value in report.items() if key != "changes"}

    def conversion_commit(self, identifier, scope, column, kind, token, row=None,
                          last_row=None, last_column=None, *, on_invalid="abort", confirm=False):
        """Explicit user-confirmed, stale-data-checked conversion + type in one transaction."""
        if confirm is not True or on_invalid not in {"abort", "keep"} or not (
                isinstance(token, str) and len(token) == 64):
            raise ValueError("A conversão exige prévia e confirmação explícita.")
        from . import conversion, history
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            dataset = self.get(db, identifier)
            report = conversion.plan(db, dataset, scope, column, kind,
                                     row, last_row, last_column)
            if report["token"] != token:
                raise ValueError("Os dados mudaram desde a prévia. Refaça a análise.")
            if report["invalid"] and on_invalid == "abort":
                raise ValueError(
                    f"Há {report['invalid']} valores incompatíveis. Corrija-os ou escolha preservá-los."
                )
            changes = report["changes"]
            before_values = [[r, c, old] for r, c, old, new in changes]
            after_values = [[r, c, new] for r, c, old, new in changes]
            for r, c, old, new in changes:
                record = db.execute(
                    "SELECT values_json FROM dataset_rows WHERE dataset_id=? AND number=?",
                    (identifier, r),
                ).fetchone()
                if record is None:
                    raise ValueError("A origem mudou durante a conversão.")
                values = json.loads(record[0])
                if values[c] != old:
                    raise ValueError("Valor da origem modificado. Refaça a prévia.")
                values[c] = new
                db.execute(
                    "UPDATE dataset_rows SET values_json=? WHERE dataset_id=? AND number=?",
                    (json.dumps(values, ensure_ascii=False, separators=(",", ":")), identifier, r),
                )
            r0, r1, c0, c1 = report["region"]
            if scope == "column":
                positions = [("column", 0, column)]
            else:
                positions = [
                    ("cell", r, c) for r in range(r0, r1+1)
                    for c in range(c0, c1+1)
                ]
            types_before, types_after = [], []
            # Retain all explicit cell exceptions in column scope.
            for target_scope, r, c in positions:
                existing = db.execute(
                    "SELECT kind FROM dataset_field_types WHERE dataset_id=? "
                    "AND scope=? AND row_number=? AND column_number=?",
                    (identifier, target_scope, r, c),
                ).fetchone()
                old_kind = existing[0] if existing else None
                new_kind = None if kind == "auto" and target_scope == "column" else kind
                types_before.append([target_scope, r, c, old_kind])
                types_after.append([target_scope, r, c, new_kind])
                if new_kind is None:
                    db.execute(
                        "DELETE FROM dataset_field_types WHERE dataset_id=? AND scope=? "
                        "AND row_number=? AND column_number=?",
                        (identifier, target_scope, r, c),
                    )
                else:
                    db.execute(
                        "INSERT OR REPLACE INTO dataset_field_types "
                        "(dataset_id,scope,row_number,column_number,kind) VALUES(?,?,?,?,?)",
                        (identifier, target_scope, r, c, new_kind),
                    )
            history.remember(
                db, identifier, "conversion",
                {"values": before_values, "types": types_before},
                {"values": after_values, "types": types_after},
            )
            return {"converted": len(changes), "invalid": report["invalid"],
                    "exceptions": report["exceptions"], "kind": kind}

    def undo(self, identifier, redo=False):
        if type(redo) is not bool:
            raise ValueError("Operação de histórico inválida.")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.get(db, identifier)
            from . import history
            return history.traverse(db, identifier, redo)

    def history(self, identifier, limit=25):
        with self.connect() as db:
            self.get(db, identifier)
            from . import history
            return {"entries": history.list_history(db, identifier, limit)}

    def columns(self, identifier):
        with self.connect() as db:
            return json.loads(self.get(db, identifier)["columns_json"])

    def query(self, identifier, sql):
        """Run bounded, read-only SQL over one dataset."""
        from time import monotonic
        from uuid import UUID

        identifier = str(UUID(identifier))
        if not isinstance(sql, str) or not sql.strip() or len(sql) > 12000:
            raise ValueError("Informe uma consulta SQL de até 12 mil caracteres.")

        def quote(name):
            return '"' + name.replace('"', '""') + '"'

        with closing(sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
            dataset = db.execute(
                "SELECT columns_json FROM datasets WHERE id=?", (identifier,)
            ).fetchone()
            if dataset is None:
                raise ValueError("Dataset não encontrado.")
            names = json.loads(dataset[0])
            if len(names) > db.getlimit(sqlite3.SQLITE_LIMIT_COLUMN):
                raise ValueError("O dataset ultrapassa o número de colunas que o SQLite pode consultar.")
            if any("\x00" in name for name in names):
                raise ValueError("O cabeçalho contém caracteres incompatíveis com SQL.")
            typed_columns = {
                index: kind for index, kind in db.execute(
                    "SELECT column_number,kind FROM dataset_field_types "
                    "WHERE dataset_id=? AND scope='column'", (identifier,),
                )
            }
            typed_indices = {
                item[0] for item in db.execute(
                    "SELECT DISTINCT column_number FROM dataset_field_types WHERE dataset_id=?", (identifier,),
                )
            }
            db.create_function("od_typed", 2, typed_value, deterministic=True)
            fields = []
            for index, name in enumerate(names):
                value = f"json_extract(values_json, '$[{index}]')"
                if index in typed_indices:
                    override = (
                        "(SELECT kind FROM main.dataset_field_types AS override "
                        f"WHERE override.dataset_id='{identifier}' AND override.scope='cell' "
                        f"AND override.row_number=dataset_rows.number AND override.column_number={index})"
                    )
                    default = typed_columns.get(index, "auto")
                    value = f"od_typed({value},COALESCE({override},'{default}'))"
                fields.append(f"{value} AS {quote(name)}")
            fields = ", ".join(fields)
            private_view = "_dataset_" + uuid4().hex
            db.execute(
                f"CREATE TEMP VIEW {private_view} AS SELECT {fields} "
                f"FROM main.dataset_rows WHERE dataset_id='{identifier}'"
            )
            db.execute(f"CREATE TEMP VIEW dados AS SELECT * FROM {private_view}")
            db.execute("PRAGMA query_only=ON")
            def authorize(action, arg1, arg2, database, view):
                if action == sqlite3.SQLITE_READ:
                    # A user CTE may share the public view name. Only the
                    # unguessable, per-connection view can read base rows.
                    allowed = (
                        database == "temp" and (arg1 == "dados" or (arg1 == private_view and view == "dados"))
                    ) or (arg1 in {"dataset_rows", "dataset_field_types"} and database == "main" and view == private_view)
                elif action == sqlite3.SQLITE_FUNCTION:
                    allowed = arg2.lower() not in {"load_extension", "readfile", "writefile"}
                else:
                    allowed = action in {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_RECURSIVE}
                return sqlite3.SQLITE_OK if allowed else sqlite3.SQLITE_DENY

            deadline = monotonic() + 5
            db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 2 * 1024 * 1024)
            db.set_authorizer(authorize)
            db.set_progress_handler(lambda: int(monotonic() > deadline), 5000)
            try:
                cursor = db.execute(sql)
                if len(cursor.description) > 100:
                    raise ValueError("Selecione até 100 colunas por consulta.")
                columns = [preview(item[0]) for item in cursor.description]
                rows = []
                for row in cursor:
                    rows.append([preview(str(value)) if value is not None else None for value in row])
                    if len(rows) > 100:
                        break
                return {"columns": columns, "rows": rows[:100], "limited": len(rows) > 100}
            except sqlite3.Error as error:
                if monotonic() > deadline:
                    raise ValueError("A consulta excedeu cinco segundos.") from error
                raise ValueError(f"Consulta somente leitura inválida: {error}") from error

    def write_analysis_csv(self, identifier, stream):
        """Stream a typed analysis snapshot for Python, leaving exported source CSV unchanged."""
        with self.connect() as db:
            db.execute("BEGIN")
            dataset = self.get(db, identifier)
            columns = json.loads(dataset["columns_json"])
            writer = csv.writer(stream)
            writer.writerow(columns)
            column_types, cell_types = {}, {}
            for scope, row, column, kind in db.execute(
                    "SELECT scope,row_number,column_number,kind FROM dataset_field_types WHERE dataset_id=?",
                    (identifier,)):
                if scope == "column":
                    column_types[column] = kind
                else:
                    cell_types[(row, column)] = kind
            rows = db.execute(
                "SELECT number,values_json FROM dataset_rows WHERE dataset_id=? ORDER BY number",
                (identifier,),
            )
            count = 0
            for number, encoded in rows:
                values = json.loads(encoded)
                writer.writerow([
                    typed_value(value, cell_types.get((number, col), column_types.get(col, "auto")))
                    for col, value in enumerate(values)
                ])
                count += 1
            return count

    def write_csv(self, identifier, stream):
        """Write one consistent snapshot without loading the dataset into memory."""
        with self.connect() as db:
            db.execute("BEGIN")
            dataset = self.get(db, identifier)
            writer = csv.writer(stream)
            writer.writerow(json.loads(dataset["columns_json"]))
            rows = db.execute(
                "SELECT values_json FROM dataset_rows WHERE dataset_id=? ORDER BY number",
                (identifier,),
            )
            writer.writerows(json.loads(row[0]) for row in rows)
            return dataset["row_count"]

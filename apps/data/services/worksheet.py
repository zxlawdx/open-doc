"""Read-only analysis snapshots of the active worksheet."""

import csv
from pathlib import Path
from tempfile import TemporaryDirectory

from .store import Datasets


class WorksheetSnapshot:
    def __init__(self, columns, rows):
        if (not isinstance(columns, list) or not 1 <= len(columns) <= 100
                or any(not isinstance(name, str) or not name.strip() or "\0" in name
                       or len(name) > 8192 for name in columns)
                or len({name.strip().casefold() for name in columns}) != len(columns)):
            raise ValueError("Os cabeçalhos da planilha devem ser únicos e preenchidos.")
        if (not isinstance(rows, list) or len(rows) > 9999
                or len(columns) * (len(rows) + 1) > 50000):
            raise ValueError("A análise da planilha aceita até 50 mil células.")
        size = sum(len(name.encode("utf-8")) for name in columns)
        for row in rows:
            if (not isinstance(row, list) or len(row) != len(columns)
                    or any(not isinstance(value, str) or len(value) > 8192 for value in row)):
                raise ValueError("Valores da planilha inválidos.")
            size += sum(len(value.encode("utf-8")) for value in row)
            if size > 5 * 1024 * 1024:
                raise ValueError("A análise da planilha aceita até 5 MB de valores.")
        self.columns = columns
        self.rows = rows

    def write_csv(self, identifier, stream):
        writer = csv.writer(stream)
        writer.writerow(self.columns)
        writer.writerows(self.rows)
        return len(self.rows)

    def query(self, sql):
        with TemporaryDirectory(prefix="open-doc-worksheet-") as directory:
            root = Path(directory)
            (root / ".veladata").mkdir()
            path = root / "planilha.csv"
            with path.open("w", encoding="utf-8", newline="") as stream:
                self.write_csv(None, stream)
            store = Datasets(root)
            store.initialize()
            identifier = store.import_files([path], delimiter=",")["id"]
            return store.query(identifier, sql)

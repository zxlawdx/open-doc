"""Streaming CSV/XLSX/Parquet interchange for the virtualized table store."""

import csv
import tempfile
from pathlib import Path


def import_files(
    store, paths, identifier=None, *, encoding="utf-8-sig", delimiter="auto"
):
    with tempfile.TemporaryDirectory(prefix="opendoc-import-") as directory:
        converted = []
        for index, value in enumerate(paths):
            path = Path(value)
            if path.suffix.lower() in {".csv", ".tsv"}:
                converted.append(path)
                continue
            target = Path(directory) / (path.stem + f"-{index}.csv")
            with target.open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.writer(stream)
                if path.suffix.lower() == ".xlsx":
                    from openpyxl import load_workbook

                    book = load_workbook(path, read_only=True, data_only=True)
                    try:
                        for row in book.active.iter_rows(values_only=True):
                            writer.writerow(
                                ["" if value is None else value for value in row]
                            )
                    finally:
                        book.close()
                elif path.suffix.lower() == ".parquet":
                    import pyarrow.parquet as pq

                    with pq.ParquetFile(path) as parquet:
                        columns = parquet.schema_arrow.names
                        writer.writerow(columns)
                        for batch in parquet.iter_batches(batch_size=1000):
                            data = batch.to_pydict()
                            writer.writerows(
                                [
                                    "" if data[name][row] is None else data[name][row]
                                    for name in columns
                                ]
                                for row in range(batch.num_rows)
                            )
                else:
                    raise ValueError("Selecione CSV, TSV, XLSX ou Parquet.")
            converted.append(target)
        return store.import_files(
            converted, identifier, encoding=encoding, delimiter=delimiter
        )


def export_file(store, identifier, destination):
    path = Path(destination)
    with tempfile.TemporaryDirectory(
        prefix="opendoc-export-", dir=path.parent
    ) as directory:
        temporary = Path(directory) / path.name
        if path.suffix.lower() == ".csv":
            with temporary.open("w", encoding="utf-8", newline="") as stream:
                count = store.write_csv(identifier, stream)
        else:
            with store.connect() as db:
                import json

                dataset = store.get(db, identifier)
                columns = json.loads(dataset["columns_json"])
                rows = (
                    json.loads(row[0])
                    for row in db.execute(
                        "SELECT values_json FROM dataset_rows WHERE dataset_id=? ORDER BY number",
                        (identifier,),
                    )
                )
                count = dataset["row_count"]
                if path.suffix.lower() == ".xlsx":
                    from openpyxl import Workbook

                    book = Workbook(write_only=True)
                    sheet = book.create_sheet("Dados")
                    sheet.append(columns)
                    for row in rows:
                        # Imported cells are literals, never executable formulas.
                        sheet.append(
                            [
                                "'" + value if value.startswith("=") else value
                                for value in row
                            ]
                        )
                    book.save(temporary)
                elif path.suffix.lower() == ".parquet":
                    import pyarrow as pa
                    import pyarrow.parquet as pq

                    schema = pa.schema([(name, pa.string()) for name in columns])
                    with pq.ParquetWriter(temporary, schema) as writer:
                        batch = []
                        for values in rows:
                            batch.append(dict(zip(columns, values)))
                            if len(batch) == 1000:
                                writer.write_table(
                                    pa.Table.from_pylist(batch, schema=schema)
                                )
                                batch.clear()
                        if batch:
                            writer.write_table(
                                pa.Table.from_pylist(batch, schema=schema)
                            )
                else:
                    raise ValueError("Formato de exportação inválido.")
        temporary.replace(path)
        return {"name": path.name, "rows": count}

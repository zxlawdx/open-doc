"""Explicit bridge from legacy tables to Vela-owned immutable resources."""

import tempfile


class DatasetExchange:
    def __init__(self, runtime, datasets):
        self.runtime = runtime
        self.datasets = datasets
        self.publications = None

    def snapshot(self, identifier, *, raw=False):
        profile=self.datasets.import_schema(identifier)
        if profile is not None and (not raw or profile["options"].get("native")):
            handle = self.parquet_snapshot(identifier)
            return {"resource":handle, "rows":self.datasets.page(identifier,0,0)["row_count"]}
        # The legacy SQLite table stays untouched. Stream a consistent export
        # through a private disk-backed file; never build a giant JSON payload.
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8", newline="") as stream:
            rows = (
                self.datasets.write_csv if raw else self.datasets.write_analysis_csv
            )(identifier, stream)
            stream.flush()
            stream.seek(0)
            # Use the underlying binary buffer after rewinding the text wrapper.
            snapshot = self.runtime.resources.publish(
                stream.buffer, media_type="text/csv"
            )
        self.runtime.resource_access.grant(
            "data", snapshot.resource_id, snapshot.revision
        )
        return {"resource": snapshot.to_dict(), "rows": rows}

    def dataframe(self, resource_id, revision):
        import pandas as pd

        snapshot = self.runtime.resources.snapshot(resource_id, revision)
        if snapshot.media_type == "application/vnd.apache.parquet":
            return pd.read_parquet(self.runtime.resources.open_path(resource_id,revision),dtype_backend="numpy_nullable")
        if snapshot.media_type != "text/csv":
            raise ValueError("Recurso não tabular.")
        return pd.read_csv(self.runtime.resources.open_path(resource_id, revision))

    def publish_frame(self, frame, *, resource_id, expected_revision):
        # Backend API for trusted notebooks: editing frame never mutates source.
        return self.runtime.tabular.publish_pandas(
            frame,
            resource_id=resource_id,
            expected_revision=expected_revision,
        ).to_dict()

    def parquet_snapshot(self, identifier):
        if self.publications is not None:
            existing = self.publications.bound_resource(identifier)
            if existing is not None:
                self.runtime.resource_access.grant("data",existing["resource_id"],existing["revision"])
                return existing
            token = self.publications.token(identifier)
        import json
        import pyarrow as pa
        import pyarrow.parquet as pq

        with tempfile.TemporaryFile(mode="w+b") as stream:
            with self.datasets.connect() as db:
                db.execute("BEGIN")
                dataset = self.datasets.get(db, identifier)
                columns = json.loads(dataset["columns_json"])
                profile = self.datasets.effective_schema(identifier,db)
                convert = self.datasets.scalar_converter(identifier,db,strict=True)
                arrow_types={"text":pa.string(),"integer":pa.int64(),"decimal":pa.float64(),"boolean":pa.bool_(),"date":pa.timestamp("ns"),"datetime":pa.timestamp("ns")}
                schema = pa.schema([(name,arrow_types[profile["schema"][i]["kind"]] if profile else pa.string()) for i,name in enumerate(columns)])
                with pq.ParquetWriter(stream, schema) as writer:
                    rows = db.execute(
                        "SELECT values_json FROM dataset_rows WHERE dataset_id=? ORDER BY number",
                        (identifier,),
                    )
                    batch = []
                    for (value,) in rows:
                        values=json.loads(value)
                        if profile:
                            from datetime import datetime
                            values=[convert(v,i,profile["schema"][i]["kind"]) for i,v in enumerate(values)]
                            values=[datetime.fromisoformat(v) if v is not None and profile["schema"][i]["kind"] in {"date","datetime"} else v for i,v in enumerate(values)]
                        batch.append(dict(zip(columns, values)))
                        if len(batch) == 1000:
                            writer.write_table(
                                pa.Table.from_pylist(batch, schema=schema)
                            )
                            batch.clear()
                    if batch:
                        writer.write_table(pa.Table.from_pylist(batch, schema=schema))
            stream.seek(0)
            handle = self.runtime.resources.publish(
                stream, media_type="application/vnd.apache.parquet"
            ).to_dict()
            self.runtime.resource_access.grant("data",handle["resource_id"],handle["revision"])
            if self.publications is not None:
                self.publications.bind_resource(identifier, handle, token)
            return handle

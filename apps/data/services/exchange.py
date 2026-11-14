"""Explicit bridge from legacy tables to Vela-owned immutable resources."""

import tempfile


class DatasetExchange:
    def __init__(self, runtime, datasets):
        self.runtime = runtime
        self.datasets = datasets

    def snapshot(self, identifier):
        # The legacy SQLite table stays untouched. Stream a consistent export
        # through a private disk-backed file; never build a giant JSON payload.
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8", newline="") as stream:
            rows = self.datasets.write_analysis_csv(identifier, stream)
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
            return self.runtime.tabular.to_pandas(resource_id, revision)
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

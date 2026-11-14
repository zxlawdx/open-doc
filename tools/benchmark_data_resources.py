"""Diagnostic legacy-table import/native resource export benchmark.

Run: PYTHONPATH=../vela:. python tools/benchmark_data_resources.py
No renderer timings or overall application speedup are inferred here.
"""

import json
import platform
import tempfile
import time
import tracemalloc
from pathlib import Path
from types import SimpleNamespace

from vela.apps import AppConfig, AppRegistry
from vela.events import EventBus
from vela.resource_access import ResourceAccess
from vela.resources import ResourceStore
from apps.data.services.store import Datasets
from apps.data.services.exchange import DatasetExchange


def measure(records):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / ".veladata").mkdir()
        source = root / "data.csv"
        with source.open("w") as stream:
            stream.write("id,value\n")
            for index in range(records):
                stream.write(f"{index},{index * 2}\n")
        datasets = Datasets(root)
        datasets.initialize()
        registry = AppRegistry()
        registry.register(AppConfig(name="data", module="apps.data"))
        resources = ResourceStore(directory=root / "resources", events=EventBus())
        runtime = SimpleNamespace(
            resources=resources, resource_access=ResourceAccess(resources, registry)
        )
        tracemalloc.start()
        start = time.perf_counter()
        identifier = datasets.import_files([source], delimiter=",")["id"]
        import_ms = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        snapshot = DatasetExchange(runtime, datasets).snapshot(identifier)
        export_ms = (time.perf_counter() - start) * 1000
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        resources.close()
        return dict(
            records=records,
            legacy_import_ms=import_ms,
            native_snapshot_ms=export_ms,
            python_peak_bytes=peak,
            snapshot_bytes=snapshot["resource"]["size"],
        )


if __name__ == "__main__":
    print(
        json.dumps(
            dict(
                platform=platform.platform(),
                results=[measure(n) for n in (1000, 10000, 100000, 1000000)],
            ),
            indent=2,
        )
    )

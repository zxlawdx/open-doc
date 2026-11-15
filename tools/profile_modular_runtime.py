"""Backend startup/data/profile metrics; native render/navigation use Qt QA tools."""

import cProfile
import io
import json
import platform
import pstats
import tempfile
import time
import tracemalloc
from pathlib import Path

from config.wsgi import create_app
from config.composition import get_context
from shared.services.preferences_service import Config


def measure(records):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "source.csv"
        with source.open("w") as stream:
            stream.write("id,value\n")
            for row in range(records):
                stream.write(f"{row},{row*2}\n")
        start = time.perf_counter()
        app = create_app(Config(root))
        startup = (time.perf_counter() - start) * 1000
        profiler = cProfile.Profile()
        tracemalloc.start()
        try:
            ctx = get_context()
            start = time.perf_counter()
            result = profiler.runcall(
                ctx.datasets.import_files, [source], delimiter=","
            )
            import_ms = (time.perf_counter() - start) * 1000
            identifier = result["id"]
            timings = {}
            for name, callback in {
                "page_ms": lambda: ctx.datasets.page(identifier, records // 2, 0),
                "query_ms": lambda: ctx.datasets.query(
                    identifier, "SELECT * FROM dados LIMIT 50"
                ),
                "snapshot_ms": lambda: ctx.dataset_exchange.parquet_snapshot(
                    identifier
                ),
            }.items():
                start = time.perf_counter()
                callback()
                timings[name] = (time.perf_counter() - start) * 1000
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
            app.close()
        output = io.StringIO()
        pstats.Stats(profiler, stream=output).strip_dirs().sort_stats(
            "cumulative"
        ).print_stats(15)
        return {
            "records": records,
            "startup_backend_ms": startup,
            "import_ms": import_ms,
            **timings,
            "python_peak_bytes": peak,
            "cpu_profile_import": output.getvalue(),
        }


if __name__ == "__main__":
    print(
        json.dumps(
            {
                "platform": platform.platform(),
                "python": platform.python_version(),
                "scope": "backend; tracemalloc and cProfile enabled; warm process imports",
                "results": [measure(n) for n in [1000, 10000, 100000, 1000000]],
            },
            indent=2,
        )
    )

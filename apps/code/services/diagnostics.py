"""Opt-in notebook smoke executed inside the actual frozen application."""

import json
import os
import sys
import tempfile
import traceback
from pathlib import Path


def self_test():
    from config.wsgi import create_app
    from config.composition import get_context
    from shared.services.preferences_service import Config

    report = {
        "frozen": bool(getattr(sys, "frozen", False)),
        "platform": sys.platform,
        "steps": [],
    }
    destination = Path(
        os.environ.get("OPEN_DOC_NOTEBOOK_SMOKE_REPORT", "notebook-smoke.json")
    ).absolute()
    result_code = 1
    app = None
    try:
        with tempfile.TemporaryDirectory(
            prefix="opendoc-frozen-notebook-"
        ) as directory:
            root = Path(directory)
            app = create_app(Config(root))
            ctx = get_context()
            source = root / "data.csv"
            source.write_text("id,value\n1,10\n2,20\n")
            identifier = ctx.datasets.import_files([source], delimiter=",")["id"]
            report["steps"].append("csv-import")
            installed = ctx.code_tools.environments(root).install(
                identifier, ["pandas", "pyarrow", "ipykernel", "duckdb"], confirm=True
            )
            report["python"] = installed["environment"]
            report["steps"].append("project-environment-and-libraries")
            opened = ctx.notebooks.open(identifier)
            assert not opened.get("returncode"), opened
            assert not ctx.notebooks.execute(identifier, "df['value'] *= 2").get(
                "returncode"
            )
            assert (
                ctx.notebooks.execute(identifier, "print(df.value.sum())")[
                    "output"
                ].strip()
                == "60"
            )
            assert not ctx.notebooks.execute(
                identifier, "SELECT sum(value) AS total FROM df", "sql"
            ).get("returncode")
            assert ctx.datasets.cell(identifier, 1, 1)["value"] == "10"
            report["steps"].append("persistent-python-sql-and-isolated-dataframe")
            ctx.notebooks.publish(identifier)
            assert ctx.datasets.cell(identifier, 1, 1)["value"] == "20"
            ctx.datasets.undo(identifier)
            assert ctx.datasets.cell(identifier, 1, 1)["value"] == "10"
            report["steps"].append("publication-and-undo")
            for extension in ("xlsx", "parquet"):
                path = root / ("roundtrip." + extension)
                ctx.data_tools.export_file(ctx.datasets, identifier, path)
                imported = ctx.data_tools.import_files(
                    ctx.datasets, [path], delimiter=","
                )
                assert ctx.datasets.cell(imported["id"], 1, 1)["value"] == "10"
            report["steps"].append("xlsx-parquet-roundtrip")
            app.close()
            app = None
            report["success"] = True
            result_code = 0
    except BaseException as error:
        report["success"] = False
        report["error"] = repr(error)
        report["traceback"] = traceback.format_exc()
    finally:
        if app is not None:
            app.close()
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, indent=2), encoding="utf-8")
    raise SystemExit(result_code)

import errno
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import pytest


def require_kernel_transport():
    zmq = pytest.importorskip("zmq")
    context = zmq.Context()
    socket = context.socket(zmq.REP)
    try:
        with TemporaryDirectory() as root:
            address = (
                "tcp://127.0.0.1:*"
                if os.name == "nt"
                else "ipc://" + str(Path(root) / "probe")
            )
            try:
                socket.bind(address)
            except zmq.ZMQError as error:
                if error.errno in {errno.EPERM, errno.EACCES}:
                    pytest.skip(
                        "Executor blocks Jupyter sockets (EPERM/EACCES); real kernel test runs on native CI."
                    )
                raise
    finally:
        socket.close(linger=0)
        context.term()


def test_persistent_jupyter_namespaces_and_project_isolation(tmp_path):
    require_kernel_transport()
    from apps.code.services.kernels import KernelSessions

    sessions = KernelSessions(tmp_path)
    first, second = str(uuid4()), str(uuid4())
    try:
        assert sessions.execute(first, "answer = 41")["returncode"] == 0
        assert sessions.execute(first, "print(answer + 1)")["output"].strip() == "42"
        assert sessions.execute(second, "print(answer)")["returncode"] == 1
        assert len(sessions.status()) == 2
    finally:
        sessions.close()
    assert sessions.status() == []


def test_csv_dataframe_publish_undo_redo_and_reference_sheet(tmp_path):
    require_kernel_transport()
    from config.wsgi import create_app
    from config.composition import get_context
    from shared.services.preferences_service import Config
    from apps.spreadsheets.api import workbook

    app = create_app(Config(tmp_path))
    try:
        ctx = get_context()
        source = tmp_path / "input.csv"
        source.write_text("id,value\n1,10\n2,20\n")
        identifier = ctx.datasets.import_files([source], delimiter=",")["id"]
        assert not ctx.notebooks.open(identifier)["returncode"]
        assert not ctx.notebooks.execute(identifier, "df['value'] = df['value'] * 2")[
            "returncode"
        ]
        assert ctx.datasets.cell(identifier, 1, 1)["value"] == "10"
        queried = ctx.notebooks.execute(identifier, "SELECT SUM(value) AS total FROM dados", "sql")
        assert queried["returncode"] == 0
        assert "60" in str(queried)
        published = ctx.notebooks.publish(identifier)
        assert published["resource"]["revision"] == 2
        assert ctx.datasets.cell(identifier, 1, 1)["value"] == "20"
        assert ctx.datasets.undo(identifier)["changed"]
        assert ctx.datasets.cell(identifier, 1, 1)["value"] == "10"
        assert ctx.datasets.undo(identifier, redo=True)["changed"]
        assert ctx.datasets.cell(identifier, 1, 1)["value"] == "20"
        context = {
            "headers": {"X-Open-Doc-Token": ctx.token},
            "json": {"operation": "link-dataset", "dataset_id": identifier},
        }
        book = workbook(context)
        assert book["sheets"][0]["cells"] == {}
        assert book["sheets"][0]["external_resource"]["resource_id"]
        context["json"] = {"operation": "resource-page", "id": book["id"], "offset": 0}
        page = workbook(context)
        assert page["rows"][0]["value"] == 20
    finally:
        app.close()


def test_real_xlsx_parquet_interchange_and_publication_history(tmp_path):
    import pandas as pd
    from config.wsgi import create_app
    from config.composition import get_context
    from shared.services.preferences_service import Config

    app = create_app(Config(tmp_path))
    try:
        ctx = get_context()
        for extension in ("xlsx", "parquet"):
            source = tmp_path / ("source." + extension)
            frame = pd.DataFrame({"id": [1, 2], "value": [10, 20]})
            if extension == "xlsx":
                frame.to_excel(source, index=False)
            else:
                frame.to_parquet(source, index=False)
            imported = ctx.data_tools.import_files(
                ctx.datasets, [source], delimiter=","
            )
            identifier = imported["id"]
            before = ctx.dataset_exchange.snapshot(identifier, raw=True)["resource"]
            token = ctx.publications.token(identifier)
            frame.loc[0, "value"] = 99
            after = ctx.dataset_exchange.runtime.tabular.publish_pandas(frame).to_dict()
            ctx.publications.adopt(identifier, before, after, token)
            assert ctx.datasets.cell(identifier, 1, 1)["value"] == "99"
            ctx.datasets.undo(identifier)
            assert ctx.datasets.cell(identifier, 1, 1)["value"] == "10"
            destination = tmp_path / ("export." + extension)
            ctx.data_tools.export_file(ctx.datasets, identifier, destination)
            assert destination.is_file()
    finally:
        app.close()


def test_reference_page_preserves_numbers_and_bounds_native_values(tmp_path):
    import pandas as pd
    from config.wsgi import create_app
    from config.composition import get_context
    from shared.services.preferences_service import Config
    from apps.spreadsheets.api import workbook

    app = create_app(Config(tmp_path))
    try:
        ctx = get_context()
        frame = pd.DataFrame(
            {
                "date": pd.to_datetime(["2026-01-01"]),
                "number": [float("inf")],
                "text": ["x" * 700],
            }
        )
        snap = ctx.dataset_exchange.runtime.tabular.publish_pandas(frame)
        book = ctx.workbooks.create(
            "Native values",
            [
                {
                    "name": "Dados",
                    "cells": {},
                    "bold": [],
                    "external_resource": {
                        "resource_id": snap.resource_id,
                        "revision": snap.revision,
                    },
                }
            ],
        )
        result = workbook(
            {
                "headers": {"X-Open-Doc-Token": ctx.token},
                "json": {"operation": "resource-page", "id": book["id"]},
            }
        )
        assert result["rows"][0]["number"] is None
        assert result["rows"][0]["date"].startswith("2026-01-01")
        assert len(result["rows"][0]["text"]) == 513
    finally:
        app.close()

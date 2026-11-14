import ast
from pathlib import Path

import pytest

from shared.services.preferences_service import Config
from config.wsgi import create_app
from config.composition import get_context
from vela.resources import RevisionConflict


def test_registered_data_routes_native_exchange_and_durable_workspace(tmp_path):
    pd = pytest.importorskip("pandas")
    pytest.importorskip("pyarrow")
    config = Config(tmp_path)
    app = create_app(config)
    try:
        assert {entry.name for entry in app.apps} == {"home", "documents", "spreadsheets", "presentations", "pdf", "data", "code", "templates"}
        ctx = get_context()
        source = tmp_path / "source.csv"
        source.write_text("number,value\n1,10\n2,20\n")
        identifier = ctx.datasets.import_files([source], delimiter=",")["id"]
        result = ctx.dataset_exchange.snapshot(identifier)
        handle = result["resource"]
        frame = ctx.dataset_exchange.dataframe(handle["resource_id"], 1)
        assert isinstance(frame, pd.DataFrame)
        frame.loc[0, "value"] = 99
        assert ctx.dataset_exchange.dataframe(
            handle["resource_id"], 1
        ).value.tolist() == [10, 20]
        updated = ctx.dataset_exchange.publish_frame(
            frame, resource_id=handle["resource_id"], expected_revision=1
        )
        assert updated["revision"] == 2
        assert ctx.dataset_exchange.dataframe(
            handle["resource_id"], 2
        ).value.tolist() == [99, 20]
        # Legacy table is isolated until an explicit table adoption is implemented.
        assert ctx.datasets.cell(identifier, 1, 1)["value"] == "10"
        workspace = ctx.resource_workspace
        session = workspace.save(
            expected_revision=0,
            tabs=[{"app": "data", "resource": updated}],
            settings={"theme": "dark"},
            modules={"data": {"active": identifier}},
        )
        with pytest.raises(RevisionConflict):
            workspace.save(expected_revision=0, tabs=[], settings={}, modules={})
    finally:
        app.close()
    reopened = create_app(config)
    try:
        state = get_context().resource_workspace.load()
        assert state["revision"] == session["revision"]
        assert state["tabs"][0]["resource"] == updated
    finally:
        reopened.close()


def test_data_has_no_shell_implementation_imports():
    root = Path(__file__).resolve().parents[2]
    for source in (root / "apps/data").rglob("*.py"):
        for node in ast.walk(ast.parse(source.read_text())):
            names = (
                [item.name for item in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
            )
            assert not any(name.startswith("apps.open_doc") for name in names), source

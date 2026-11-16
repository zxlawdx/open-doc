"""SQL cell results are available to later Python cells without re-querying."""
from types import SimpleNamespace

from apps.code.services.notebook import NotebookService


class FakeKernels:
    def __init__(self):
        self.calls = []

    def has_session(self, project):
        return True

    def execute(self, project, source):
        self.calls.append((project, source))
        return {"returncode": 0, "output": ""}


def test_sql_cell_publishes_df_resultado_in_shared_kernel():
    kernels = FakeKernels()
    notebook = NotebookService(SimpleNamespace(kernels=kernels))
    notebook._bindings["dataset-1"] = {"resource": {}}
    result = notebook.execute("dataset-1", "SELECT COUNT(*) AS total FROM dados", "sql")

    assert result["returncode"] == 0
    project, source = kernels.calls[0]
    assert project == "dataset-1"
    assert "dados = df" in source
    assert "df_resultado = duckdb.sql(" in source
    assert "SELECT COUNT(*) AS total FROM dados" in source
    assert source.endswith("\ndf_resultado")


def test_python_cell_runs_unchanged_after_sql():
    kernels = FakeKernels()
    notebook = NotebookService(SimpleNamespace(kernels=kernels))
    notebook._bindings["dataset-1"] = {"resource": {}}
    notebook.execute("dataset-1", "print(df_resultado.head())", "python")
    assert kernels.calls == [("dataset-1", "print(df_resultado.head())")]

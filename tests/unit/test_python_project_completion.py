"""Regression: Jedi must complete imports from the notebook's project venv."""

import importlib
import subprocess
import sys
import venv
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import jedi

from apps.code.services.python_analysis import analyze
from apps.code.services.python_envs import PythonEnvironments


def test_project_install_refreshes_autocomplete_without_app_restart(tmp_path, monkeypatch):
    project = str(uuid4())
    manager = PythonEnvironments(tmp_path)
    folder = manager.path(project)
    venv.EnvBuilder(with_pip=False).create(folder)
    executable = manager.interpreter(project)
    assert executable is not None

    purelib = Path(
        subprocess.check_output(
            [str(executable), "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"],
            text=True,
            timeout=15,
        ).strip()
    )
    # The real installer installs Jedi into the venv. To test offline without
    # PyPI, expose the already-tested host Jedi + Parso via this isolated venv.
    (purelib / "opendoc_test_jedi.pth").write_text(
        str(Path(jedi.__file__).parent.parent) + "\n", encoding="utf-8"
    )

    workspace_module = importlib.import_module("shared.contracts.workspace")
    monkeypatch.setattr(
        workspace_module, "workspace",
        lambda: SimpleNamespace(config=SimpleNamespace(root=tmp_path)),
    )

    code = "import opendoc_project_only_package as plugin\nplugin.CustomPred"
    before = analyze(code, 2, len("plugin.CustomPred"), "complete", project)
    assert "CustomPrediction" not in {item["label"] for item in before["items"]}

    package = purelib / "opendoc_project_only_package"
    package.mkdir()
    (package / "__init__.py").write_text(
        "class CustomPrediction:\n"
        "    def from_project_venv(self):\n"
        "        return 7\n",
        encoding="utf-8",
    )
    after = analyze(code, 2, len("plugin.CustomPred"), "complete", project)
    assert "CustomPrediction" in {item["label"] for item in after["items"]}

    nested = "import opendoc_project_only_package as plugin\nplugin.CustomPrediction().from_proj"
    next_result = analyze(nested, 2, len("plugin.CustomPrediction().from_proj"), "complete", project)
    assert "from_project_venv" in {item["label"] for item in next_result["items"]}


def test_project_editor_reports_explicit_error_when_jedi_not_installed(tmp_path, monkeypatch):
    project = str(uuid4())
    folder = PythonEnvironments(tmp_path).path(project)
    venv.EnvBuilder(with_pip=False).create(folder)
    workspace_module = importlib.import_module("shared.contracts.workspace")
    monkeypatch.setattr(
        workspace_module, "workspace",
        lambda: SimpleNamespace(config=SimpleNamespace(root=tmp_path)),
    )
    import pytest
    with pytest.raises(ValueError, match="Jedi não está instalado"):
        analyze("import pandas as pd\npd.DataF", 2, len("pd.DataF"), "complete", project)

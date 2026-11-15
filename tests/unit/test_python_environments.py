from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from apps.code.services.python_envs import PythonEnvironments


def test_project_environment_never_installs_without_explicit_consent(tmp_path, monkeypatch):
    service = PythonEnvironments(tmp_path)
    project = str(uuid4())
    assert service.status(project)["initialized"] is False
    assert service.interpreter(project) is None
    assert not (tmp_path / ".veladata" / "python_envs").exists()
    with pytest.raises(ValueError, match="confirmação"):
        service.install(project, ["pandas"])
    with pytest.raises(ValueError, match="URLs"):
        service.install(project, ["https://example.invalid/bad.whl"], confirm=True)
    with pytest.raises(ValueError, match="URLs"):
        service.install(project, ["--index-url"], confirm=True)
    with pytest.raises(ValueError, match="Identificador"):
        service.status("../fora")
    assert not (tmp_path / ".veladata" / "python_envs").exists()


def test_installer_uses_project_venv_bounded_wheel_pip_and_reports_installed(tmp_path, monkeypatch):
    import sys
    from apps.code.services import python_envs

    service = PythonEnvironments(tmp_path)
    project = str(uuid4())
    called = []

    def fake_venv(self, folder):
        interpreter = Path(folder) / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        interpreter.parent.mkdir(parents=True, exist_ok=True)
        interpreter.touch()

    def fake_run(args, **kwargs):
        called.append((args, kwargs))
        if args[1:3] == ["-I", "-c"]:
            return SimpleNamespace(returncode=0, stdout='[{"name":"pandas","version":"2.2"}]', stderr="")
        return SimpleNamespace(returncode=0, stdout="Successfully installed pandas", stderr="")

    monkeypatch.setattr(python_envs.venv.EnvBuilder, "create", fake_venv)
    monkeypatch.setattr(python_envs, "run_external", fake_run)
    result = service.install(project, ["pandas==2.2"], confirm=True)
    assert result["installed"] == ["pandas==2.2"]
    assert "--no-input" in called[0][0]
    assert "--only-binary=:all:" in called[0][0]
    assert called[0][0][0] == str(service.interpreter(project))
    assert str(tmp_path) in called[0][0][0]
    assert service.status(project)["packages"][0] == {"name": "pandas", "version": "2.2"}
    other = str(uuid4())
    assert service.interpreter(other) is None

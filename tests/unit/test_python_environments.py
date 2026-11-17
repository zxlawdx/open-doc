from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from apps.code.services.python_envs import PythonEnvironments


def test_project_environment_never_installs_without_explicit_consent(
    tmp_path, monkeypatch
):
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


def test_installer_uses_project_venv_bounded_wheel_pip_and_reports_installed(
    tmp_path, monkeypatch
):
    import sys
    from apps.code.services import python_envs

    service = PythonEnvironments(tmp_path)
    project = str(uuid4())
    called = []

    def fake_venv(self, folder):
        interpreter = Path(folder) / (
            "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
        )
        interpreter.parent.mkdir(parents=True, exist_ok=True)
        interpreter.touch()

    def fake_run(args, **kwargs):
        called.append((args, kwargs))
        if args[1:3] == ["-I", "-c"] and "venv.EnvBuilder" in args[3]:
            fake_venv(None, args[-1])
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if args[1:3] == ["-I", "-c"]:
            return SimpleNamespace(
                returncode=0, stdout='[{"name":"pandas","version":"2.2"}]', stderr=""
            )
        return SimpleNamespace(
            returncode=0, stdout="Successfully installed pandas", stderr=""
        )

    monkeypatch.setattr(python_envs, "run_external", fake_run)
    result = service.install(project, ["pandas==2.2"], confirm=True)
    assert result["installed"] == ["pandas==2.2"]
    pip_call = next(call for call in called if "--only-binary=:all:" in call[0])
    assert "--no-input" in pip_call[0]
    assert "--only-binary=:all:" in pip_call[0]
    assert (
        pip_call[0].count("jedi==0.19.2") == 1
    )  # Editor dependency is included with consent.
    assert pip_call[0][0] == str(service.interpreter(project))
    assert str(tmp_path) in pip_call[0][0]
    assert service.status(project)["packages"][0] == {
        "name": "pandas",
        "version": "2.2",
    }
    other = str(uuid4())
    assert service.interpreter(other) is None


def test_explicit_jedi_install_does_not_duplicate_editor_dependency(
    tmp_path, monkeypatch
):
    import sys
    from apps.code.services import python_envs

    service = PythonEnvironments(tmp_path)
    project = str(uuid4())
    executable = service.path(project) / (
        "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
    )
    executable.parent.mkdir(parents=True)
    executable.touch()
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(python_envs, "run_external", fake_run)
    result = service.install(project, ["jedi==0.19.2"], confirm=True)
    assert next(call for call in calls if "install" in call).count("jedi==0.19.2") == 1
    assert result["installed"] == ["jedi==0.19.2"]


def test_msys_venv_layout_is_not_misreported_as_creation_failure(tmp_path, monkeypatch):
    import sys

    monkeypatch.setattr(sys, "platform", "win32")
    service = PythonEnvironments(tmp_path)
    project = str(uuid4())
    executable = service.path(project) / "bin/python.exe"
    executable.parent.mkdir(parents=True)
    executable.touch()
    assert service.interpreter(project) == executable


def test_creation_failure_exposes_stage_and_preserves_stderr(tmp_path, monkeypatch):
    from apps.code.services import python_envs

    service = PythonEnvironments(tmp_path)
    project = str(uuid4())
    monkeypatch.setattr(
        python_envs, "external_python", lambda *a: Path("/Python with spaces/python")
    )
    monkeypatch.setattr(
        python_envs,
        "run_external",
        lambda *a, **kw: SimpleNamespace(
            returncode=13, stdout="", stderr="Permission denied token=private"
        ),
    )
    with pytest.raises(ValueError) as error:
        service.ensure(project)
    message = str(error.value)
    assert (
        "criação do venv" in message
        and "Permission denied" in message
        and "13" in message
    )
    assert (
        str(Path("/Python with spaces/python")) in message
        and str(service.path(project)) in message
    )
    assert "private" not in message


def test_corrupt_environment_is_preserved(tmp_path):
    service = PythonEnvironments(tmp_path)
    project = str(uuid4())
    marker = service.path(project) / "installed-data"
    marker.parent.mkdir(parents=True)
    marker.write_text("preserve")
    with pytest.raises(ValueError, match="preservado"):
        service.ensure(project)
    assert marker.read_text() == "preserve"

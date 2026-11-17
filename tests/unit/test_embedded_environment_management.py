from pathlib import Path
from threading import Thread
from uuid import uuid4
import sys
import time

import pytest

from apps.code.services.python_envs import PythonEnvironments


def test_cancel_stops_owned_install_and_preserves_environment(tmp_path):
    manager = PythonEnvironments(tmp_path)
    project = str(uuid4())
    marker = manager.path(project) / "keep.txt"
    marker.parent.mkdir(parents=True)
    marker.write_text("existing package data")
    errors = []

    def install():
        try:
            manager._package_run(
                project,
                [
                    sys.executable,
                    "-u",
                    "-c",
                    'import time; print("install log ready", flush=True); time.sleep(30)',
                ],
            )
        except ValueError as error:
            errors.append(str(error))

    worker = Thread(target=install)
    worker.start()
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status = manager.job_status(project)
            if "install log ready" in status["log"]:
                break
            time.sleep(0.02)
        assert "install log ready" in manager.job_status(project)["log"]
        assert manager.cancel(project)["cancelled"]
    finally:
        manager.cancel(project)
        worker.join(timeout=5)
    assert not worker.is_alive()
    assert errors and "Código:" in errors[0]
    assert marker.read_text() == "existing package data"
    assert not manager.job_status(project)["running"]


def test_requirements_rejects_options_and_requires_consent(tmp_path):
    manager = PythonEnvironments(tmp_path)
    project = str(uuid4())
    for text in (
        "--index-url https://example.invalid",
        "-r other.txt",
        "pandas @ https://example.invalid/file.whl",
    ):
        with pytest.raises(ValueError, match="URLs"):
            manager.import_requirements(project, text, confirm=True)
    with pytest.raises(ValueError, match="confirmação"):
        manager.import_requirements(project, "pandas==2.2.3")
    assert not manager.path(project).exists()


def test_integrity_check_rejects_changed_binary(tmp_path):
    import hashlib, json
    from apps.code.services.embedded_runtime import verify_runtime

    binary = tmp_path / "python.exe"
    binary.write_bytes(b"original")
    (tmp_path / "integrity.json").write_text(
        json.dumps({"python.exe": hashlib.sha256(b"original").hexdigest()})
    )
    assert verify_runtime(tmp_path) == tmp_path
    binary.write_bytes(b"changed")
    verify_runtime.cache_clear()
    with pytest.raises(ValueError, match="Integridade"):
        verify_runtime(tmp_path)


def test_environment_parent_permission_failure_is_actionable(tmp_path, monkeypatch):
    from apps.code.services import python_envs

    manager = PythonEnvironments(tmp_path)
    project = str(uuid4())
    monkeypatch.setattr(
        python_envs, "external_python", lambda *args: Path(sys.executable)
    )
    original = Path.mkdir

    def denied(path, *args, **kwargs):
        if path == manager.root:
            raise PermissionError("permission denied")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", denied)
    with pytest.raises(ValueError) as failure:
        manager.ensure(project)
    assert "criação do diretório" in str(failure.value)
    assert str(manager.path(project)) in str(failure.value)
    assert "permission denied" in str(failure.value)

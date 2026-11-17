"""Exercise the shipped binaries rather than mocking subprocess results."""

import os
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("OPEN_DOC_RUNTIME_ROOT"),
    reason="Staged portable runtime is exercised by native CI",
)


def test_real_embedded_python_bootstrap_without_path_or_network(tmp_path, monkeypatch):
    from apps.code.services.python_envs import PythonEnvironments
    from apps.code.services.local_runtime import external_python, run_external

    monkeypatch.setenv("PATH", "")
    monkeypatch.setenv("UV_OFFLINE", "1")
    root = Path(os.environ["OPEN_DOC_RUNTIME_ROOT"]).resolve()
    assert external_python().is_relative_to(root)
    manager = PythonEnvironments(tmp_path / "Project with spaces")
    project = str(uuid4())
    python = manager.prepare_kernel(project)
    assert python == manager.prepare_kernel(project)
    result = run_external(
        [
            str(python),
            "-I",
            "-c",
            "import sys,ipykernel,jedi; assert sys.prefix != sys.base_prefix; print(sys.version)",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    assert "3.12.16" in result.stdout
    assert manager.check(project)["compatible"]
    assert "ipykernel==" in manager.requirements(project)["text"]
    manager.select(project, str(python), existing=True)
    assert manager.interpreter(project) == python
    manager.select(project, internal=True)
    # New choice preserves the old environment and its packages.
    assert python.is_file()
    assert manager.path(project) != python.parent.parent


def test_real_embedded_kernel_preserves_variables_and_uses_project_pip(
    tmp_path, monkeypatch
):
    import zmq
    import errno

    context = zmq.Context()
    socket = context.socket(zmq.REP)
    try:
        address = (
            "tcp://127.0.0.1:*"
            if os.name == "nt"
            else "ipc://" + str(tmp_path / "probe")
        )
        try:
            socket.bind(address)
        except zmq.ZMQError as error:
            if error.errno in {errno.EPERM, errno.EACCES}:
                pytest.skip("Host blocks kernel sockets; native CI executes this test")
            raise
    finally:
        socket.close(linger=0)
        context.term()
    from apps.code.services.kernels import KernelSessions
    from apps.code.services.python_envs import PythonEnvironments

    monkeypatch.setenv("PATH", "")
    monkeypatch.setenv("UV_OFFLINE", "1")
    project = str(uuid4())
    sessions = KernelSessions(tmp_path)
    try:
        assert sessions.execute(project, "answer=42")["returncode"] == 0
        for cell in ("%pip --version", "!pip --version"):
            result = sessions.execute(project, cell)
            assert result["returncode"] == 0, result
            assert (
                str(PythonEnvironments(tmp_path).path(project)) in result["output"]
            ), result
        assert sessions.execute(project, "print(answer)")["output"].strip() == "42"
        sessions.stop(project)
        assert sessions.execute(project, "print(answer)")["returncode"] == 1
    finally:
        sessions.close()


@pytest.mark.skipif(
    os.environ.get("OPEN_DOC_SCIENTIFIC_RUNTIME_TEST") != "1",
    reason="Network scientific compatibility check runs in native CI",
)
def test_scientific_wheels_import_and_jedi(tmp_path, monkeypatch):
    from apps.code.services.python_envs import PythonEnvironments
    from apps.code.services.local_runtime import run_external
    from apps.code.services.analysis_worker import SOURCE
    import json

    project = str(uuid4())
    manager = PythonEnvironments(tmp_path)
    manager.prepare_kernel(project)
    manager.install(
        project,
        ["numpy", "pandas", "matplotlib", "scikit-learn", "pyarrow"],
        confirm=True,
    )
    manager.install(project, ["duckdb", "faster-whisper"], confirm=True)
    python = manager.interpreter(project)
    result = run_external(
        [
            str(python),
            "-I",
            "-c",
            'import numpy,pandas,matplotlib,sklearn,pyarrow,duckdb,faster_whisper; print(pandas.DataFrame({"x":[10,20,30]}).x.sum())',
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    assert result.stdout.strip().splitlines()[-1] == "60"
    code = "import pandas as pd\ndf=pd.DataFrame()\ndf.he"
    completion = run_external(
        [str(python), "-I", "-c", SOURCE],
        input=json.dumps([code, 3, 5, "complete"]),
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    assert "head" in {item["label"] for item in json.loads(completion.stdout)["items"]}
    assert manager.check(project)["compatible"]


def test_existing_external_venv_preserves_its_python_version(tmp_path):
    """CI host is 3.14 while the shipped runtime is 3.12: real migration path."""
    import sys
    import venv
    from apps.code.services.python_envs import PythonEnvironments
    from apps.code.services.local_runtime import run_external

    manager = PythonEnvironments(tmp_path)
    project = str(uuid4())
    folder = manager.path(project)
    venv.EnvBuilder(with_pip=False).create(folder)
    marker = folder / "preserve-data.txt"
    marker.write_text("old project data")
    python = manager.prepare_kernel(project)
    result = run_external(
        [
            str(python),
            "-I",
            "-c",
            'import sys,ipykernel; print(str(sys.version_info.major)+"."+str(sys.version_info.minor))',
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    assert result.stdout.strip() == f"{sys.version_info.major}.{sys.version_info.minor}"
    assert marker.read_text() == "old project data"
    assert manager.interpreter(project) == python

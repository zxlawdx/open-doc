"""Real isolated Python + IPython installs, with no source rewriting."""

from pathlib import Path
from uuid import uuid4


def test_real_project_kernel_installs_and_preserves_session(tmp_path):
    import errno
    import tempfile
    import zmq
    import pytest

    context = zmq.Context()
    socket = context.socket(zmq.REP)
    try:
        import os

        address = (
            "tcp://127.0.0.1:*" if os.name == "nt" else "ipc://" + tempfile.mktemp()
        )
        try:
            socket.bind(address)
        except zmq.ZMQError as error:
            if error.errno in {errno.EPERM, errno.EACCES}:
                pytest.skip(
                    "Host blocks Jupyter sockets; native CI runs this real kernel test"
                )
            raise
    finally:
        socket.close(linger=0)
        context.term()
    from apps.code.services.python_envs import PythonEnvironments
    from apps.code.services.kernels import KernelSessions

    project = str(uuid4())
    envs = PythonEnvironments(tmp_path / "project with spaces")
    envs.install(project, ["ipykernel", "pandas"], confirm=True)
    sessions = KernelSessions(tmp_path / "project with spaces")
    try:
        for code in ("%pip install pandas", "!pip install pandas"):
            result = sessions.execute(project, code, timeout=180)
            assert result["returncode"] == 0, result
        result = sessions.execute(
            project,
            "import sys, pandas as pd\ndf = pd.DataFrame({'produto':['A','B','C'], 'valor':[10,20,30]})\nprint(sys.executable)\nprint(df.valor.sum())",
        )
        assert result["returncode"] == 0, result
        assert str(envs.interpreter(project)) in result["output"]
        assert "60" in result["output"]
        assert (
            sessions.execute(project, "print(df.shape)")["output"].strip() == "(3, 2)"
        )
        literal = sessions.execute(
            project, 'text = "!pip install this-is-a-string"\nprint(text)'
        )
        assert literal["output"].strip() == "!pip install this-is-a-string"
        sessions.stop(project)
        assert sessions.execute(project, "print(df)")["returncode"] == 1
        assert envs.status(project)["initialized"]
    finally:
        sessions.close()

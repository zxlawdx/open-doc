#!/usr/bin/env python3
"""Real offline bootstrap and IPython smoke with no system Python on PATH."""

import json
import os
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def smoke(root):
    os.environ["OPEN_DOC_RUNTIME_ROOT"] = str(root.resolve())
    os.environ["UV_OFFLINE"] = "1"
    os.environ["PATH"] = ""
    # Deliberately invalid proxy rejects unexpected network bootstrap attempts.
    os.environ["HTTPS_PROXY"] = "http://127.0.0.1:9"
    os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"
    from apps.code.services.local_runtime import external_python, run_external
    from apps.code.services.python_envs import PythonEnvironments
    from apps.code.services.kernels import KERNEL_BOOTSTRAP

    assert str(external_python()).startswith(str(root.resolve()))
    with tempfile.TemporaryDirectory(prefix="Open Doc offline ") as directory:
        manager = PythonEnvironments(directory)
        project = str(uuid4())
        python = manager.prepare_kernel(project)
        # InteractiveShell exercises IPython's native parsing and package magics
        # without requiring the test host to permit ZeroMQ sockets.
        code = (
            "from IPython.core.interactiveshell import InteractiveShell\nfrom IPython import get_ipython\nshell=InteractiveShell.instance()\n"
            + KERNEL_BOOTSTRAP
            + "\n"
            + """
for cell in ["value=41", "%pip --version", "!pip --version", "print(value+1)"]:
    result=shell.run_cell(cell)
    assert result.success
import sys,jedi,ipykernel
assert sys.prefix != sys.base_prefix
print('OFFLINE_RUNTIME_OK',sys.executable)
"""
        )
        result = run_external(
            [str(python), "-I", "-c", code], capture_output=True, text=True, timeout=60
        )
        assert result.returncode == 0, result.stdout + result.stderr
        assert "OFFLINE_RUNTIME_OK" in result.stdout
        assert "42" in result.stdout
        assert manager.prepare_kernel(project) == python
        assert manager.check(project)["compatible"]
        print(
            json.dumps(
                {
                    "success": True,
                    "runtime": str(root),
                    "python": str(python),
                    "offline": True,
                    "path_empty": True,
                    "ipython": result.stdout,
                }
            )
        )


if __name__ == "__main__":
    smoke(Path(sys.argv[1]))

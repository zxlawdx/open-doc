import os
import sys
from unittest.mock import Mock

import pytest

from apps.code.services import local_runtime


def test_frozen_child_environment_drops_bundled_paths(tmp_path, monkeypatch):
    bundled = tmp_path / "bundle"
    external = tmp_path / "python"
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(bundled), raising=False)
    monkeypatch.setenv("PYTHONHOME", str(bundled))
    monkeypatch.setenv("PYTHONPATH", str(bundled))
    monkeypatch.setenv("_PYI_APPLICATION_HOME_DIR", str(bundled))
    monkeypatch.setenv("LD_LIBRARY_PATH", str(bundled))
    monkeypatch.setenv("LD_LIBRARY_PATH_ORIG", str(external))
    monkeypatch.setenv("PATH", os.pathsep.join([str(bundled / "bin"), str(external)]))
    environment = local_runtime.child_environment()
    assert "PYTHONHOME" not in environment and "PYTHONPATH" not in environment
    assert "_PYI_APPLICATION_HOME_DIR" not in environment
    assert environment["LD_LIBRARY_PATH"] == str(external)
    assert environment["PATH"] == str(external)
    assert os.environ["PYTHONHOME"] == str(bundled)


def test_windows_dll_search_restores_original_even_when_spawn_fails(monkeypatch):
    import ctypes

    kernel = Mock()

    def get_directory(size, buffer):
        if buffer is not None:
            buffer.value = "original"
        return 8

    kernel.GetDllDirectoryW.side_effect = get_directory
    kernel.SetDllDirectoryW.return_value = 1
    with monkeypatch.context() as scoped:
        scoped.setattr(sys, "platform", "win32")
        scoped.setattr(sys, "frozen", True, raising=False)
        scoped.setattr(ctypes, "WinDLL", lambda *args, **kwargs: kernel, raising=False)
        with pytest.raises(OSError):
            with local_runtime.external_dll_search():
                raise OSError("spawn failed")
    assert [call.args for call in kernel.SetDllDirectoryW.call_args_list] == [
        (None,),
        ("original",),
    ]


def test_external_python_starts_without_parent_pythonhome(monkeypatch):
    monkeypatch.setenv("PYTHONHOME", "/nonexistent/parent/runtime")
    result = local_runtime.run_external(
        [sys.executable, "-I", "-c", "import sqlite3; print('ready')"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.stdout.strip() == "ready"

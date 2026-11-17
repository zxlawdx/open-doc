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


@pytest.mark.parametrize("versions", [("3.14.4",), ("3.14.4", "3.14.6")])
def test_windows_launcher_finds_native_python_with_spaces_and_ignores_alias(
    tmp_path, monkeypatch, versions
):
    import json
    from types import SimpleNamespace

    candidates = []
    for version in versions:
        executable = tmp_path / ("Python " + version) / "python.exe"
        executable.parent.mkdir()
        executable.touch()
        candidates.append(executable)
    launcher = tmp_path / "py.exe"
    launcher.touch()
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(
        local_runtime.shutil,
        "which",
        lambda name, **kw: str(launcher) if name == "py" else None,
    )
    # Windows launcher paths need drive prefixes; exercise parser with native
    # paths separately from filesystem probes on a Linux test host.
    original_search = __import__("re").search

    def search(pattern, line, flags=0):
        if ".exe" in line and line.startswith(" -V:"):
            return SimpleNamespace(group=lambda index: line.split(" * ", 1)[1])
        return original_search(pattern, line, flags)

    monkeypatch.setattr("re.search", search)

    def run(args, **kw):
        if args[1:] == ["-0p"]:
            return SimpleNamespace(
                stdout="\n".join(
                    " -V:" + version + " * " + str(path)
                    for version, path in zip(versions, candidates)
                )
            )
        index = [str(p) for p in candidates].index(args[0])
        return SimpleNamespace(
            stdout=json.dumps(
                dict(
                    path=args[0],
                    version=versions[index],
                    architecture=64,
                    venv=True,
                    pip=True,
                    scripts="/ENV/Scripts",
                )
            )
        )

    monkeypatch.setattr(local_runtime, "run_external", run)
    found = local_runtime.discover_pythons()
    assert [entry["version"] for entry in found] == list(versions)
    assert local_runtime.external_python() == candidates[0]

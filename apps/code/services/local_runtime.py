"""Launch external Python without inheriting a frozen application's runtime."""

import os
import shutil
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from threading import RLock

_spawn_lock = RLock()


def child_environment():
    environment = dict(os.environ)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    for key in list(environment):
        if key.startswith(("_PYI_", "PYINSTALLER_")) or key in {
            "PYTHONHOME",
            "PYTHONPATH",
        }:
            environment.pop(key, None)
    if "LD_LIBRARY_PATH_ORIG" in environment:
        environment["LD_LIBRARY_PATH"] = environment.pop("LD_LIBRARY_PATH_ORIG")
    elif getattr(sys, "frozen", False):
        environment.pop("LD_LIBRARY_PATH", None)
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        root = Path(bundled).resolve()
        environment["PATH"] = os.pathsep.join(
            value
            for value in environment.get("PATH", "").split(os.pathsep)
            if value and not Path(value).resolve().is_relative_to(root)
        )
    return environment


@contextmanager
def external_dll_search():
    # PyInstaller changes the Windows process DLL search directory. Reset only
    # around process creation, then restore it even if spawning fails.
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        yield
        return
    import ctypes

    with _spawn_lock:
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetDllDirectoryW.argtypes = [ctypes.c_uint32, ctypes.c_wchar_p]
        kernel.SetDllDirectoryW.argtypes = [ctypes.c_wchar_p]
        size = kernel.GetDllDirectoryW(0, None)
        buffer = ctypes.create_unicode_buffer(size + 1)
        kernel.GetDllDirectoryW(len(buffer), buffer)
        if not kernel.SetDllDirectoryW(None):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            yield
        finally:
            if not kernel.SetDllDirectoryW(buffer.value or None):
                raise ctypes.WinError(ctypes.get_last_error())


def popen_external(*args, **kwargs):
    kwargs.setdefault("env", child_environment())
    kwargs.update(hidden_process_options(kwargs.get("creationflags", 0)))
    with external_dll_search():
        return subprocess.Popen(*args, **kwargs)


def hidden_process_options(flags=0):
    """Keep subprocess output in the application, including windowed builds."""
    if sys.platform != "win32":
        return {}
    return {
        "creationflags": flags | getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    }


def run_external(
    args,
    *,
    capture_output=False,
    text=False,
    timeout=None,
    check=False,
    cwd=None,
    env=None,
    input=None,
):
    # Restore the parent's DLL search immediately after CreateProcess, before
    # waiting, so the GUI can continue loading its own runtime libraries.
    with popen_external(
        args,
        stdout=subprocess.PIPE if capture_output else None,
        stderr=subprocess.PIPE if capture_output else None,
        text=text,
        stdin=subprocess.PIPE if input is not None else None,
        cwd=cwd,
        env=env or child_environment(),
    ) as process:
        try:
            stdout, stderr = process.communicate(input=input, timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
            raise subprocess.TimeoutExpired(args, timeout, output=stdout, stderr=stderr)
        except BaseException:
            process.kill()
            process.wait()
            raise
        result = subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
        if check:
            result.check_returncode()
        return result


def discover_pythons(configured=None):
    """Probe actual executables; launcher aliases are never used as venv paths."""
    import json

    environment = child_environment()
    candidates = []
    from .embedded_runtime import embedded_tools

    internal = embedded_tools()
    if internal:
        candidates.append(str(internal["python"]))
    if configured:
        candidates.append(str(configured))
    if not getattr(sys, "frozen", False):
        candidates.append(sys.executable)
    for name in ("python3", "python", "python.exe"):
        candidate = shutil.which(name, path=environment.get("PATH"))
        if candidate:
            candidates.append(candidate)
    if sys.platform == "win32":
        launcher = shutil.which("py", path=environment.get("PATH"))
        if launcher:
            try:
                listed = run_external(
                    [launcher, "-0p"], capture_output=True, text=True, timeout=10
                )
                for line in (listed.stdout or "").splitlines():
                    # Both legacy `-3.x-64` and install-manager `-V:...` output.
                    import re

                    match = re.search(r"([A-Za-z]:[\\/].*?\.exe)\s*\*?\s*$", line, re.I)
                    if match:
                        candidates.append(match.group(1))
            except (OSError, subprocess.SubprocessError):
                pass
    probe = (
        "import sys,json,struct,sysconfig,importlib.util as u;"
        "print(json.dumps(dict(path=sys.executable,version=sys.version.split()[0],"
        "architecture=struct.calcsize('P')*8,venv=u.find_spec('venv') is not None,"
        "pip=u.find_spec('pip') is not None,platform=sys.platform,"
        "scripts=sysconfig.get_path('scripts',scheme='venv',vars={'base':'/ENV','platbase':'/ENV'}))))"
    )
    found, seen = [], set()
    for candidate in candidates:
        try:
            result = run_external(
                [candidate, "-I", "-c", probe],
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            item = json.loads(result.stdout)
            actual = Path(item["path"])
            key = os.path.normcase(os.path.abspath(actual))
            if not actual.is_file() or key in seen:
                continue
            if (
                getattr(sys, "frozen", False)
                and actual.resolve() == Path(sys.executable).resolve()
            ):
                continue
            seen.add(key)
            item["path"] = os.path.abspath(actual)
            found.append(item)
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
            continue
    return found


def external_python(configured=None):
    from .embedded_runtime import embedded_tools

    internal = embedded_tools()
    if internal and not configured:
        # A Store alias, broken Conda install or MSYS2 ahead of PATH must not
        # even be launched during default notebook/bootstrap operations.
        return Path(internal["python"])
    if not configured and not getattr(sys, "frozen", False):
        return Path(sys.executable)
    found = discover_pythons(configured)
    if configured:
        expected = Path(configured).resolve()
        found = [item for item in found if Path(item["path"]).resolve() == expected]
    if (
        sys.platform == "win32"
        and not configured
        and not any("runtime" in item["path"] for item in found)
    ):
        found.sort(key=lambda item: "Scripts" not in item.get("scripts", ""))
    for item in found:
        if item["venv"]:
            return Path(item["path"])
    raise ValueError(
        "Python com suporte a venv não encontrado. Selecione o executável Python "
        "nas Bibliotecas do projeto ou instale Python com venv."
    )


# Executed once in an external Python so its own children (venv/ensurepip,
# IPython shell magics and analysis helpers) also stay inside the application.
HIDDEN_CHILD_BOOTSTRAP = r"""
import os as _opendoc_os, subprocess as _opendoc_subprocess
if _opendoc_os.name == 'nt':
    class _OpenDocHiddenPopen(_opendoc_subprocess.Popen):
        def __init__(self, *args, **kwargs):
            kwargs['creationflags'] = kwargs.get('creationflags', 0) | _opendoc_subprocess.CREATE_NO_WINDOW
            super().__init__(*args, **kwargs)
    _opendoc_subprocess.Popen = _OpenDocHiddenPopen
"""

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
    with external_dll_search():
        return subprocess.Popen(*args, **kwargs)


def run_external(
    args,
    *,
    capture_output=False,
    text=False,
    timeout=None,
    check=False,
    cwd=None,
    env=None
):
    # Restore the parent's DLL search immediately after CreateProcess, before
    # waiting, so the GUI can continue loading its own runtime libraries.
    with popen_external(
        args,
        stdout=subprocess.PIPE if capture_output else None,
        stderr=subprocess.PIPE if capture_output else None,
        text=text,
        cwd=cwd,
        env=env or child_environment(),
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
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


def external_python():
    if not getattr(sys, "frozen", False):
        return Path(sys.executable)
    environment = child_environment()
    candidates = [
        shutil.which(name, path=environment.get("PATH"))
        for name in ("python3", "python")
    ]
    for candidate in candidates:
        if not candidate or Path(candidate).resolve() == Path(sys.executable).resolve():
            continue
        try:
            result = run_external(
                [candidate, "-I", "-c", "import sys; print(sys.executable)"],
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            actual = Path(result.stdout.strip())
            if actual.is_file() and actual.resolve() != Path(sys.executable).resolve():
                return actual
        except (OSError, subprocess.SubprocessError):
            continue
    raise ValueError(
        "Instale Python 3 e disponibilize o interpretador no PATH para usar código local."
    )

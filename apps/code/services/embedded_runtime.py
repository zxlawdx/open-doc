"""Verified application-owned portable Python; project packages live elsewhere."""

import hashlib
import json
import os
import sys
from functools import lru_cache
from pathlib import Path


def runtime_root():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "runtime"
    configured = os.environ.get("OPEN_DOC_RUNTIME_ROOT")
    return Path(configured).resolve() if configured else None


@lru_cache(maxsize=4)
def verify_runtime(root):
    manifest = root / "integrity.json"
    if not manifest.is_file():
        raise ValueError(
            "Runtime Python interno incompleto: manifesto de integridade ausente."
        )
    for name, expected in json.loads(manifest.read_text()).items():
        path = root / name
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Caminho inválido no manifesto do runtime.")
        if not path.is_file():
            raise ValueError("Arquivo ausente no runtime: " + name)
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != expected:
            raise ValueError(
                "Integridade do runtime falhou: " + name + ". Reinstale o Open Doc."
            )
    return root


def embedded_tools():
    root = runtime_root()
    if root is None:
        return None
    verify_runtime(root)
    python = root / "python" / ("python.exe" if os.name == "nt" else "bin/python3")
    uv = root / "uv" / ("uv.exe" if os.name == "nt" else "uv")
    if not python.is_file() or not uv.is_file():
        raise ValueError("Runtime Python interno incompleto. Reinstale o Open Doc.")
    return {"root": root, "python": python, "uv": uv}

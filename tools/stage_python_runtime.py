#!/usr/bin/env python3
"""Stage checksum-pinned portable CPython, uv and offline kernel wheels."""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.file_digest(path.open("rb"), "sha256").hexdigest()


def download(asset, target):
    urllib.request.urlretrieve(asset["url"], target)
    if digest(target) != asset["sha256"]:
        target.unlink()
        raise ValueError("Portable runtime checksum mismatch: " + asset["url"])


def unpack(archive, target):
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            for name in source.namelist():
                if not (target / name).resolve().is_relative_to(target.resolve()):
                    raise ValueError("Unsafe runtime archive member")
            source.extractall(target)
    else:
        with tarfile.open(archive) as source:
            source.extractall(target, filter="data")


def stage(bundle):
    if platform.machine().lower() not in {"amd64", "x86_64"}:
        raise ValueError("Only x64 portable runtimes are validated")
    key = "windows-x64" if os.name == "nt" else "linux-x64"
    manifest = json.loads((ROOT / "packaging/python-runtime.json").read_text())
    runtime = bundle / "runtime"
    if runtime.exists():
        raise ValueError("Refusing to overwrite an existing runtime: " + str(runtime))
    runtime.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as folder:
        temporary = Path(folder)
        for name, asset in manifest["platforms"][key].items():
            archive = temporary / (name + ".archive")
            download(asset, archive)
            target = runtime if name == "python" else temporary / "uv"
            target.mkdir(parents=True, exist_ok=True)
            unpack(archive, target)
            if name == "uv":
                binary = next(target.rglob("uv.exe" if os.name == "nt" else "uv"))
                (runtime / "uv").mkdir()
                shutil.copy2(binary, runtime / "uv" / binary.name)
                (runtime / "uv" / binary.name).chmod(0o755)
    python = runtime / "python" / ("python.exe" if os.name == "nt" else "bin/python3")
    result = subprocess.check_output(
        [
            str(python),
            "-I",
            "-c",
            'import sys,struct,json; print(json.dumps([sys.version.split()[0],struct.calcsize("P")*8]))',
        ],
        text=True,
    )
    if json.loads(result) != [manifest["python_version"], 64]:
        raise ValueError("Unexpected runtime Python version or architecture")
    wheels = runtime / "wheels"
    wheels.mkdir()
    lock = ROOT / "packaging/python-base.lock"
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "download",
            "--only-binary=:all:",
            "--require-hashes",
            "-r",
            str(lock),
            "-d",
            str(wheels),
        ],
        check=True,
    )
    shutil.copy2(lock, runtime / "python-base.lock")
    shutil.copy2(ROOT / "packaging/python-runtime.json", runtime / "sources.json")
    notices = runtime / "licenses"
    notices.mkdir()
    for name in ("LICENSE-MIT", "LICENSE-APACHE"):
        urllib.request.urlretrieve(
            "https://raw.githubusercontent.com/astral-sh/uv/"
            + manifest["uv_version"]
            + "/"
            + name,
            notices / ("uv-" + name),
        )
    files = {
        str(p.relative_to(runtime)).replace("\\", "/"): digest(p)
        for p in runtime.rglob("*")
        if p.is_file()
    }
    (runtime / "integrity.json").write_text(json.dumps(files, indent=2))
    print(
        json.dumps(
            {
                "runtime": str(runtime),
                "python": manifest["python_version"],
                "uv": manifest["uv_version"],
                "bytes": sum(
                    p.stat().st_size for p in runtime.rglob("*") if p.is_file()
                ),
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    stage(parser.parse_args().bundle.resolve())

"""Explicit execution of a trusted user script in a separate Python process."""

import os
import subprocess
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from time import monotonic, sleep

MAX_CODE = 24000
MAX_OUTPUT = 65536
TIMEOUT = 15


def export_csv(store, identifier, destination):
    destination = Path(destination).with_suffix(".csv")
    with NamedTemporaryFile(mode="w", encoding="utf-8", newline="", suffix=".csv",
                            dir=destination.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            count = store.write_csv(identifier, stream)
        except BaseException:
            stream.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return {"name": destination.name, "rows": count}


def run_python(store, identifier, code):
    if not isinstance(code, str) or not code.strip() or len(code) > MAX_CODE:
        raise ValueError("Informe um script Python de até 24 mil caracteres.")
    if getattr(sys, "frozen", False):
        raise ValueError("O Python local está disponível ao iniciar o Open Doc pelo interpretador.")
    with TemporaryDirectory(prefix="open-doc-python-") as directory:
        root = Path(directory)
        dataset, script, output = (root / name for name in ("dados.csv", "analise.py", "saida.txt"))
        with dataset.open("w", encoding="utf-8", newline="") as stream:
            write = getattr(store, "write_analysis_csv", store.write_csv)
            count = write(identifier, stream)
        script.write_text(code, encoding="utf-8")
        bootstrap = ("import runpy, sys; from pathlib import Path; "
                     "runpy.run_path(sys.argv[1], init_globals={'DATASET_CSV': Path(sys.argv[2])}, run_name='__main__')")
        with output.open("wb") as log:
            with subprocess.Popen(
                [sys.executable, "-I", "-B", "-u", "-X", "utf8", "-c", bootstrap, str(script), str(dataset)],
                cwd=root, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            ) as process:
                deadline = monotonic() + TIMEOUT
                stopped = None
                while process.poll() is None:
                    if os.fstat(log.fileno()).st_size > MAX_OUTPUT:
                        stopped = "output"
                    elif monotonic() > deadline:
                        stopped = "timeout"
                    if stopped:
                        process.kill()
                        break
                    sleep(.02)
                returncode = process.wait()
        with output.open("rb") as log:
            captured = log.read(MAX_OUTPUT + 1)
        if len(captured) > MAX_OUTPUT:
            stopped = stopped or "output"
        return {"output": captured[:MAX_OUTPUT].decode("utf-8", errors="replace").replace("\r\n", "\n"),
                "returncode": returncode, "stopped": stopped, "rows": count}

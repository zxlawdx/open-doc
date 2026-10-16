"""Optional real renderer. Never invoke a shell or download software."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def libreoffice_executable():
    for value in [
        "soffice",
        "libreoffice",
        r"C:\Program Files\LibreOffice\program\soffice.exe",
    ]:
        executable = shutil.which(value)
        if executable:
            return executable
    return None


def convert_to_pdf(executable, source):
    temporary = tempfile.TemporaryDirectory(prefix="open-doc-pptx-")
    directory = Path(temporary.name)
    try:
        profile = (directory / "profile").as_uri()
        subprocess.run(
            [
                executable,
                "-env:UserInstallation=" + profile,
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                str(directory),
                str(source),
            ],
            check=True,
            timeout=120,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        target = directory / (source.stem + ".pdf")
        if not target.is_file():
            raise RuntimeError("LibreOffice não gerou o preview.")
        return temporary, target
    except Exception:
        temporary.cleanup()
        raise

import os
import shutil
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


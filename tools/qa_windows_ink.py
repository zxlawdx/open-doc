"""Report real Windows Ink recognizer availability without installing anything."""

from __future__ import annotations

import json
import platform
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apps.open_doc.ink.windows_ink import WindowsInkBackend


def main() -> int:
    result = WindowsInkBackend().diagnostics("pt-BR")
    report = {
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "backend": result.get("backend"),
        "available": bool(result.get("available")),
        "pywinrt_installed": bool(result.get("pywinrt_installed")),
        "recognizers": result.get("recognizers", []),
        "recognizer": result.get("recognizer"),
        "language": result.get("language", "pt-BR"),
        "reason": result.get("reason", ""),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["available"]:
        print("WINDOWS_INK_PTBR_OK")
    elif sys.platform != "win32":
        print("WINDOWS_INK_SKIPPED_NOT_WINDOWS")
    elif not report["pywinrt_installed"]:
        print("Instalação opcional: python -m pip install -r requirements-windows-ink.txt")
    elif report["recognizers"]:
        print("Instale o recurso de escrita Português (Brasil) nas configurações de idioma do Windows.")
    else:
        print("Nenhum reconhecedor de escrita está instalado no Windows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

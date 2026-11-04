#!/usr/bin/env python
"""CLI do projeto Open Doc, seguindo o entrypoint gerado por vela startproject."""

from __future__ import annotations

import os
import sys
from pathlib import Path

# O Vela importa config.wsgi/config.settings pelo nome do módulo.
# Sem a raiz no início de sys.path, instalações Python com outro pacote
# chamado "config" podem ocultar o config/ deste projeto.
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))


def main() -> None:
    """Delega os comandos ao CLI oficial, sem implementar outro runtime."""
    os.chdir(BASE_DIR)
    os.environ.setdefault("PYWEBVIEW_GUI", "qt")
    os.environ.setdefault("QT_API", "pyqt5")

    from vela.cli.commands import CommandRunner

    result = CommandRunner().execute(sys.argv[1:])
    if isinstance(result, int):
        raise SystemExit(result)


if __name__ == "__main__":
    main()

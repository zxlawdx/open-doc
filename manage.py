"""
Módulo: manage.py.
Responsabilidade: encaminhar comandos ao CLI oficial do Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import os
import sys

from app.config import PROJECT_ROOT


def main() -> None:
    """Prepara fontes estáticas e delega comandos ao CommandRunner Vela."""
    os.chdir(PROJECT_ROOT)
    os.environ.setdefault("PYWEBVIEW_GUI", "qt")
    os.environ.setdefault("QT_API", "pyqt5")
    from tools.sync_frontend import sync_frontend
    from vela.cli.commands import CommandRunner

    if len(sys.argv) > 1 and sys.argv[1] in {"runapp", "collectstatic"}:
        sync_frontend()
    CommandRunner().execute(sys.argv[1:])


if __name__ == "__main__":
    main()

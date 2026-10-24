"""
Módulo: manage.py.
Responsabilidade: encaminhar comandos ao CLI oficial do Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import os
import sys

from apps.open_doc.services.preferences_service import PROJECT_ROOT


def main() -> None:
    """Delega comandos diretamente ao CommandRunner oficial do Vela."""
    os.chdir(PROJECT_ROOT)
    os.environ.setdefault("PYWEBVIEW_GUI", "qt")
    os.environ.setdefault("QT_API", "pyqt5")
    from vela.cli.commands import CommandRunner

    result = CommandRunner().execute(sys.argv[1:])
    if isinstance(result, int):
        raise SystemExit(result)


if __name__ == "__main__":
    main()

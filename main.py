"""
Módulo: main.py.
Responsabilidade: manter entrada curta para o bootstrap oficial Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from apps.open_doc.services.preferences_service import PROJECT_ROOT


def main() -> None:
    """Inicializa a aplicação exclusivamente por VelaApp.run."""
    paths = [Path(argument).absolute() for argument in sys.argv[1:]]
    os.chdir(PROJECT_ROOT)
    os.environ.setdefault("VELA_GUI", "qt")
    os.environ.setdefault("PYWEBVIEW_GUI", "qt")
    os.environ.setdefault("QT_API", "pyqt5")
    from config.wsgi import run

    run(paths)


if __name__ == "__main__":
    main()

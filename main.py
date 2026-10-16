"""
Módulo: main.py.
Responsabilidade: manter entrada curta para o bootstrap oficial Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import os

from app.config import PROJECT_ROOT


def main() -> None:
    """Inicializa a aplicação exclusivamente por VelaApp.run."""
    os.chdir(PROJECT_ROOT)
    os.environ.setdefault("PYWEBVIEW_GUI", "qt")
    os.environ.setdefault("QT_API", "pyqt5")
    from config.wsgi import run

    run()


if __name__ == "__main__":
    main()

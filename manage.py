#!/usr/bin/env python
"""CLI do projeto Open Doc, seguindo o entrypoint gerado por vela startproject."""

from __future__ import annotations

import inspect
import os
import sys
from pathlib import Path

# O Vela importa config.wsgi/config.settings pelo nome do módulo.
# Sem a raiz no início de sys.path, instalações Python com outro pacote
# chamado "config" podem ocultar o config/ deste projeto.
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))


def _require_compatible_vela() -> None:
    """Fail clearly when the installed framework predates this project's API.

    Older Vela releases misreport *any* missing application dependency as a
    missing config/wsgi.py, even when that file exists. Check the framework
    capabilities before delegating to its CLI, not by duplicating its code.
    """
    try:
        from vela.apps import AppConfig  # noqa: F401
        from vela.cli.collectstatic import collect_static
    except ModuleNotFoundError as exc:
        if exc.name and (exc.name == "vela" or exc.name.startswith("vela.")):
            _incompatible_vela(exc)
        raise
    if "asset_config" not in inspect.signature(collect_static).parameters:
        _incompatible_vela()


def _incompatible_vela(cause: Exception | None = None) -> None:
    pin = next(
        (
            line.strip()
            for line in (BASE_DIR / "requirements.txt").read_text(encoding="utf-8").splitlines()
            if line.strip().startswith("vela-framework @")
        ),
        "vela-framework",
    )
    raise SystemExit(
        "Vela Framework instalado é antigo ou incompatível com o Open Doc.\n"
        "O config/wsgi.py do projeto existe; não crie outro.\n"
        "Reinstale apenas a versão do Vela fixada no requirements.txt:\n"
        f'python -m pip install --upgrade --force-reinstall --no-deps "{pin}"'
    ) from cause


def main() -> None:
    """Delega os comandos ao CLI oficial, sem implementar outro runtime."""
    os.chdir(BASE_DIR)
    os.environ.setdefault("VELA_GUI", "qt")
    os.environ.setdefault("PYWEBVIEW_GUI", "qt")
    os.environ.setdefault("QT_API", "pyqt5")

    if sys.argv[1:2] in (["runapp"], ["collectstatic"]):
        _require_compatible_vela()

    from vela.cli.commands import CommandRunner

    result = CommandRunner().execute(sys.argv[1:])
    if isinstance(result, int):
        raise SystemExit(result)


if __name__ == "__main__":
    main()

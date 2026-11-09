"""Open Doc Vela composition entrypoint."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from vela.core.app import VelaApp

from apps.open_doc.app import OPEN_DOC_APP
from apps.open_doc.application.context import configure
from apps.open_doc.bridge import OpenDocBridge
from apps.open_doc.services.preferences_service import Config

LOGGER = logging.getLogger(__name__)


def create_app(
    workspace: Config | None = None, *, startup_path: Path | None = None,
    start_in_library: bool | None = None,
) -> VelaApp:
    """Configure application dependencies, then build the Vela runtime."""
    from tools.check_runtime_assets import check

    manifest = check()
    context = configure(workspace)
    context.assets = manifest
    context.start_in_library = workspace is None if start_in_library is None else start_in_library
    LOGGER.info(
        "Open Doc vendors: %s (%s)", manifest["versions"], manifest["build_hash"]
    )

    if startup_path is not None:
        try:
            result = context.documents.import_path(startup_path)
            if result.get("document"):
                context.start_in_library = False
        except (ValueError, OSError) as exc:
            LOGGER.warning("Abertura pelo sistema falhou: %s", exc)
            context.startup_error = (
                "Não foi possível abrir o arquivo solicitado pelo sistema. "
                "Verifique o formato e as permissões de leitura."
            )

    application = VelaApp(settings_module="config.settings", bridge_class=OpenDocBridge)
    application.register_app(OPEN_DOC_APP)
    return application


def run(paths: list[Path] | None = None) -> None:
    from subprocess import SubprocessError

    from apps.open_doc.services.file_associations import installed_executable, register

    if paths is None:
        paths = (
            [Path(argument) for argument in sys.argv[1:]]
            if getattr(sys, "frozen", False)
            else []
        )
    executable = installed_executable()
    if executable is not None:
        try:
            register(executable)
        except (ValueError, OSError, SubprocessError, KeyError) as exc:
            LOGGER.warning("Falha ao registrar Abrir com: %s", exc)
    if len(paths) > 1:
        LOGGER.warning("O Open Doc abre um arquivo por inicialização.")
    create_app(startup_path=paths[0] if paths else None).run()

"""Open Doc Vela composition entrypoint."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from vela.core.app import VelaApp

from apps.home.app import HOME_APP
from apps.documents.app import DOCUMENTS_APP
from apps.spreadsheets.app import SPREADSHEETS_APP
from apps.presentations.app import PRESENTATIONS_APP
from apps.pdf.app import PDF_APP
from apps.templates.app import TEMPLATES_APP
from apps.data.app import DATA_APP
from apps.code.app import CODE_APP
from config.composition import configure
from config.bridge import OpenDocBridge
from shared.services.preferences_service import Config

LOGGER = logging.getLogger(__name__)


def create_app(
    workspace: Config | None = None,
    *,
    startup_path: Path | None = None,
    start_in_library: bool | None = None,
) -> VelaApp:
    """Configure application dependencies, then build the Vela runtime."""
    from tools.check_runtime_assets import check

    manifest = check()
    context = configure(workspace)
    context.assets = manifest
    context.start_in_library = (
        workspace is None if start_in_library is None else start_in_library
    )
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

    application = VelaApp(
        settings_module="config.settings",
        bridge_class=OpenDocBridge,
        resource_directory=context.config.root / ".veladata" / "resources",
    )
    application.register_app(HOME_APP)
    application.register_app(DOCUMENTS_APP)
    application.register_app(SPREADSHEETS_APP)
    application.register_app(PRESENTATIONS_APP)
    application.register_app(PDF_APP)
    application.register_app(TEMPLATES_APP)
    application.register_app(DATA_APP)
    application.register_app(CODE_APP)
    from shared.services.workspace import ResourceWorkspace
    from apps.data.services.exchange import DatasetExchange

    context.resource_workspace = ResourceWorkspace(application)
    context.dataset_exchange = DatasetExchange(application, context.datasets)
    from apps.code.services.kernels import KernelSessions

    context.kernels = KernelSessions(context.config.root)
    application.lifecycle.on_shutdown(context.kernels.close)
    from apps.data.services.publications import DatasetPublications
    from apps.code.services.notebook import NotebookService

    context.publications = DatasetPublications(context.datasets, application.resources)
    context.dataset_exchange.publications = context.publications
    context.notebooks = NotebookService(context)
    application.lifecycle.on_shutdown(context.notebooks.close)
    return application


def run(paths: list[Path] | None = None) -> None:
    from subprocess import SubprocessError

    from shared.services.file_associations import installed_executable, register

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


def self_test():
    """Explicit --vela-project-test hook; never runs during a normal launch."""
    from apps.code.services.diagnostics import self_test as run_test

    run_test()

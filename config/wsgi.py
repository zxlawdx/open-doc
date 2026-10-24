"""Open Doc Vela composition entrypoint."""

from __future__ import annotations

import logging

from vela.core.app import VelaApp

from apps.open_doc.app import OPEN_DOC_APP
from apps.open_doc.application.context import configure
from apps.open_doc.bridge import OpenDocBridge
from apps.open_doc.services.preferences_service import Config

LOGGER = logging.getLogger(__name__)


def create_app(workspace: Config | None = None) -> VelaApp:
    """Configure application dependencies, then build the Vela runtime."""
    from tools.check_runtime_assets import check

    manifest = check()
    context = configure(workspace)
    context.assets = manifest
    LOGGER.info("Open Doc vendors: %s (%s)", manifest["versions"], manifest["build_hash"])

    application = VelaApp(settings_module="config.settings", bridge_class=OpenDocBridge)
    application.register_app(OPEN_DOC_APP)
    return application


def run() -> None:
    create_app().run()

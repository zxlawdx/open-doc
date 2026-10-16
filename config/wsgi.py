"""
Módulo: wsgi.py.
Responsabilidade: construir e executar VelaApp com o app Open Doc registrado.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

from vela.core.app import VelaApp

from apps.open_doc.bridge import OpenDocBridge
from apps.open_doc.services.preferences_service import Config
from apps.open_doc.services.container import configure

INSTALLED_APPS = ("apps.open_doc",)


def create_app(workspace: Config | None = None) -> VelaApp:
    """Constrói o runtime oficial do framework e registra o app Open Doc."""
    from bottle import BaseRequest
    from apps.open_doc.document_model.validate import MAX_MODEL_JSON_BYTES

    # Bottle defaults to 100 KiB for JSON; keep a separate bounded transport limit.
    BaseRequest.MEMFILE_MAX = MAX_MODEL_JSON_BYTES * 2 + 65536
    from tools.check_runtime_assets import check

    manifest = check()
    import logging

    logging.getLogger(__name__).info(
        "Open Doc vendors: %s (%s)", manifest["versions"], manifest["build_hash"]
    )
    configured = configure(workspace)
    configured.assets = manifest
    application = VelaApp(settings_module="config.settings", bridge_class=OpenDocBridge)
    for name in INSTALLED_APPS:
        application.register_app(name)
    return application


def run() -> None:
    """Entrega o ciclo de vida inteiro ao VelaApp."""
    create_app().run()

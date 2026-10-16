"""
Módulo: wsgi.py.
Responsabilidade: construir e executar VelaApp com o app Open Doc registrado.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

from vela.core.app import VelaApp

from app.bridge import OpenDocBridge
from app.config import Config
from app.runtime import configure
from tools.sync_frontend import sync_frontend

INSTALLED_APPS = ("apps.open_doc",)


def create_app(workspace: Config | None = None) -> VelaApp:
    """Constrói o runtime oficial do framework e registra o app Open Doc."""
    configure(workspace)
    sync_frontend()
    application = VelaApp(settings_module="config.settings", bridge_class=OpenDocBridge)
    for name in INSTALLED_APPS:
        application.register_app(name)
    return application


def run() -> None:
    """Entrega o ciclo de vida inteiro ao VelaApp."""
    create_app().run()

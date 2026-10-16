"""
Módulo: wsgi.py.
Responsabilidade: construir e executar VelaApp com o app Writer registrado.
Autor: Vela Writer Contributors
Criado em: 2026
"""

from __future__ import annotations

from vela.core.app import VelaApp

from app.bridge import WriterBridge
from app.config import Config
from app.runtime import configure
from tools.sync_frontend import sync_frontend

INSTALLED_APPS = ("apps.writer",)


def create_app(workspace: Config | None = None) -> VelaApp:
    """Constrói o runtime oficial do framework e registra o app Writer."""
    configure(workspace)
    sync_frontend()
    application = VelaApp(settings_module="config.settings", bridge_class=WriterBridge)
    for name in INSTALLED_APPS:
        application.register_app(name)
    return application


def run() -> None:
    """Entrega o ciclo de vida inteiro ao VelaApp."""
    create_app().run()

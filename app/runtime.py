"""
Módulo: runtime.py.
Responsabilidade: compartilhar serviços entre views, API e bridge do Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from threading import RLock

from app.config import Config
from app.editor import Editor
from app.file_organizer import FileOrganizer


@dataclass
class Services:
    """Agrupa dependências de uma instância da aplicação."""

    config: Config
    editor: Editor
    organizer: FileOrganizer
    token: str


_services: Services | None = None
_lock = RLock()


def configure(config: Config | None = None) -> Services:
    """Inicializa serviços explicitamente, com workspace substituível nos testes."""
    global _services
    with _lock:
        workspace = config or Config()
        _services = Services(
            workspace,
            Editor(workspace),
            FileOrganizer(workspace),
            secrets.token_urlsafe(),
        )
        return _services


def services() -> Services:
    """Retorna serviços inicializados pelo bootstrap do Vela."""
    with _lock:
        if _services is None:
            raise RuntimeError("Inicialize a aplicação com config.wsgi.create_app().")
        return _services

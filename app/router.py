"""
Módulo: router.py.
Responsabilidade: registrar rotas Bottle e a ponte de importação nativa.
Autor: Vela Writer Contributors
Criado em: 2026
"""

from __future__ import annotations

import secrets
from pathlib import Path
from typing import Any

from bottle import Bottle, HTTPError, request, response, static_file, template

from app.config import Config, PROJECT_ROOT
from app.file_organizer import FileOrganizer

TEMPLATE_ROOT = PROJECT_ROOT / "ui" / "templates"
STATIC_ROOT = PROJECT_ROOT / "ui" / "static"


def create_routes(config: Config) -> Bottle:
    """Cria rotas isoladas para o servidor Bottle do Vela."""
    application = Bottle()
    organizer = FileOrganizer(config)
    token = secrets.token_urlsafe()

    @application.hook("after_request")
    def security_headers() -> None:
        """Restringe recursos à origem local e evita cache de dados."""
        response.set_header("Cache-Control", "no-store")
        response.set_header("X-Content-Type-Options", "nosniff")
        response.set_header("X-Frame-Options", "DENY")
        response.set_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "font-src 'self'; img-src 'self' data:; connect-src 'self'; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        )

    @application.get("/")
    def workspace() -> str:
        """Renderiza a janela principal com templates locais."""
        return template("base", template_lookup=[str(TEMPLATE_ROOT)], token=token)

    @application.get("/static/<filepath:path>")
    def assets(filepath: str) -> Any:
        """Serve estáticos com proteção de caminhos do Bottle."""
        return static_file(filepath, root=str(STATIC_ROOT))

    @application.get("/writer/files")
    def files() -> dict[str, Any]:
        """Lista documentos organizados sem expor caminhos absolutos."""
        return {"files": organizer.list_files()}

    @application.get("/writer/settings")
    def settings() -> dict[str, bool]:
        """Consulta as preferências persistentes."""
        try:
            return config.load_settings()
        except (ValueError, OSError) as exc:
            raise HTTPError(500, "Não foi possível ler as preferências.") from exc

    @application.post("/writer/settings")
    def save_settings() -> dict[str, bool]:
        """Atualiza preferências autenticadas pelo token da janela."""
        supplied = request.get_header("X-Writer-Token", "")
        if not secrets.compare_digest(supplied, token):
            raise HTTPError(403, "Token inválido.")
        data = request.json
        if not isinstance(data, dict):
            raise HTTPError(400, "Esperado objeto JSON.")
        try:
            config.save_settings(data)
        except ValueError as exc:
            raise HTTPError(400, str(exc)) from exc
        except OSError as exc:
            raise HTTPError(500, "Não foi possível gravar as preferências.") from exc
        return {"ok": True}

    return application


class DesktopBridge:
    """Expõe apenas a importação por seletor nativo ao JavaScript."""

    def __init__(self, config: Config) -> None:
        """Prepara o organizador; a janela é associada pelo launcher."""
        self._organizer = FileOrganizer(config)
        self._window: Any = None

    def import_document(self) -> dict[str, Any]:
        """Importa uma cópia do arquivo escolhido pelo usuário."""
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        paths = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=("Documentos (*.pdf;*.docx;*.pptx;*.md;*.txt)",),
        )
        if not paths:
            return {"cancelled": True}
        try:
            target = self._organizer.organize(Path(paths[0]))
            return {"name": target.name}
        except (ValueError, OSError, UnicodeError):
            return {"error": "Não foi possível importar. Confira o formato e acesso."}

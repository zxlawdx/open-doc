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

from apps.open_doc.services.preferences_service import Config
from .export_service import ExportService
from .font_service import FontService
from apps.open_doc.services.document_service import Editor
from apps.open_doc.services.import_service import FileOrganizer


@dataclass
class Services:
    """Agrupa dependências de uma instância da aplicação."""

    config: Config
    editor: Editor
    organizer: FileOrganizer
    token: str
    exports: ExportService | None = None
    fonts: FontService | None = None
    fixed_documents: object = None
    handwriting: object = None


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
        _services.fonts = FontService(workspace)
        _services.exports = ExportService(_services.editor, workspace)
        _services.exports.fonts = _services.fonts
        from .fixed_document_service import FixedDocumentService
        from ..ink.handwriting import HandwritingService
        from ..ink.windows_ink import WindowsInkBackend
        from ..ink.paddle_ocr import PaddleOcrBackend

        _services.fixed_documents = FixedDocumentService(
            _services.editor, workspace, _services.fonts
        )
        _services.handwriting = HandwritingService(
            [WindowsInkBackend(), PaddleOcrBackend(workspace)]
        )
        _services.fixed_documents.handwriting = _services.handwriting
        return _services


def services() -> Services:
    """Retorna serviços inicializados pelo bootstrap do Vela."""
    with _lock:
        if _services is None:
            raise RuntimeError("Inicialize a aplicação com config.wsgi.create_app().")
        return _services

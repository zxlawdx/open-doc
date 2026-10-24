from __future__ import annotations

import secrets
from dataclasses import dataclass
from threading import RLock
from typing import Any

from apps.open_doc.services.document_service import Editor
from apps.open_doc.services.export_service import ExportService
from apps.open_doc.services.font_service import FontService
from apps.open_doc.services.import_service import FileOrganizer
from apps.open_doc.services.preferences_service import Config


@dataclass(slots=True)
class ApplicationContext:
    """All application-scoped dependencies for one Open Doc runtime."""

    config: Config
    editor: Editor
    organizer: FileOrganizer
    token: str
    exports: ExportService
    fonts: FontService
    fixed_documents: Any
    handwriting: Any
    documents: Any = None
    assets: Any = None


_context: ApplicationContext | None = None
_lock = RLock()


def configure(config: Config | None = None) -> ApplicationContext:
    global _context
    with _lock:
        workspace = config or Config()
        editor = Editor(workspace)
        organizer = FileOrganizer(workspace)
        fonts = FontService(workspace)
        exports = ExportService(editor, workspace)
        exports.fonts = fonts

        from apps.open_doc.ink.handwriting import HandwritingService
        from apps.open_doc.ink.paddle_ocr import PaddleOcrBackend
        from apps.open_doc.ink.windows_ink import WindowsInkBackend
        from apps.open_doc.services.fixed_document_service import FixedDocumentService

        fixed_documents = FixedDocumentService(editor, workspace, fonts)
        handwriting = HandwritingService(
            [WindowsInkBackend(), PaddleOcrBackend(workspace)]
        )
        fixed_documents.handwriting = handwriting
        _context = ApplicationContext(
            config=workspace,
            editor=editor,
            organizer=organizer,
            token=secrets.token_urlsafe(),
            exports=exports,
            fonts=fonts,
            fixed_documents=fixed_documents,
            handwriting=handwriting,
        )
        from apps.open_doc.application.document_application import DocumentApplication

        _context.documents = DocumentApplication(_context)
        return _context


def get_context() -> ApplicationContext:
    with _lock:
        if _context is None:
            raise RuntimeError("Inicialize a aplicação com config.wsgi.create_app().")
        return _context

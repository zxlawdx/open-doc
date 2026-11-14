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
    workbooks: Any = None
    datasets: Any = None
    data_tools: Any = None
    code_tools: Any = None
    resource_workspace: Any = None
    dataset_exchange: Any = None
    templates: Any = None
    documents: Any = None
    assets: Any = None
    start_in_library: bool = False
    startup_error: str | None = None


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
        context = ApplicationContext(
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

        from apps.open_doc.spreadsheets.store import Workbooks

        from apps.data.services.store import Datasets

        context.workbooks = Workbooks(editor)
        context.datasets = Datasets(workspace.root)
        context.datasets.initialize()
        from shared.contracts.data import DataTools, CodeTools
        from apps.data.services.worksheet import WorksheetSnapshot
        from apps.code.services.python_runner import export_csv, run_python

        context.data_tools = DataTools(WorksheetSnapshot, export_csv)
        from apps.code.services.python_envs import PythonEnvironments
        from apps.code.services.python_analysis import environment

        context.code_tools = CodeTools(
            run_python, PythonEnvironments, environment.cache_clear
        )
        from apps.open_doc.application.personal_templates import Templates

        context.documents = DocumentApplication(context)
        context.templates = Templates(context)
        _context = context
        from shared.contracts.workspace import bind_workspace

        bind_workspace(get_context)
        return context


def get_context() -> ApplicationContext:
    with _lock:
        if _context is None:
            raise RuntimeError("Inicialize a aplicação com config.wsgi.create_app().")
        return _context

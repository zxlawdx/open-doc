from __future__ import annotations

import secrets
from dataclasses import dataclass
from threading import RLock
from typing import Any

from apps.documents.services.document_service import Editor
from apps.documents.services.export_service import ExportService
from shared.services.font_service import FontService
from shared.services.import_service import FileOrganizer
from shared.services.preferences_service import Config


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
    kernels: Any = None
    notebooks: Any = None
    publications: Any = None
    resource_workspace: Any = None
    dataset_exchange: Any = None
    templates: Any = None
    documents: Any = None
    assets: Any = None
    template_catalog: Any = None
    workbook_templates: Any = None
    spreadsheet_io: Any = None
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

        from shared.services.ink.handwriting import HandwritingService
        from shared.services.ink.paddle_ocr import PaddleOcrBackend
        from shared.services.ink.windows_ink import WindowsInkBackend
        from shared.services.fixed_document_service import FixedDocumentService

        from shared.contracts.formats import FixedFormats
        from apps.pdf.services.service import PdfService
        from apps.pdf.services.security import validated_pdf
        from apps.pdf.services.native_edit import PdfNativeEditor
        from apps.pdf.services.exporter import export_pdf
        from apps.presentations.services.service import PresentationService
        from apps.presentations.services.preview import (
            convert_to_pdf,
            libreoffice_executable,
        )
        from apps.presentations.services.native_importer import read_editable_deck
        from apps.presentations.services.exporter import export_pptx

        formats = FixedFormats(
            PdfService,
            validated_pdf,
            PresentationService,
            convert_to_pdf,
            libreoffice_executable,
            read_editable_deck,
            export_pptx,
            PdfNativeEditor,
        )
        exports.pdf_export = export_pdf
        editor.autosave_seconds = 30
        fixed_documents = FixedDocumentService(editor, workspace, fonts, formats)
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
        from shared.services.document_application import DocumentApplication

        from apps.spreadsheets.services.store import Workbooks

        from apps.data.services.store import Datasets

        context.workbooks = Workbooks(editor)
        context.datasets = Datasets(workspace.root)
        context.datasets.initialize()
        from shared.contracts.data import DataTools, CodeTools
        from apps.data.services.worksheet import WorksheetSnapshot
        from apps.code.services.python_runner import export_csv, run_python

        from apps.data.services.interchange import import_files, export_file

        context.data_tools = DataTools(
            WorksheetSnapshot, export_csv, import_files, export_file
        )
        from apps.code.services.python_envs import PythonEnvironments
        from apps.code.services.python_analysis import environment

        context.code_tools = CodeTools(
            run_python, PythonEnvironments, environment.cache_clear
        )
        from apps.templates.services.personal_templates import Templates

        from types import SimpleNamespace
        from apps.templates.services import template_catalog
        from apps.spreadsheets.services import templates as workbook_templates
        from apps.spreadsheets.services.files import read
        from apps.spreadsheets.services.objects import media_directory
        from apps.documents.services.document_service import AUTOSAVE_SECONDS

        editor.autosave_seconds = AUTOSAVE_SECONDS
        context.template_catalog = template_catalog
        context.workbook_templates = workbook_templates
        context.spreadsheet_io = SimpleNamespace(
            read=read, media_directory=media_directory
        )
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

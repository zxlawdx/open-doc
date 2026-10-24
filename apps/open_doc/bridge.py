"""Thin native boundary between JavaScript/WebView and application use cases."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from vela.core.bridge import BaseBridge

from apps.open_doc.application.context import get_context
from apps.open_doc.services.export_service import ExportError

LOGGER = logging.getLogger(__name__)


class OpenDocBridge(BaseBridge):
    def __init__(self, router: Any = None, config: dict[str, Any] | None = None) -> None:
        super().__init__(router=router, config=config)
        self._window: Any = None

    @property
    def _documents(self):
        return get_context().documents

    def _attach_window(self, window: Any) -> None:
        super()._attach_window(window)
        self._window = window
        window.confirm_close = False

    def get_bootstrap(self) -> dict[str, Any]:
        try:
            return self._documents.bootstrap()
        except (OSError, ValueError):
            return {"error": "Não foi possível ler o workspace."}

    def import_document(self) -> dict[str, Any]:
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
            return self._documents.import_path(Path(paths[0]))
        except (ValueError, OSError, UnicodeError):
            return {
                "error": "Não foi possível abrir/importar este documento. O arquivo original foi preservado."
            }

    def get_font_catalog(self):
        return self._documents.font_catalog()

    def set_dirty(self, dirty: bool) -> dict[str, bool]:
        if type(dirty) is not bool:
            raise ValueError("Estado de edição inválido.")
        if self._window is not None:
            self._window.confirm_close = dirty
        return {"ok": True}

    def export_document(self, document_id, revision, file_format):
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        try:
            descriptor = self._documents.export_descriptor(document_id, file_format)
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(descriptor["directory"]),
                save_filename=descriptor["filename"],
                file_types=(f"Documento (*.{file_format})",),
            )
            if not paths:
                return {"cancelled": True}
            destination = paths if isinstance(paths, str) else paths[0]
            return self._documents.export_to(
                document_id, revision, file_format, Path(destination)
            )
        except Exception as exc:
            LOGGER.exception("Falha de exportação nativa")
            return {
                "error": (
                    str(exc)
                    if isinstance(exc, ExportError)
                    else "Não foi possível exportar o documento. Seu conteúdo continua salvo."
                )
            }

    def import_font(self):
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        try:
            paths = self._window.create_file_dialog(
                webview.FileDialog.OPEN,
                allow_multiple=True,
                file_types=("Fontes (*.ttf;*.otf;*.ttc)",),
            )
            return (
                self._documents.import_fonts([Path(path) for path in paths])
                if paths
                else {"cancelled": True}
            )
        except Exception:
            return {
                "error": "Não foi possível importar a fonte. Verifique se é um arquivo TTF, OTF ou TTC válido."
            }

    def remove_font(self, font_id):
        try:
            return self._documents.remove_font(font_id)
        except Exception:
            return {"error": "Não foi possível remover a fonte importada."}

    def recognize_handwriting(self, strokes, language="pt-BR"):
        try:
            return self._documents.recognize_handwriting(strokes, language=language)
        except Exception as exc:
            return {"error": str(exc)}

    def handwriting_capabilities(self):
        return self._documents.handwriting_capabilities()

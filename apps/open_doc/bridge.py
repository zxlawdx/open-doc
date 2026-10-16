"""
Módulo: bridge.py.
Responsabilidade: estender a bridge Vela com bootstrap e seletor nativo.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from vela.core.bridge import BaseBridge

from apps.open_doc.api import bootstrap
from apps.open_doc.services.container import services


class OpenDocBridge(BaseBridge):
    """Preserva navegação, eventos e lifecycle do BaseBridge do Vela."""

    def __init__(
        self, router: Any = None, config: dict[str, Any] | None = None
    ) -> None:
        """Inicializa a bridge pelo construtor usado pelo VelaApp."""
        super().__init__(router=router, config=config)
        self._window: Any = None

    def _attach_window(self, window: Any) -> None:
        super()._attach_window(window)
        self._window = window
        window.confirm_close = False

    def get_bootstrap(self) -> dict[str, Any]:
        """Carrega documento ativo, preferências e credencial da janela."""
        try:
            return bootstrap()
        except (OSError, ValueError):
            return {"error": "Não foi possível ler o workspace."}

    def import_document(self) -> dict[str, Any]:
        """Importa pelo seletor nativo sem alterar o documento original."""
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
            target = services().organizer.organize(Path(paths[0]))
            if target.suffix.lower() == ".docx":
                services().fixed_documents.activate("rich")
                return {
                    "name": target.name,
                    "document": services().editor.import_docx(target),
                    "opened": True,
                }
            if target.suffix.lower() in {".pdf", ".pptx"}:
                service = services().fixed_documents
                note = (
                    service.import_pdf(target)
                    if target.suffix.lower() == ".pdf"
                    else service.import_pptx(target)
                )
                return {
                    "name": target.name,
                    "document": note,
                    "opened": True,
                    "view": (
                        "pdf" if target.suffix.lower() == ".pdf" else "presentation"
                    ),
                }
            services().fixed_documents.activate("rich")
            return {"name": target.name}
        except (ValueError, OSError, UnicodeError):
            return {
                "error": "Não foi possível abrir/importar este documento. O arquivo original foi preservado."
            }

    def get_font_catalog(self):
        return services().fonts.reload()

    def set_dirty(self, dirty: bool) -> dict[str, bool]:
        """Ativa confirmação nativa sem executar JavaScript no evento de fechar."""
        if type(dirty) is not bool:
            raise ValueError("Estado de edição inválido.")
        if self._window is not None:
            self._window.confirm_close = dirty
        return {"ok": True}

    def export_document(self, document_id, revision, file_format):
        """O destino só pode ser escolhido pelo seletor nativo."""
        import logging
        import webview
        from .services.export_service import ExportError, EXTENSIONS, safe_stem

        if self._window is None:
            return {"error": "Janela indisponível."}
        if not isinstance(file_format, str) or file_format not in (
            EXTENSIONS | {"pptx"}
        ):
            return {"error": "Formato de exportação inválido."}
        try:
            service = services().exports
            fixed = services().fixed_documents.exists(document_id)
            if fixed:
                note = services().fixed_documents.get(document_id)
                if file_format not in (
                    ["pdf"] if note["source_kind"] == "pdf" else ["pdf", "pptx"]
                ):
                    return {
                        "error": "Exporte este documento como PDF ou PPTX compatível."
                    }
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(service.default_export_directory()),
                save_filename=(
                    (safe_stem(note["title"]) + "." + file_format)
                    if fixed
                    else service.suggest_filename(document_id, file_format)
                ),
                file_types=(f"Documento (*.{file_format})",),
            )
            if not paths:
                return {"cancelled": True}
            destination = paths if isinstance(paths, str) else paths[0]
            return (services().fixed_documents if fixed else service).export(
                document_id, revision, file_format, Path(destination)
            )
        except Exception as exc:
            logging.getLogger(__name__).exception("Falha de exportação nativa")
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
                services().fonts.import_files([Path(path) for path in paths])
                if paths
                else {"cancelled": True}
            )
        except Exception:
            return {
                "error": "Não foi possível importar a fonte. Verifique se é um arquivo TTF, OTF ou TTC válido."
            }

    def remove_font(self, font_id):
        try:
            return services().fonts.remove(font_id)
        except Exception:
            return {"error": "Não foi possível remover a fonte importada."}

    def recognize_handwriting(self, strokes, language="pt-BR"):
        import asyncio
        from dataclasses import asdict

        try:
            return asdict(
                asyncio.run(
                    services().handwriting.recognize(strokes, language=language)
                )
            )
        except Exception as exc:
            return {"error": str(exc)}

    def handwriting_capabilities(self):
        return {"backends": services().handwriting.capabilities()}

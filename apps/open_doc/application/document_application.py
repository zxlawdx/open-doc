from __future__ import annotations

import asyncio
import base64
import io
import re
from dataclasses import asdict
from pathlib import Path
from typing import Any

from PIL import Image

from apps.open_doc.infrastructure.workspace import WorkspacePathResolver
from apps.open_doc.services.document_service import AUTOSAVE_SECONDS
from apps.open_doc.services.export_service import EXTENSIONS, ExportError, safe_stem


class DocumentApplication:
    """Use-case facade shared by HTTP controllers and the native bridge."""

    def __init__(self, context: Any) -> None:
        self.context = context
        self.workspace = WorkspacePathResolver(context.config.root)

    def bootstrap(self) -> dict[str, Any]:
        fixed = self.context.fixed_documents
        return {
            "token": self.context.token,
            "settings": self.context.config.load_settings(),
            "document": (
                fixed.current() if fixed.active_kind() != "rich" else None
            )
            or self.context.editor.current(),
            "autosave_seconds": AUTOSAVE_SECONDS,
            "assets": self.context.assets,
        }

    def list_library(self) -> dict[str, Any]:
        return {
            "files": self.context.organizer.list_files(),
            "documents": self.context.editor.list_documents()
            + self.context.fixed_documents.list_documents(),
        }

    def save_settings(self, settings: Any) -> dict[str, bool]:
        self.context.config.save_settings(settings)
        return {"ok": True}

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        self.context.fixed_documents.activate("rich")
        if data.get("content_format") == "opendoc-rich-v1":
            return self.context.editor.create_rich_copy(
                data["title"], data["content"], data.get("source_id")
            )
        return self.context.editor.create(
            data.get("title", "Sem título"), data.get("markdown", "")
        )

    def open(self, data: dict[str, Any]) -> dict[str, Any]:
        """Open an existing internal document or a file already in the workspace.

        Opening a library file must never copy it again. External native-picker
        imports use :meth:`import_path`, which is a distinct use case and does
        organize/copy the selected source into the workspace first.
        """
        identifier = data.get("id")
        if identifier is not None:
            if self.context.fixed_documents.exists(identifier):
                return self.context.fixed_documents.select(identifier)
            self.context.fixed_documents.activate("rich")
            return self.context.editor.select(identifier)
        resolved = self.workspace.resolve_document(data.get("path"))
        return self._open_workspace_path(resolved)

    def _open_workspace_path(self, path: Path) -> dict[str, Any]:
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            return self.context.fixed_documents.import_pdf(path)
        if suffix == ".pptx":
            return self.context.fixed_documents.import_pptx(path)
        self.context.fixed_documents.activate("rich")
        if suffix == ".docx":
            return self.context.editor.import_docx(path)
        if suffix in {".md", ".txt"}:
            return self.context.editor.import_note(path)
        raise ValueError("Formato não suportado.")

    def import_path(self, path: Path) -> dict[str, Any]:
        """Import an external file, copying it into the managed workspace."""
        target = self.context.organizer.organize(Path(path))
        suffix = target.suffix.lower()
        if suffix == ".docx":
            self.context.fixed_documents.activate("rich")
            return {
                "name": target.name,
                "document": self.context.editor.import_docx(target),
                "opened": True,
                "view": "rich",
            }
        if suffix == ".pdf":
            return {
                "name": target.name,
                "document": self.context.fixed_documents.import_pdf(target),
                "opened": True,
                "view": "pdf",
            }
        if suffix == ".pptx":
            return {
                "name": target.name,
                "document": self.context.fixed_documents.import_pptx(target),
                "opened": True,
                "view": "presentation",
            }
        if suffix in {".md", ".txt"}:
            self.context.fixed_documents.activate("rich")
            return {
                "name": target.name,
                "document": self.context.editor.import_note(target),
                "opened": True,
                "view": "rich",
            }
        raise ValueError("Formato não suportado.")

    def save(self, data: dict[str, Any]) -> dict[str, Any]:
        if data.get("content_format") == "opendoc-fixed-v1":
            return self.context.fixed_documents.save(
                data["id"], data["title"], data["content"], data["revision"]
            )
        return self.context.editor.save(
            data["id"],
            data["title"],
            data.get("markdown", ""),
            data["revision"],
            data.get("content"),
            data.get("content_format", "markdown"),
        )

    def recover(self, data: dict[str, Any]) -> dict[str, Any]:
        identifier = data["id"]
        if self.context.fixed_documents.exists(identifier):
            return self.context.fixed_documents.recovery(
                identifier,
                data.get("title", ""),
                data.get("content"),
                data.get("revision", 0),
                data.get("discard", False),
            )
        if data.get("discard"):
            return self.context.editor.discard_recovery(identifier)
        return self.context.editor.stash_recovery(
            identifier,
            data["title"],
            data.get("markdown", ""),
            data["revision"],
            data.get("content"),
            data.get("content_format", "markdown"),
        )

    def rename(self, data: dict[str, Any]) -> dict[str, Any]:
        service = (
            self.context.fixed_documents
            if self.context.fixed_documents.exists(data["id"])
            else self.context.editor
        )
        return service.rename(data["id"], data["title"], data["revision"])

    def delete(self, data: dict[str, Any]) -> dict[str, Any]:
        if data.get("confirmed") is not True:
            raise ValueError("Confirme a exclusão do documento interno.")
        service = (
            self.context.fixed_documents
            if self.context.fixed_documents.exists(data["id"])
            else self.context.editor
        )
        return service.delete(data["id"], data["revision"])

    def duplicate(self, identifier: str) -> dict[str, Any]:
        service = (
            self.context.fixed_documents
            if self.context.fixed_documents.exists(identifier)
            else self.context.editor
        )
        return service.duplicate(identifier)

    def export_descriptor(self, document_id: str, file_format: str) -> dict[str, Any]:
        if not isinstance(file_format, str) or file_format not in (EXTENSIONS | {"pptx"}):
            raise ExportError("Formato de exportação inválido.")
        fixed = self.context.fixed_documents.exists(document_id)
        if fixed:
            note = self.context.fixed_documents.get(document_id)
            allowed = ["pdf"] if note["source_kind"] == "pdf" else ["pptx"]
            if file_format not in allowed:
                raise ExportError("Exporte este documento como PDF ou PPTX compatível.")
            filename = safe_stem(note["title"]) + "." + file_format
        else:
            filename = self.context.exports.suggest_filename(document_id, file_format)
        return {
            "fixed": fixed,
            "directory": self.context.exports.default_export_directory(),
            "filename": filename,
        }

    def export_to(
        self, document_id: str, revision: int, file_format: str, destination: Path
    ) -> dict[str, Any]:
        service = (
            self.context.fixed_documents
            if self.context.fixed_documents.exists(document_id)
            else self.context.exports
        )
        return service.export(document_id, revision, file_format, Path(destination))

    def export_temporary(self, data: dict[str, Any], filename: str) -> dict[str, Any]:
        return self.context.exports.export(
            data["id"],
            data["revision"],
            data["format"],
            self.context.exports.default_export_directory() / filename,
        )

    def media_url(self, document_id: str, media_id: str) -> dict[str, str]:
        document = self.context.editor.get(document_id)
        if (
            not isinstance(media_id, str)
            or not re.fullmatch("[a-f0-9]{64}", media_id)
            or media_id not in document.get("content", {}).get("media", {})
        ):
            raise ValueError("Imagem inválida.")
        blob = (
            self.context.editor.package_directory(document["id"]) / "media" / media_id
        ).read_bytes()
        with Image.open(io.BytesIO(blob)) as image:
            kind = image.format.lower()
        return {
            "url": f"data:image/{kind};base64," + base64.b64encode(blob).decode()
        }

    def artifact_source(self, identifier: str, preview: bool = False) -> Path:
        return self.context.fixed_documents.source(identifier, preview)

    def font_catalog(self):
        return self.context.fonts.reload()

    def import_fonts(self, paths: list[Path]):
        return self.context.fonts.import_files(paths)

    def remove_font(self, font_id: str):
        return self.context.fonts.remove(font_id)

    def recognize_handwriting(
        self, strokes: Any, language: str = "pt-BR"
    ) -> dict[str, Any]:
        return asdict(
            asyncio.run(self.context.handwriting.recognize(strokes, language=language))
        )

    def handwriting_capabilities(self) -> dict[str, Any]:
        return {"backends": self.context.handwriting.capabilities()}

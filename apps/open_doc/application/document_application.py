from __future__ import annotations

import asyncio
import base64
import io
import re
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from PIL import Image

from apps.open_doc.application import template_catalog
from apps.open_doc.spreadsheets import templates as workbook_templates
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
            "start_in_library": self.context.start_in_library,
            "startup_error": self.context.startup_error,
        }

    def list_library(self) -> dict[str, Any]:
        personal = self.context.templates.personal()
        workbooks = [book for book in self.context.workbooks.list() if book["id"] not in personal]
        return {
            "files": self.context.organizer.list_files() + [
                {"id": book["id"], "name": book["title"], "type": "xlsx",
                 "workbook": True, "capabilities": {"open": True}}
                for book in workbooks if book["imported"]
            ],
            "templates": [asdict(template) for template in template_catalog.CATALOG] + workbook_templates.catalog() + [
                {**item, "category": "Meus templates", "sections": []} for item in personal.values()
            ],
            "documents": sorted(
                [item for item in self.context.editor.list_documents() + self.context.fixed_documents.list_documents()
                 if item["id"] not in personal] + workbooks,
                key=lambda document: document["updated_at"],
                reverse=True,
            ),
        }

    def create_from_template(self, identifier: str) -> dict[str, Any]:
        personal = self.context.templates.personal().get(identifier)
        if personal:
            return self.context.templates.create(personal)
        template = next((item for item in template_catalog.CATALOG if item.id == identifier), None)
        if template is None:
            raise ValueError("Modelo não encontrado.")
        if template.format == "docx":
            return self.create({
                "title": template.title, "content_format": "opendoc-rich-v1",
                "content": template_catalog.rich_document(template),
            })
        if template.format == "pptx":
            return self.context.fixed_documents.create_presentation(
                template.title, deck=template_catalog.presentation(template),
            )
        with TemporaryDirectory(dir=self.context.config.root) as directory:
            source = Path(directory) / (template.title + ".pdf")
            template_catalog.write_pdf(template, source)
            return self.context.fixed_documents.import_pdf(source)

    def save_settings(self, settings: Any) -> dict[str, bool]:
        self.context.config.save_settings(settings)
        return {"ok": True}

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        if data.get("content_format") == "opendoc-presentation-v1":
            return self.context.fixed_documents.create_presentation(
                data.get("title", "Nova apresentação")
            )
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

    def versions(self, data: dict[str, Any]) -> dict[str, Any]:
        identifier = data["id"]
        fixed = self.context.fixed_documents.exists(identifier)
        operation = data["operation"]
        result = self.context.editor.versions(
            identifier, operation, fixed=fixed, version_id=data.get("version_id"),
            revision=data.get("revision"), name=data.get("name"), slide_index=data.get("slide_index"),
        )
        if operation in {"restore", "restore_slide"}:
            service = self.context.fixed_documents if fixed else self.context.editor
            result["document"] = service.get(identifier)
        return result

    def save_pdf_view(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.context.fixed_documents.save_pdf_view(data["id"], data["view"])

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

    def export_native_pdf_edit(
        self, document_id: str, revision: int, operation: dict, destination: Path
    ) -> dict[str, Any]:
        """Native PDF edit use case; never use the annotation overlay exporter."""
        if not self.context.fixed_documents.exists(document_id):
            raise ValueError("Selecione primeiro um documento PDF importado.")
        return self.context.fixed_documents.export_native_pdf_edit(
            document_id, revision, operation, Path(destination)
        )

    def export_selected_slide(
        self, document_id: str, revision: int, slide_index: int, destination: Path
    ) -> dict[str, Any]:
        """Export a native editable single-slide PPTX via the fixed-document service."""
        if not self.context.fixed_documents.exists(document_id):
            raise ValueError("Selecione uma apresentação PPTX editável.")
        return self.context.fixed_documents.export_selected_slide(
            document_id, revision, slide_index, Path(destination)
        )

    def extract_pdf_pages(
        self, document_id: str, revision: int, first_page: int, last_page: int,
        destination: Path,
    ) -> dict[str, Any]:
        if not self.context.fixed_documents.exists(document_id):
            raise ValueError("Selecione um PDF importado.")
        return self.context.fixed_documents.extract_pages(
            document_id, revision, first_page, last_page, Path(destination)
        )

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

"""
Módulo: router.py.
Responsabilidade: registrar telas e endpoints no roteamento nativo do Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import logging
import secrets
import sqlite3
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from bottle import response
from vela.api import api
from vela.core.router import Router
from vela.template_engine.engine import render_template

from apps.open_doc.services.preferences_service import PROJECT_ROOT
from apps.open_doc.services.document_service import AUTOSAVE_SECONDS, RevisionConflict
from apps.open_doc.services.container import services

BAD_REQUEST = 400
FORBIDDEN = 403
CONFLICT = 409
SERVER_ERROR = 500
LOGGER = logging.getLogger(__name__)


def _data(context: dict[str, Any] | None) -> dict[str, Any]:
    context = context or {}
    data = context.get("json")
    if not isinstance(data, dict):
        raise ValueError("Esperado objeto JSON.")
    supplied = context.get("headers", {}).get("X-Open-Doc-Token", "")
    if not secrets.compare_digest(str(supplied), services().token):
        raise PermissionError("Sessão inválida.")
    return data


def _handle(operation: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        return operation()
    except PermissionError as exc:
        response.status = FORBIDDEN
        return {"error": str(exc)}
    except RevisionConflict as exc:
        response.status = CONFLICT
        return {"error": str(exc), "conflict": True}
    except (ValueError, KeyError, TypeError) as exc:
        response.status = BAD_REQUEST
        return {"error": str(exc)}
    except Exception:
        LOGGER.exception("Falha de persistência")
        response.status = SERVER_ERROR
        return {"error": "Não foi possível gravar os dados. Seu texto foi mantido."}


@api.get("/open_doc/files")
def files() -> dict[str, Any]:
    """Lista a biblioteca e os documentos editáveis."""
    return _handle(
        lambda: {
            "files": services().organizer.list_files(),
            "documents": services().editor.list_documents(),
        }
    )


@api.post("/open_doc/settings")
def save_settings(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Persiste preferências por meio da API Bottle gerenciada pelo Vela."""

    def save() -> dict[str, Any]:
        data = _data(context)
        services().config.save_settings(data["settings"])
        return {"ok": True}

    return _handle(save)


@api.post("/open_doc/document/new")
def new_document(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Cria um documento persistente."""

    def create() -> dict[str, Any]:
        data = _data(context)
        if data.get("content_format") == "opendoc-rich-v1":
            return services().editor.create_rich_copy(
                data["title"], data["content"], data.get("source_id")
            )
        return services().editor.create(
            data.get("title", "Sem título"), data.get("markdown", "")
        )

    return _handle(create)


@api.post("/open_doc/document/open")
def open_document(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Seleciona uma nota existente ou uma cópia de Markdown importado."""

    def select() -> dict[str, Any]:
        data = _data(context)
        if "id" in data:
            return services().editor.select(data["id"])
        relative = data.get("path")
        if not isinstance(relative, str):
            raise ValueError("Documento inválido.")
        root = services().config.root
        source = root / relative
        resolved = source.resolve()
        if (
            not (
                resolved.is_relative_to(root / "notes")
                or resolved.is_relative_to(root / "documents" / "docx")
            )
            or source.is_symlink()
            or not source.is_file()
        ):
            raise ValueError("Nota inválida.")
        return (
            services().editor.import_docx(resolved)
            if resolved.suffix.lower() == ".docx"
            else services().editor.import_note(resolved)
        )

    return _handle(select)


@api.post("/open_doc/document/save")
def save_document(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Salva um snapshot com verificação de revisão."""

    def save() -> dict[str, Any]:
        data = _data(context)
        return services().editor.save(
            data["id"],
            data["title"],
            data.get("markdown", ""),
            data["revision"],
            data.get("content"),
            data.get("content_format", "markdown"),
        )

    return _handle(save)


@api.post("/open_doc/document/export")
def export_document(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Exporta um documento salvo, sem aceitar caminhos enviados pelo cliente."""

    def export() -> dict[str, Any]:
        data = _data(context)
        service = services().exports
        filename = uuid4().hex + "." + str(data["format"])
        return service.export(
            data["id"],
            data["revision"],
            data["format"],
            service.default_export_directory() / filename,
        )

    return _handle(export)


def bootstrap() -> dict[str, Any]:
    """Entrega dados iniciais somente à bridge nativa da janela."""
    return {
        "token": services().token,
        "settings": services().config.load_settings(),
        "document": services().editor.current(),
        "autosave_seconds": AUTOSAVE_SECONDS,
    }


# ============ RECUPERAÇÃO DE ALTERAÇÕES ============


@api.post("/open_doc/document/recovery")
def recovery_document(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Armazena recuperação ou descarta somente a nota indicada."""

    def recovery() -> dict[str, Any]:
        data = _data(context)
        if data.get("discard"):
            return services().editor.discard_recovery(data["id"])
        return services().editor.stash_recovery(
            data["id"],
            data["title"],
            data.get("markdown", ""),
            data["revision"],
            data.get("content"),
            data.get("content_format", "markdown"),
        )

    return _handle(recovery)


@api.post("/open_doc/document/media")
def document_media(context=None):
    """Resolve only bounded local raster media referenced by the saved model."""

    def read():
        import base64, io, re
        from PIL import Image

        data = _data(context)
        document = services().editor.get(data["id"])
        mid = data["media_id"]
        if (
            not isinstance(mid, str)
            or not re.fullmatch("[a-f0-9]{64}", mid)
            or mid not in document.get("content", {}).get("media", {})
        ):
            raise ValueError("Imagem inválida.")
        blob = (
            services().editor.package_directory(document["id"]) / "media" / mid
        ).read_bytes()
        with Image.open(io.BytesIO(blob)) as image:
            kind = image.format.lower()
        return {
            "url": "data:image/" + kind + ";base64," + base64.b64encode(blob).decode()
        }

    return _handle(read)


@api.post("/open_doc/document/rename")
def rename_document(context=None):
    def rename():
        data = _data(context)
        return services().editor.rename(data["id"], data["title"], data["revision"])

    return _handle(rename)


@api.post("/open_doc/document/delete")
def delete_document(context=None):
    def delete():
        data = _data(context)
        if data.get("confirmed") is not True:
            raise ValueError("Confirme a exclusão do documento interno.")
        return services().editor.delete(data["id"], data["revision"])

    return _handle(delete)


@api.post("/open_doc/document/duplicate")
def duplicate_document(context=None):
    return _handle(lambda: services().editor.duplicate(_data(context)["id"]))

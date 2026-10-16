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

from app.config import PROJECT_ROOT
from app.editor import AUTOSAVE_SECONDS, RevisionConflict
from app.runtime import services

BAD_REQUEST = 400
FORBIDDEN = 403
CONFLICT = 409
SERVER_ERROR = 500
LOGGER = logging.getLogger(__name__)


def workspace_view(params: dict[str, Any]) -> str:
    """Renderiza a composição usando exclusivamente o template engine Vela."""
    router = params["router"]
    context = {
        "sidebar": render_template(
            str(PROJECT_ROOT / "ui/templates/sidebar.html"), router=router
        ),
        "editor": render_template(
            str(PROJECT_ROOT / "ui/templates/editor.html"), router=router
        ),
    }
    for part in ("menus", "toolbar", "home"):
        context[part] = render_template(
            str(PROJECT_ROOT / f"ui/templates/{part}.html"), router=router
        )
    return render_template(
        str(PROJECT_ROOT / "ui/templates/base.html"),
        context=context,
        router=router,
    )


def register_routes(router: Router) -> None:
    """Conecta a tela à navegação e ao lifecycle do shell Vela."""
    router.add(
        "/",
        workspace_view,
        title="Escrita",
        name="open_doc",
        layout="blank",
        show_in_sidebar=False,
    )


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
    except (OSError, sqlite3.Error):
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
            not resolved.is_relative_to(root / "notes")
            or source.is_symlink()
            or not source.is_file()
        ):
            raise ValueError("Nota inválida.")
        return services().editor.import_note(resolved)

    return _handle(select)


@api.post("/open_doc/document/save")
def save_document(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Salva um snapshot com verificação de revisão."""

    def save() -> dict[str, Any]:
        data = _data(context)
        return services().editor.save(
            data["id"], data["title"], data["markdown"], data["revision"]
        )

    return _handle(save)


@api.post("/open_doc/document/export")
def export_document(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Exporta um documento salvo, sem aceitar caminhos enviados pelo cliente."""

    def export() -> dict[str, Any]:
        from app.exporters.docx_exporter import export_docx
        from app.exporters.pdf_exporter import export_pdf

        data = _data(context)
        document = services().editor.get(data["id"])
        if document["revision"] != data["revision"]:
            raise RevisionConflict("Salve a versão atual antes de exportar.")
        extension = data["format"]

        def export_markdown(markdown: str, target: Path, title: str) -> None:
            target.write_text(markdown, encoding="utf-8")

        exporters = {"pdf": export_pdf, "docx": export_docx, "md": export_markdown}
        if extension not in exporters:
            raise ValueError("Formato de exportação inválido.")
        import re

        stem = re.sub(r"[^\w .-]", "", document["title"]).strip(" .")[:80]
        filename = (stem or "Documento") + "-" + uuid4().hex[:8] + "." + extension
        target = services().config.root / "exports" / filename
        temporary = target.with_suffix(".tmp")
        try:
            exporters[extension](document["markdown"], temporary, document["title"])
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return {
            "name": target.name,
            "path": str(target),
            "revision": document["revision"],
        }

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
            data["id"], data["title"], data["markdown"], data["revision"]
        )

    return _handle(recovery)

"""Thin HTTP controllers for Open Doc application use cases."""

from __future__ import annotations

import logging
import secrets
from pathlib import Path
from typing import Any, Callable, Mapping
from uuid import uuid4

from vela.api import api
from vela.core.http import Request, Response

from apps.open_doc.application.context import get_context
from apps.open_doc.services.document_service import RevisionConflict

BAD_REQUEST = 400
FORBIDDEN = 403
CONFLICT = 409
RANGE_NOT_SATISFIABLE = 416
SERVER_ERROR = 500
LOGGER = logging.getLogger(__name__)


def _documents():
    return get_context().documents


def _header(headers: Mapping[str, Any], name: str) -> str:
    expected = name.casefold()
    for key, value in headers.items():
        if str(key).casefold() == expected:
            return str(value)
    return ""


def _data(context: dict[str, Any] | None) -> dict[str, Any]:
    context = context or {}
    data = context.get("json")
    if not isinstance(data, dict):
        raise ValueError("Esperado objeto JSON.")
    supplied = _header(context.get("headers", {}), "X-Open-Doc-Token")
    if not secrets.compare_digest(supplied, get_context().token):
        raise PermissionError("Sessão inválida.")
    return data


def _handle(operation: Callable[[], dict[str, Any]]) -> dict[str, Any] | Response:
    try:
        return operation()
    except PermissionError as exc:
        return Response({"error": str(exc)}, status=FORBIDDEN)
    except RevisionConflict as exc:
        return Response(
            {"error": str(exc), "conflict": True},
            status=CONFLICT,
        )
    except (ValueError, KeyError, TypeError) as exc:
        return Response({"error": str(exc)}, status=BAD_REQUEST)
    except Exception:
        LOGGER.exception("Falha na operação Open Doc")
        return Response(
            {"error": "Não foi possível gravar os dados. Seu texto foi mantido."},
            status=SERVER_ERROR,
        )


@api.get("/open_doc/files")
def files() -> dict[str, Any] | Response:
    return _handle(_documents().list_library)


@api.post("/open_doc/settings")
def save_settings(context=None):
    return _handle(lambda: _documents().save_settings(_data(context)["settings"]))


@api.post("/open_doc/document/new")
def new_document(context=None):
    return _handle(lambda: _documents().create(_data(context)))


@api.post("/open_doc/document/template")
def template_document(context=None):
    return _handle(lambda: _documents().create_from_template(_data(context)["id"]))


@api.post("/open_doc/document/open")
def open_document(context=None):
    return _handle(lambda: _documents().open(_data(context)))


@api.post("/open_doc/document/save")
def save_document(context=None):
    return _handle(lambda: _documents().save(_data(context)))


@api.post("/open_doc/document/export")
def export_document(context=None):
    def export():
        data = _data(context)
        filename = uuid4().hex + "." + str(data["format"])
        return _documents().export_temporary(data, filename)

    return _handle(export)


def bootstrap() -> dict[str, Any]:
    return _documents().bootstrap()


@api.post("/open_doc/document/versions")
def document_versions(context=None):
    return _handle(lambda: _documents().versions(_data(context)))


@api.post("/open_doc/document/pdf-view")
def save_pdf_view(context=None):
    return _handle(lambda: _documents().save_pdf_view(_data(context)))


@api.post("/open_doc/document/recovery")
def recovery_document(context=None):
    return _handle(lambda: _documents().recover(_data(context)))


@api.post("/open_doc/document/media")
def document_media(context=None):
    return _handle(
        lambda: _documents().media_url(
            _data(context)["id"], _data(context)["media_id"]
        )
    )


@api.post("/open_doc/document/rename")
def rename_document(context=None):
    return _handle(lambda: _documents().rename(_data(context)))


@api.post("/open_doc/document/delete")
def delete_document(context=None):
    return _handle(lambda: _documents().delete(_data(context)))


@api.post("/open_doc/document/duplicate")
def duplicate_document(context=None):
    return _handle(lambda: duplicate_by_id(_data(context)["id"]))


def duplicate_by_id(identifier):
    return _documents().duplicate(identifier)


def _artifact_mime(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        return "application/pdf"
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _parse_range(value: str, total: int) -> tuple[int, int] | None:
    if not value:
        return None
    if not value.startswith("bytes=") or "," in value:
        raise ValueError("Range inválido.")
    spec = value[6:].strip()
    if "-" not in spec:
        raise ValueError("Range inválido.")
    start_text, end_text = spec.split("-", 1)
    if not start_text:
        length = int(end_text)
        if length <= 0:
            raise ValueError("Range inválido.")
        start = max(0, total - length)
        end = total - 1
    else:
        start = int(start_text)
        end = int(end_text) if end_text else total - 1
    if start < 0 or start >= total or end < start:
        raise ValueError("Range fora do arquivo.")
    return start, min(end, total - 1)


def _read_artifact(path: Path, byte_range: tuple[int, int] | None) -> bytes:
    if byte_range is None:
        return path.read_bytes()
    start, end = byte_range
    with path.open("rb") as handle:
        handle.seek(start)
        return handle.read(end - start + 1)


@api.get("/open_doc/artifact/content")
def artifact_content(request: Request) -> Response:
    if not secrets.compare_digest(
        _header(request.headers, "X-Open-Doc-Token"),
        get_context().token,
    ):
        return Response("Sessão inválida.", status=FORBIDDEN, content_type="text/plain")
    try:
        path = _documents().artifact_source(
            request.query.get("id", ""), request.query.get("preview") == "1"
        )
        total = path.stat().st_size
        try:
            byte_range = _parse_range(_header(request.headers, "Range"), total)
        except (TypeError, ValueError):
            return Response(
                b"",
                status=RANGE_NOT_SATISFIABLE,
                headers={
                    "Content-Range": f"bytes */{total}",
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                },
                content_type=_artifact_mime(path),
            )
        headers = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        }
        status = 200
        if byte_range is not None:
            start, end = byte_range
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{total}"
            headers["Content-Length"] = str(end - start + 1)
        else:
            headers["Content-Length"] = str(total)
        return Response(
            _read_artifact(path, byte_range),
            status=status,
            headers=headers,
            content_type=_artifact_mime(path),
        )
    except (OSError, ValueError, KeyError):
        return Response("Documento indisponível.", status=404, content_type="text/plain")

@api.post("/open_doc/workbook")
def workbook(context=None):
    def operation():
        from apps.open_doc.spreadsheets import templates

        data = _data(context)
        store = get_context().workbooks
        command = data["operation"]
        if command == "query":
            from apps.open_doc.datasets.worksheet import WorksheetSnapshot

            return WorksheetSnapshot(data["columns"], data["rows"]).query(data["sql"])
        if command == "from-query":
            from apps.open_doc.datasets.worksheet import WorksheetSnapshot
            from apps.open_doc.spreadsheets.store import empty_sheet

            data_sheet = WorksheetSnapshot(data["columns"], data["rows"])
            new_sheet = empty_sheet("Resultados SQL")
            for col, name in enumerate(data_sheet.columns):
                new_sheet["cells"][f"0,{col}"] = name
                new_sheet["bold"].append(f"0,{col}")
            for row, values in enumerate(data_sheet.rows, start=1):
                for col, value in enumerate(values):
                    if value:
                        new_sheet["cells"][f"{row},{col}"] = (
                            "'" + value if value.startswith(("=", "'")) else value
                        )
            return store.create("Resultado SQL", [new_sheet])
        if command == "new":
            return store.create()
        if command == "template":
            return templates.create(store, data["template"])
        if command == "open":
            return store.get(data["id"])
        if command == "versions":
            return {"versions": store.versions(data["id"])}
        if command == "restore":
            return store.save(data["id"], data["revision"], None, None, restore=data["version"])
        if command == "save":
            return store.save(data["id"], data["revision"], data["title"], data["sheets"])
        raise ValueError("Operação de planilha inválida.")

    return _handle(operation)


@api.post("/open_doc/dataset")
def dataset(context=None):
    def operation():
        data = _data(context)
        store = get_context().datasets
        if data["operation"] == "list":
            return {"datasets": store.list()}
        if data["operation"] == "page":
            return store.page(data["id"], data["row"], data["column"])
        if data["operation"] == "columns":
            return {"columns": store.columns(data["id"])}
        if data["operation"] == "cell":
            return store.cell(data["id"], data["row"], data["column"])
        if data["operation"] == "edit":
            return store.edit_cell(data["id"], data["row"], data["column"], data["value"])
        if data["operation"] == "type":
            return store.set_type(
                data["id"], data["scope"], data["column"], data["kind"],
                data.get("row"), data.get("last_row"), data.get("last_column"),
            )
        if data["operation"] == "history":
            return store.history(data["id"])
        if data["operation"] == "undo":
            return store.undo(data["id"])
        if data["operation"] == "redo":
            return store.undo(data["id"], redo=True)
        if data["operation"] in {"python-env-status", "python-env-install"}:
            from apps.open_doc.datasets.python_envs import PythonEnvironments
            manager = PythonEnvironments(get_context().config.root)
            if data["operation"] == "python-env-status":
                return manager.status(data["id"])
            result = manager.install(data["id"], data["packages"],
                                     confirm=data.get("confirm") is True)
            from apps.open_doc.datasets.python_analysis import environment
            environment.cache_clear()
            return result
        if data["operation"] == "conversion-preview":
            return store.conversion_preview(
                data["id"], data["scope"], data["column"], data["kind"],
                data.get("row"), data.get("last_row"), data.get("last_column"),
            )
        if data["operation"] == "conversion-commit":
            return store.conversion_commit(
                data["id"], data["scope"], data["column"], data["kind"],
                data["token"], data.get("row"), data.get("last_row"),
                data.get("last_column"), on_invalid=data.get("on_invalid", "abort"),
                confirm=data.get("confirm", False),
            )
        if data["operation"] == "query":
            return store.query(data["id"], data["sql"])
        raise ValueError("Operação de dataset inválida.")

    return _handle(operation)


@api.post("/open_doc/template/preview")
def template_preview(context=None):
    return _handle(lambda: get_context().templates.preview(_data(context)["id"]))


@api.post("/open_doc/template/save")
def template_save(context=None):
    def operation():
        data = _data(context)
        return get_context().templates.save(data["id"], data["title"], data.get("workbook") is True)

    return _handle(operation)


@api.post("/open_doc/dataset/python-analysis")
def dataset_python_analysis(context=None):
    from apps.open_doc.datasets.python_analysis import analyze

    def operation():
        data = _data(context)
        return analyze(data["code"], data["line"], data["column"], data["operation"],
                       data.get("project"))

    return _handle(operation)

from __future__ import annotations
from pathlib import Path
from typing import Any
from uuid import uuid4
from vela.api import api
from vela.core.http import Request, Response
from shared.contracts.workspace import workspace as get_context
from shared.services.http import _data, _handle, _header, _has_session
FORBIDDEN, RANGE_NOT_SATISFIABLE = 403, 416

def _documents():
    return get_context().documents

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


@api.post("/open_doc/document/image-asset")
def document_image_asset(context=None):
    return _handle(lambda: _documents().insert_image_asset(_data(context)))


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


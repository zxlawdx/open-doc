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

@api.get("/open_doc/files")
def files(request: Request) -> Response:
    if not _has_session(request.headers):
        return Response({"error": "Sessão inválida."}, status=FORBIDDEN)
    return _handle(
        lambda: Response(
            _documents().list_library(), headers={"Cache-Control": "no-store"}
        )
    )


@api.post("/open_doc/settings")
def save_settings(context=None):
    return _handle(lambda: _documents().save_settings(_data(context)["settings"]))


@api.post("/open_doc/workspace")
def workspace_session(context=None):
    def operation():
        data = _data(context)
        workspace = get_context().resource_workspace
        if data.get("operation") == "load":
            return workspace.load()
        if data.get("operation") == "save":
            return workspace.save(expected_revision=data["expected_revision"],
                                  tabs=data["tabs"], settings=data["settings"], modules=data["modules"])
        raise ValueError("Operação de sessão inválida.")
    return _handle(operation)


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

@api.post("/open_doc/template/preview")
def template_preview(context=None):
    return _handle(lambda: get_context().templates.preview(_data(context)["id"]))


@api.post("/open_doc/template/save")
def template_save(context=None):
    def operation():
        data = _data(context)
        return get_context().templates.save(data["id"], data["title"], data.get("workbook") is True)

    return _handle(operation)


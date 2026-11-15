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
    if not _has_session(request.headers):
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


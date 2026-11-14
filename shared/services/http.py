"""Shared HTTP session validation and transport error mapping."""

import logging
import secrets
from typing import Any, Callable, Mapping
from vela.core.http import Response
from shared.contracts.errors import RevisionConflict
from vela.resources import RevisionConflict as ResourceRevisionConflict
from shared.contracts.workspace import workspace as get_context

BAD_REQUEST, FORBIDDEN, SERVER_ERROR = 400, 403, 500
LOGGER = logging.getLogger(__name__)


def _header(headers: Mapping[str, Any], name: str) -> str:
    expected = name.casefold()
    for key, value in headers.items():
        if str(key).casefold() == expected:
            return str(value)
    return ""


def _has_session(headers: Mapping[str, Any]) -> bool:
    supplied = _header(headers, "X-Open-Doc-Token")
    return supplied.isascii() and secrets.compare_digest(supplied, get_context().token)


def _data(context: dict[str, Any] | None) -> dict[str, Any]:
    context = context or {}
    data = context.get("json")
    if not isinstance(data, dict):
        raise ValueError("Esperado objeto JSON.")
    if not _has_session(context.get("headers", {})):
        raise PermissionError("Sessão inválida.")
    return data


def _handle(operation: Callable[[], dict[str, Any]]) -> dict[str, Any] | Response:
    try:
        return operation()
    except (RevisionConflict, ResourceRevisionConflict) as exc:
        return Response({"error": str(exc), "conflict": True}, status=409)
    except PermissionError as exc:
        return Response({"error": str(exc)}, status=FORBIDDEN)
    except (ValueError, KeyError, TypeError) as exc:
        return Response({"error": str(exc)}, status=BAD_REQUEST)
    except Exception:
        LOGGER.exception("Falha na operação Open Doc")
        return Response(
            {"error": "Não foi possível gravar os dados. Seu texto foi mantido."},
            status=SERVER_ERROR,
        )

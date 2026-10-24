"""Compatibility adapters for Vela releases still leaking transport details.

Keep framework-specific workarounds here so composition/application/domain remain
independent from Bottle internals. Remove these adapters when the pinned Vela
release natively honors the equivalent configuration.
"""

from __future__ import annotations


def configure_request_body_limit(limit: int) -> None:
    """Apply the body limit required by legacy Vela/Bottle releases.

    Newer Vela releases consume ``API['max_body_size']`` themselves. The current
    Open Doc pin predates that support, so the compatibility mutation is isolated
    at the infrastructure boundary instead of living in ``config/wsgi.py``.
    """
    if type(limit) is not int or limit <= 0:
        raise ValueError("request body limit must be a positive integer")

    from bottle import BaseRequest

    if BaseRequest.MEMFILE_MAX < limit:
        BaseRequest.MEMFILE_MAX = limit

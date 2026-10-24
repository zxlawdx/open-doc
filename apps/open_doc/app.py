from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AppDefinition:
    name: str
    module: str
    api_module: str
    routes_module: str
    static_dirs: tuple[str, ...] = ()


OPEN_DOC_APP = AppDefinition(
    name="open_doc",
    module="apps.open_doc",
    api_module="apps.open_doc.api",
    routes_module="apps.open_doc.urls",
    static_dirs=("apps/open_doc/static",),
)

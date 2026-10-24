from __future__ import annotations

from vela.apps import AppConfig


OPEN_DOC_APP = AppConfig(
    name="open_doc",
    module="apps.open_doc",
    views_module="apps.open_doc.views",
    urls_module="apps.open_doc.urls",
    api_module="apps.open_doc.api",
    static_dirs=("apps/open_doc/static",),
    persistent_modules=(
        "apps.open_doc.application",
        "apps.open_doc.domain",
        "apps.open_doc.services",
        "apps.open_doc.infrastructure",
    ),
)

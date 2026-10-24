"""Open Doc runtime configuration only; no document/business logic."""

from apps.open_doc.document_model.validate import MAX_MODEL_JSON_BYTES
from apps.open_doc.services.preferences_service import APP_TITLE, WINDOW_HEIGHT, WINDOW_WIDTH

ENTRY_ROUTE = "/"
LAYOUT = {"sidebar": False, "topbar": False, "theme": "dark"}
DEBUG = False
SHELL_MODE = "http"
STATIC_ROOT = "staticfiles"
API = {
    "host": "127.0.0.1",
    "port": 0,
    "auto_port": True,
    "server": "waitress",
    "docs_enabled": False,
    "max_body_size": MAX_MODEL_JSON_BYTES * 2 + 65536,
}

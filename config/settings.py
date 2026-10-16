"""
Módulo: settings.py.
Responsabilidade: configurar o runtime e a janela pelo contrato Vela.
Autor: Vela Writer Contributors
Criado em: 2026
"""

from app.config import APP_TITLE, WINDOW_HEIGHT, WINDOW_WIDTH

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
}

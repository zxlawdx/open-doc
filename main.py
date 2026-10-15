"""
Módulo: main.py.
Responsabilidade: iniciar servidor Vela e janela desktop Qt.
Autor: Vela Writer Contributors
Criado em: 2026
"""

from __future__ import annotations

import os

from app.config import APP_TITLE, WINDOW_HEIGHT, WINDOW_WIDTH, Config
from app.router import DesktopBridge, create_routes

LOCAL_HOST = "127.0.0.1"
AUTOMATIC_PORT = 0


def main() -> None:
    """Inicia o runtime Vela e encerra o servidor ao fechar a janela."""
    os.environ.setdefault("PYWEBVIEW_GUI", "qt")
    os.environ.setdefault("QT_API", "pyqt5")
    import webview
    from vela.core.api_router import ApiRouter
    from vela.core.api_server import ApiServer

    config = Config()
    server = ApiServer(
        api_router=ApiRouter(),
        host=LOCAL_HOST,
        port=AUTOMATIC_PORT,
        debug=False,
        docs_enabled=False,
    )
    server.app.mount("/", create_routes(config))
    server.start()
    server.wait_until_ready()
    bridge = DesktopBridge(config)
    bridge._window = webview.create_window(
        APP_TITLE,
        url=f"http://{LOCAL_HOST}:{server.port}/",
        js_api=bridge,
        width=WINDOW_WIDTH,
        height=WINDOW_HEIGHT,
        background_color="#0d0f14",
    )
    try:
        webview.start(gui="qt", debug=False)
    finally:
        server.stop()


if __name__ == "__main__":
    main()

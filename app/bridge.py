"""
Módulo: bridge.py.
Responsabilidade: estender a bridge Vela com bootstrap e seletor nativo.
Autor: Vela Writer Contributors
Criado em: 2026
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from vela.core.bridge import BaseBridge

from app.router import bootstrap
from app.runtime import services


class WriterBridge(BaseBridge):
    """Preserva navegação, eventos e lifecycle do BaseBridge do Vela."""

    def __init__(
        self, router: Any = None, config: dict[str, Any] | None = None
    ) -> None:
        """Inicializa a bridge pelo construtor usado pelo VelaApp."""
        super().__init__(router=router, config=config)
        self._window: Any = None

    def _attach_window(self, window: Any) -> None:
        super()._attach_window(window)
        self._window = window
        window.events.closing += self._confirm_close

    def get_bootstrap(self) -> dict[str, Any]:
        """Carrega documento ativo, preferências e credencial da janela."""
        try:
            return bootstrap()
        except (OSError, ValueError):
            return {"error": "Não foi possível ler o workspace."}

    def import_document(self) -> dict[str, Any]:
        """Importa pelo seletor nativo sem alterar o documento original."""
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        paths = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False,
            file_types=("Documentos (*.pdf;*.docx;*.pptx;*.md;*.txt)",),
        )
        if not paths:
            return {"cancelled": True}
        try:
            target = services().organizer.organize(Path(paths[0]))
            return {"name": target.name}
        except (ValueError, OSError, UnicodeError):
            return {"error": "Não foi possível importar. Confira formato e acesso."}

    def _confirm_close(self) -> bool:
        if self._window is None:
            return True
        try:
            clean = self._window.evaluate_js(
                "window.WriterEditor ? window.WriterEditor.isClean() : true"
            )
        except Exception:
            clean = False
        if clean:
            return True
        return bool(self._window.create_confirmation_dialog(
            "Alterações não salvas",
            "Ainda há alterações não salvas. Fechar mesmo assim? "
            "Uma recuperação local será oferecida na próxima abertura.",
        ))

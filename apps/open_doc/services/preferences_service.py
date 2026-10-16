"""
Módulo: config.py.
Responsabilidade: criar diretórios e persistir preferências do usuário.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from threading import RLock

from apps.open_doc.services.workspace_service import resolve_workspace

APP_TITLE = "Open Doc"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
WINDOW_WIDTH = 1280
WINDOW_HEIGHT = 800
DEFAULT_SETTINGS = {
    "sidebar_collapsed": False,
    "theme": "system",
    "zoom": 100,
    "view_mode": "pages",
}
DATA_DIRECTORIES = (
    "documents/docx",
    "documents/pptx",
    "documents/pdf",
    "notes",
    "drawings",
    "exports",
    ".veladata",
)


class Config:
    """Gerencia o workspace e as preferências, sem efeitos no import.

    Attributes:
        root: Diretório de dados do usuário.
    """

    def __init__(self, root: Path | None = None) -> None:
        """Prepara um workspace isolável nos testes."""
        self.root = (root or resolve_workspace(Path.home())).resolve()
        self._lock = RLock()
        for directory in DATA_DIRECTORIES:
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        self.settings_path = self.root / ".veladata" / "settings.json"
        if not self.settings_path.exists():
            self.save_settings(dict(DEFAULT_SETTINGS))

    def load_settings(self) -> dict[str, object]:
        """Lê preferências e rejeita arquivos corrompidos sem sobrescrevê-los."""
        with self._lock:
            data = json.loads(self.settings_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("As configurações precisam ser um objeto JSON.")
            settings = {**DEFAULT_SETTINGS, **data}
            self._validate(settings)
            return settings

    def save_settings(self, settings: dict[str, object]) -> None:
        """Grava JSON atomicamente para evitar arquivos parciais."""
        with self._lock:
            previous = self.load_settings() if self.settings_path.exists() else {}
            settings = {**DEFAULT_SETTINGS, **previous, **settings}
            self._validate(settings)
            descriptor, filename = tempfile.mkstemp(
                dir=self.settings_path.parent, suffix=".tmp"
            )
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                    json.dump(settings, stream, ensure_ascii=False, indent=2)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(filename, self.settings_path)
            finally:
                Path(filename).unlink(missing_ok=True)

    def _validate(self, settings: dict[str, object]) -> None:
        if set(settings) != set(DEFAULT_SETTINGS):
            raise ValueError("Preferências desconhecidas.")
        if type(settings["sidebar_collapsed"]) is not bool:
            raise ValueError("sidebar_collapsed precisa ser booleano.")
        if settings["view_mode"] not in {"pages", "continuous"}:
            raise ValueError("Modo de visualização inválido.")
        if settings["theme"] not in ("light", "dark", "system"):
            raise ValueError("Tema inválido.")
        if type(settings["zoom"]) is not int or not 50 <= settings["zoom"] <= 150:
            raise ValueError("Zoom deve ser inteiro entre 50 e 150.")

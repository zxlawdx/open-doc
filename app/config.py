"""
Módulo: config.py.
Responsabilidade: criar diretórios e persistir preferências do usuário.
Autor: Vela Writer Contributors
Criado em: 2026
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from threading import RLock

APP_TITLE = "Vela Writer"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
WINDOW_WIDTH = 1280
WINDOW_HEIGHT = 800
DEFAULT_SETTINGS = {"sidebar_collapsed": False}
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
        self.root = (root or Path.home() / "VelaWriter").resolve()
        self._lock = RLock()
        for directory in DATA_DIRECTORIES:
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        self.settings_path = self.root / ".veladata" / "settings.json"
        if not self.settings_path.exists():
            self.save_settings(dict(DEFAULT_SETTINGS))

    def load_settings(self) -> dict[str, bool]:
        """Lê preferências e rejeita arquivos corrompidos sem sobrescrevê-los."""
        with self._lock:
            data = json.loads(self.settings_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("As configurações precisam ser um objeto JSON.")
            collapsed = data.get("sidebar_collapsed", False)
            if not isinstance(collapsed, bool):
                raise ValueError("sidebar_collapsed precisa ser booleano.")
            return {"sidebar_collapsed": collapsed}

    def save_settings(self, settings: dict[str, bool]) -> None:
        """Grava JSON atomicamente para evitar arquivos parciais."""
        if set(settings) != set(DEFAULT_SETTINGS):
            raise ValueError("Preferências desconhecidas.")
        if not isinstance(settings["sidebar_collapsed"], bool):
            raise ValueError("sidebar_collapsed precisa ser booleano.")
        with self._lock:
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

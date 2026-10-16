"""Seleção e migração não destrutiva do workspace Open Doc."""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

LEGACY_DIRECTORY = "VelaWriter"
WORKSPACE_DIRECTORY = "OpenDoc"


def resolve_workspace(home: Path) -> Path:
    """Copia o workspace legado quando o novo ainda não existe.

    Nunca mescla nem remove o original. SQLite é copiado pela API de backup,
    inclusive quando há WAL. A publicação usa rename de diretório preparado.
    """
    destination = home / WORKSPACE_DIRECTORY
    legacy = home / LEGACY_DIRECTORY
    if destination.exists():
        if legacy.is_dir():
            marker = destination / ".veladata" / "migration.json"
            if not marker.exists():
                _record(destination, "kept-existing", legacy)
        return destination
    if not legacy.is_dir():
        return destination
    if legacy.is_symlink() or any(path.is_symlink() for path in legacy.rglob("*")):
        raise ValueError(
            "O workspace legado contém links simbólicos. Copie os dados para OpenDoc sem links antes de iniciar."
        )
    staged = Path(tempfile.mkdtemp(prefix=".open-doc-migration-", dir=home))
    try:
        shutil.copytree(legacy, staged, dirs_exist_ok=True, symlinks=True)
        database = legacy / ".veladata" / "writer.sqlite3"
        if database.is_file() and not database.is_symlink():
            copied = staged / ".veladata" / "writer.sqlite3"
            for suffix in ("", "-wal", "-shm", "-journal"):
                Path(str(copied) + suffix).unlink(missing_ok=True)
            with sqlite3.connect(database) as source:
                with sqlite3.connect(copied) as target:
                    source.backup(target)
        _record(staged, "copied", legacy)
        if destination.exists():
            return destination
        staged.rename(destination)
        return destination
    finally:
        if staged.exists():
            shutil.rmtree(staged)


def _record(root: Path, outcome: str, legacy: Path) -> None:
    directory = root / ".veladata"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "migration.json").write_text(
        json.dumps(
            {
                "outcome": outcome,
                "source": str(legacy),
                "original_preserved": True,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

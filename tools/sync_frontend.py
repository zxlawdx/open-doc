"""
Módulo: sync_frontend.py.
Responsabilidade: preparar os estáticos fonte para o collectstatic do Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import filecmp
import shutil
import stat
import time
from pathlib import Path

from vela.cli.collectstatic import collect_static

from app.config import PROJECT_ROOT


def _make_writable(path: str) -> None:
    """Remove somente-leitura antes de uma nova tentativa de limpeza."""
    try:
        Path(path).chmod(stat.S_IWRITE | stat.S_IREAD)
    except OSError:
        pass


def _remove_tree_best_effort(path: Path, retries: int = 3) -> bool:
    """Remove saída gerada sem tornar locks transitórios do Windows fatais."""
    if not path.exists():
        return True

    def onexc(function, filename, _excinfo) -> None:
        _make_writable(filename)
        try:
            function(filename)
        except OSError:
            pass

    for attempt in range(retries):
        try:
            shutil.rmtree(path, onexc=onexc)
        except TypeError:
            shutil.rmtree(
                path,
                onerror=lambda func, name, exc: onexc(func, name, exc),
            )
        except OSError:
            pass
        if not path.exists():
            return True
        time.sleep(0.1 * (attempt + 1))
    return not path.exists()


def _sync_tree(source: Path, target: Path) -> None:
    """Sincroniza arquivos alterados sem apagar o diretório inteiro.

    Isso evita falhas no Windows/OneDrive quando um scanner mantém handles
    temporários abertos em arquivos já existentes.
    """
    target.mkdir(parents=True, exist_ok=True)
    expected_files: set[Path] = set()
    expected_dirs: set[Path] = {Path(".")}

    for item in source.rglob("*"):
        relative = item.relative_to(source)
        destination = target / relative
        if item.is_dir():
            expected_dirs.add(relative)
            destination.mkdir(parents=True, exist_ok=True)
            continue

        expected_files.add(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        unchanged = False
        if destination.is_file():
            try:
                unchanged = (
                    item.stat().st_size == destination.stat().st_size
                    and filecmp.cmp(item, destination, shallow=False)
                )
            except OSError:
                unchanged = False
        if not unchanged:
            shutil.copy2(item, destination)

    # Limpeza apenas best-effort: arquivo obsoleto bloqueado não deve impedir boot.
    for item in sorted(target.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        relative = item.relative_to(target)
        try:
            if item.is_file() and relative not in expected_files:
                _make_writable(str(item))
                item.unlink()
            elif item.is_dir() and relative not in expected_dirs:
                item.rmdir()
        except OSError:
            pass


def sync_frontend() -> None:
    """Coleta assets pelo Vela e disponibiliza o bundle offline do shell."""
    source = PROJECT_ROOT / "ui" / "static"
    staged = PROJECT_ROOT / "apps" / "open_doc" / "static"

    _sync_tree(source, staged)

    # Namespace legado é irrelevante para o app novo. Tente limpar, mas não
    # interrompa o boot se OneDrive/antivírus ainda estiver segurando um handle.
    obsolete = PROJECT_ROOT / "staticfiles" / "writer"
    _remove_tree_best_effort(obsolete)

    result = collect_static(
        apps_dir="apps",
        output_dir="staticfiles",
        skip_tailwind=True,
        verbose=False,
    )
    if result["errors"]:
        raise RuntimeError("Falha no collectstatic do Vela.")

    shell_css = PROJECT_ROOT / "staticfiles" / "css" / "vela.bundle.css"
    shell_css.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / "css" / "main.css", shell_css)


if __name__ == "__main__":
    sync_frontend()

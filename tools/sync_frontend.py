"""
Módulo: sync_frontend.py.
Responsabilidade: preparar os estáticos fonte para o collectstatic do Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import shutil

from vela.cli.collectstatic import collect_static

from app.config import PROJECT_ROOT


def sync_frontend() -> None:
    """Coleta assets pelo Vela e disponibiliza o bundle offline do shell."""
    source = PROJECT_ROOT / "ui" / "static"
    staged = PROJECT_ROOT / "apps" / "open_doc" / "static"
    if staged.exists():
        shutil.rmtree(staged)
    obsolete = PROJECT_ROOT / "staticfiles" / "writer"
    if obsolete.exists():
        shutil.rmtree(obsolete)
    shutil.copytree(source, staged)
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

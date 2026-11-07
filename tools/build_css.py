"""
Módulo: build_css.py.
Responsabilidade: compilar utilitários offline usando o pipeline do Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import shutil
from pathlib import Path

from vela.cli.collectstatic import run_tailwind_pipeline

ROOT = Path(__file__).resolve().parents[1]
STYLE_ORDER = (
    "tokens.css",
    "base.css",
    "shell.css",
    "header.css",
    "menus.css",
    "dialogs.css",
    "toolbar.css",
    "navigator.css",
    "workspace.css",
    "pages.css",
    "document-content.css",
    "home.css",
    "library.css",
    "statusbar.css",
    "ink.css",
    "semantic_annotations.css",
    "states.css",
    "oficio_design.css",
    "slide_editor.css",
    "responsive.css",
    "utilities.css",
)


def main() -> None:
    """Recompila utilitários e preserva o tema escrito à mão."""
    target = ROOT / "apps" / "open_doc" / "static" / "css" / "runtime.css"
    custom_css = "\n".join(
        (ROOT / "apps/open_doc/styles" / name).read_text(encoding="utf-8")
        for name in STYLE_ORDER
    )
    staging = ROOT / ".vela-build"
    staging.mkdir(parents=True, exist_ok=True)
    output = ROOT / "staticfiles"
    output.mkdir(parents=True, exist_ok=True)

    import vela.core.api_server

    shell = Path(vela.core.api_server.__file__).parent / "shell.html"
    shutil.copy2(shell, staging / "framework-shell.html")

    if not run_tailwind_pipeline(str(ROOT), str(output), minify=True):
        raise RuntimeError("Falha ao compilar Tailwind com Vela.")

    compiled = (output / "css" / "vela.bundle.css").read_text(encoding="utf-8")
    # Build output is deliberately untracked: rebuilding must never block git pull.
    # Replace atomically so a failed write cannot leave a partial stylesheet.
    temporary = target.with_suffix(".css.tmp")
    try:
        temporary.write_text(compiled + "\n" + custom_css + "\n", encoding="utf-8")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

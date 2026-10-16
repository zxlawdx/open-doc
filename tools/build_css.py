"""
Módulo: build_css.py.
Responsabilidade: compilar utilitários offline usando o pipeline do Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

from pathlib import Path

from vela.cli.collectstatic import run_tailwind_pipeline

ROOT = Path(__file__).resolve().parents[1]
STYLE_ORDER = (
    "tokens.css",
    "shell.css",
    "menus.css",
    "toolbar.css",
    "document.css",
    "home.css",
)


def main() -> None:
    """Recompila utilitários e preserva o tema escrito à mão."""
    target = ROOT / "ui" / "static" / "css" / "main.css"
    custom_css = "\n".join(
        (ROOT / "ui/styles" / name).read_text(encoding="utf-8") for name in STYLE_ORDER
    )
    output = ROOT / ".vela-build"
    output.mkdir(parents=True, exist_ok=True)
    import shutil
    import vela.core.api_server

    shell = Path(vela.core.api_server.__file__).parent / "shell.html"
    shutil.copy2(shell, output / "framework-shell.html")
    if not run_tailwind_pipeline(str(ROOT), str(output), minify=True):
        raise RuntimeError("Falha ao compilar Tailwind com Vela.")
    compiled = (output / "css" / "vela.bundle.css").read_text(encoding="utf-8")
    target.write_text(
        compiled + "\n" + custom_css + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

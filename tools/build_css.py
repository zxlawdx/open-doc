"""
Módulo: build_css.py.
Responsabilidade: compilar utilitários offline usando o pipeline do Vela.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

from pathlib import Path
import os
import shutil
import subprocess
import vela.cli.collectstatic as vela_static

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
    "states.css",
    "responsive.css",
    "utilities.css",
)


def compile_tailwind_native(project_root, input_css, output_css, minify, verbose):
    node = shutil.which("node")
    cli = Path(project_root) / "node_modules/tailwindcss/lib/cli.js"
    if not node or not cli.is_file():
        raise RuntimeError("Tailwind local ausente. Execute npm ci.")
    command = [node, str(cli), "-i", input_css, "-o", output_css]
    if minify:
        command.append("--minify")
    result = subprocess.run(
        command, cwd=project_root, capture_output=True, text=True, timeout=60
    )
    if result.returncode:
        print(result.stderr)
    return result.returncode == 0 and Path(output_css).is_file()


def main() -> None:
    """Recompila utilitários e preserva o tema escrito à mão."""
    target = ROOT / "apps" / "open_doc" / "static" / "css" / "main.css"
    custom_css = "\n".join(
        (ROOT / "apps/open_doc/styles" / name).read_text(encoding="utf-8")
        for name in STYLE_ORDER
    )
    output = ROOT / ".vela-build"
    output.mkdir(parents=True, exist_ok=True)
    import vela.core.api_server

    shell = Path(vela.core.api_server.__file__).parent / "shell.html"
    shutil.copy2(shell, output / "framework-shell.html")
    # Pinned Vela executes the POSIX npm shim directly (WinError 193).
    # Keep its detection/input/output pipeline, replacing only CLI invocation.
    original_compile = vela_static._compile_tailwind
    if os.name == "nt":
        vela_static._compile_tailwind = compile_tailwind_native
    try:
        if not run_tailwind_pipeline(str(ROOT), str(output), minify=True):
            raise RuntimeError("Falha ao compilar Tailwind com Vela.")
    finally:
        vela_static._compile_tailwind = original_compile
    compiled = (output / "css" / "vela.bundle.css").read_text(encoding="utf-8")
    target.write_text(
        compiled + "\n" + custom_css + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

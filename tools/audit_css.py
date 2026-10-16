"""Audit app-owned CSS tokens, without requiring a CSS parser dependency."""

from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMENT = re.compile(r"/\*.*?\*/", re.S)
DECLARATION = re.compile(r"(?<![\w-])(--[\w-]+)\s*:")
REFERENCE = re.compile(r"var\(\s*(--[\w-]+)")


def audit(root: Path = ROOT) -> list[str]:
    sources = list((root / "apps/open_doc/styles").glob("*.css"))
    scripts = list((root / "apps/open_doc/static/js").glob("*.js"))
    text = {
        file: COMMENT.sub("", file.read_text(encoding="utf-8"))
        for file in sources + scripts
    }
    declared = {name for file in sources for name in DECLARATION.findall(text[file])}
    return sorted(
        f"{file.relative_to(root).as_posix()}: {name}"
        for file, value in text.items()
        for name in set(REFERENCE.findall(value)) - declared
    )


if __name__ == "__main__":
    errors = audit()
    if errors:
        raise SystemExit("\n".join(errors))
    print("CSS tokens: todas as referências possuem declaração.")

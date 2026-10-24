from __future__ import annotations

from pathlib import Path


class WorkspacePathResolver:
    """Resolve user-visible workspace paths without leaking path policy to API code."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self.allowed_roots = tuple(
            (self.root / relative).resolve()
            for relative in (
                "notes",
                "documents/docx",
                "documents/pdf",
                "documents/pptx",
            )
        )

    def resolve_document(self, relative: str) -> Path:
        if not isinstance(relative, str) or not relative.strip():
            raise ValueError("Documento inválido.")
        source = self.root / relative
        resolved = source.resolve()
        if source.is_symlink() or not source.is_file():
            raise ValueError("Nota inválida.")
        if not any(resolved.is_relative_to(root) for root in self.allowed_roots):
            raise ValueError("Nota inválida.")
        return resolved

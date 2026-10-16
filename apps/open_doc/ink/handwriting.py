"""Async local recognition with explicit availability and no implicit downloads."""

from dataclasses import dataclass, asdict
from .validation import validate_layers


@dataclass
class Recognition:
    text: str
    confidence: float | None
    backend: str
    language: str


class HandwritingService:
    def __init__(self, backends):
        self.backends = backends

    def capabilities(self):
        return [{"backend": b.name, "available": b.available} for b in self.backends]

    async def recognize(self, strokes, *, language="pt-BR"):
        validate_layers([{"surface_index": 0, "strokes": strokes}])
        errors = []
        for backend in self.backends:
            if not backend.available:
                continue
            try:
                result = await backend.recognize(strokes, language=language)
                if result.text.strip():
                    return result
            except Exception as exc:
                errors.append(str(exc))
        raise RuntimeError(
            "Nenhum reconhecedor local retornou texto. Instale Windows Ink com idioma de escrita, ou configure modelos PaddleOCR locais. Sua tinta foi mantida."
            + (" " + errors[0][:180] if errors else "")
        )

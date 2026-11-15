from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class DocumentFormat(str, Enum):
    DOCX = "docx"
    PDF = "pdf"
    HTML = "html"
    MARKDOWN = "md"
    PPTX = "pptx"


@dataclass(frozen=True, slots=True)
class DocumentRef:
    document_id: str
    revision: int

    def __post_init__(self) -> None:
        if not self.document_id:
            raise ValueError("document_id is required")
        if type(self.revision) is not int or self.revision < 0:
            raise ValueError("revision must be a non-negative integer")

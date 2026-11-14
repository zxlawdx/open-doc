"""Public adapter contracts for common cross-format document operations."""
from dataclasses import dataclass
from typing import Callable

@dataclass(frozen=True)
class FixedFormats:
    pdf_reader: Callable
    validate_pdf: Callable
    presentation_reader: Callable
    preview_pdf: Callable
    office_executable: Callable
    read_deck: Callable
    export_deck: Callable
    pdf_editor: Callable

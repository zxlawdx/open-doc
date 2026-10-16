"""
Módulo: pdf_exporter.py.
Responsabilidade: exportar Markdown para PDF Unicode com fpdf2.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

from app.config import PROJECT_ROOT
from app.exporters.markdown_document import safe_html

FONT_PATH = PROJECT_ROOT / "ui" / "static" / "fonts" / "Inter.ttf"
FONT_SIZE = 11
PAGE_MARGIN = 18
BOTTOM_MARGIN = 18


def export_pdf(markdown: str, target: Path, title: str) -> None:
    """Gera PDF A4 com paginação, estilos Markdown e texto em português."""
    pdf = FPDF()
    pdf.set_margins(PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN)
    pdf.set_auto_page_break(True, BOTTOM_MARGIN)
    for style, suffix in (
        ("", ""),
        ("B", "-Bold"),
        ("I", "-Italic"),
        ("BI", "-BoldItalic"),
    ):
        path = FONT_PATH.with_name("Inter" + suffix + ".ttf")
        pdf.add_font("OpenDoc", style=style, fname=str(path))
    pdf.add_page()
    pdf.set_font("OpenDoc", size=FONT_SIZE)
    pdf.set_title(title)
    pdf.write_html(safe_html(markdown), font_family="OpenDoc")
    pdf.output(str(target))

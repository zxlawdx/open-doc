"""Rich model writer with a compatible legacy Markdown entrypoint."""

from app.exporters.markdown_docx import export_docx as export_markdown_docx
from app.exporters.docx.package_writer import DocxPackageWriter


def export_docx(document, target, title, *, package_directory=None):
    if isinstance(document, str):
        return export_markdown_docx(document, target, title)
    original = package_directory / "original.docx" if package_directory else None
    DocxPackageWriter(original).write(document, target)

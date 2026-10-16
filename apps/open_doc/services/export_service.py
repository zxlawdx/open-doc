"""Exportação transacional para destinos escolhidos pela bridge nativa."""

from __future__ import annotations
import os
import re
import tempfile
from pathlib import Path
from html import escape

EXTENSIONS = {"docx", "pdf", "html", "md"}


class ExportError(RuntimeError):
    """Falha segura de exportação, sem perda do documento salvo."""


def safe_stem(title):
    return re.sub(r"[^\w .-]", "", title).strip(" .")[:100] or "Documento"


def enforce_extension(path, fmt):
    path = Path(path)
    return path if path.suffix.lower() == "." + fmt else path.with_suffix("." + fmt)


class ExportService:
    def __init__(self, documents, config):
        self.documents, self.config = documents, config
        self.fonts = None

    def suggest_filename(self, document_id, file_format):
        if file_format not in EXTENSIONS:
            raise ExportError("Formato de exportação inválido.")
        return safe_stem(self.documents.get(document_id)["title"]) + "." + file_format

    def default_export_directory(self):
        return self.config.root / "exports"

    def export(self, document_id, revision, file_format, destination):
        if file_format not in EXTENSIONS:
            raise ExportError("Formato de exportação inválido.")
        document = self.documents.get(document_id)
        if type(revision) is not int or document["revision"] != revision:
            raise ExportError("Salve a versão atual antes de exportar.")
        target = enforce_extension(destination, file_format)
        temporary = None
        try:
            fd, name = tempfile.mkstemp(
                prefix=".opendoc-", suffix="." + file_format, dir=target.parent
            )
            os.close(fd)
            temporary = Path(name)
            content = document.get("content")
            warnings = []
            package = self.documents.package_directory(document_id)
            if file_format == "docx":
                from apps.open_doc.exporters.docx_exporter import export_docx

                export_docx(
                    content or document["markdown"],
                    temporary,
                    document["title"],
                    **({"package_directory": package} if content else {}),
                )
            elif file_format == "pdf":
                from apps.open_doc.exporters.pdf_exporter import export_pdf

                font = None
                if content:
                    from .font_service import FontService

                    def families(value):
                        if isinstance(value, dict):
                            if value.get("font_family"):
                                yield value["font_family"]
                            for item in value.values():
                                yield from families(item)
                        elif isinstance(value, list):
                            for item in value:
                                yield from families(item)

                    fonts = self.fonts or FontService(self.config)
                    font = next(
                        (
                            fonts.resolve(name)
                            for name in families(content)
                            if fonts.resolve(name)
                        ),
                        None,
                    )
                try:
                    export_pdf(
                        document["markdown"],
                        temporary,
                        document["title"],
                        font_path=font,
                    )
                except Exception:
                    if not font:
                        raise
                    warnings.append(
                        "A fonte importada não pôde ser incorporada no PDF; foi usada Inter."
                    )
                    export_pdf(document["markdown"], temporary, document["title"])
                if content and content.get("ink_layers"):
                    from ..ink.exporters import add_rich_ink

                    add_rich_ink(
                        temporary, content["ink_layers"], getattr(self, "fonts", None)
                    )
                    warnings.append(
                        "Tinta ancorada por página; a paginação do PDF simplificado pode diferir do editor."
                    )
                if content:
                    warnings.append(
                        "PDF usa uma família principal; estilos e fontes por trecho podem diferir."
                    )
            elif file_format == "html" and content:
                from apps.open_doc.exporters.html_exporter import export_html

                export_html(
                    content, temporary, document["title"], package_directory=package
                )
            elif file_format == "html":
                temporary.write_text(
                    '<!doctype html><meta charset="utf-8"><pre>'
                    + escape(document["markdown"])
                    + "</pre>",
                    encoding="utf-8",
                )
            else:
                temporary.write_text(document["markdown"], encoding="utf-8")
            if not temporary.stat().st_size:
                raise ExportError("O exportador gerou um arquivo vazio.")
            os.replace(temporary, target)
        except ExportError:
            raise
        except Exception as exc:
            raise ExportError(
                "Não foi possível exportar o documento. Seu conteúdo continua salvo."
            ) from exc
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        lossy = bool(content and file_format != "docx")
        return {
            "path": str(target),
            "name": target.name,
            "revision": revision,
            "lossy": lossy,
            "warnings": warnings
            + (
                ["Exportação simplificada: fontes, imagens e layout podem diferir."]
                if lossy
                else []
            ),
        }

"""Local template snapshots and preview descriptors."""

import base64
from pathlib import Path
from tempfile import TemporaryDirectory

from apps.templates.services import template_catalog


class Templates:
    def __init__(self, context):
        self.context = context
        with context.editor._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS personal_templates (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, format TEXT NOT NULL
            )""")

    def personal(self):
        with self.context.editor._connect() as db:
            return {row["id"]: dict(row) for row in db.execute(
                "SELECT id,title,format FROM personal_templates ORDER BY rowid"
            )}

    def save(self, identifier, title, workbook):
        ctx = self.context
        title, _ = ctx.editor._validate(title, "")
        if workbook:
            original = ctx.workbooks.get(identifier)
            copy = ctx.workbooks.create(title, original["sheets"])
            fmt = "xlsx"
        else:
            fixed = ctx.fixed_documents.exists(identifier)
            service = ctx.fixed_documents if fixed else ctx.editor
            original = service.get(identifier)
            fmt = original["source_kind"] if fixed else "docx"
            try:
                copy = service.duplicate(identifier)
            finally:
                ctx.documents.open({"id": identifier})
        with ctx.editor._connect() as db:
            db.execute("INSERT INTO personal_templates VALUES (?,?,?)", (copy["id"], title, fmt))
        return {"id": copy["id"], "title": title, "format": fmt}

    def create(self, descriptor):
        ctx = self.context
        identifier, title, fmt = descriptor["id"], descriptor["title"], descriptor["format"]
        if fmt == "xlsx":
            return ctx.workbooks.create(title, ctx.workbooks.get(identifier)["sheets"])
        if fmt == "docx":
            original = ctx.editor.get(identifier)
            ctx.fixed_documents.activate("rich")
            if original.get("content"):
                return ctx.editor.create_rich_copy(title, original["content"], identifier)
            return ctx.editor.create(title, original["markdown"])
        copy = ctx.fixed_documents.duplicate(identifier)
        return ctx.fixed_documents.save(copy["id"], title, copy["content"], copy["revision"])

    def preview(self, identifier):
        if not isinstance(identifier, str):
            raise ValueError("Identificador de template inválido.")
        ctx = self.context
        personal = self.personal().get(identifier)
        if personal:
            fmt = personal["format"]
            if fmt == "xlsx":
                return {"format": fmt, "sheets": ctx.workbooks.get(identifier)["sheets"]}
            if fmt == "docx":
                note = ctx.editor.get(identifier)
                return {"format": fmt, "content": note.get("content"), "markdown": note["markdown"], "id": identifier}
        elif identifier.startswith("sheet-"):
            _, workbook = ctx.workbook_templates.sample(identifier)
            return {"format": "xlsx", "sheets": workbook}
        else:
            template = next((item for item in template_catalog.CATALOG if item.id == identifier), None)
            if template is None:
                raise ValueError("Template não encontrado.")
            fmt = template.format
            if fmt == "docx":
                return {"format": fmt, "content": template_catalog.rich_document(template)}

        with TemporaryDirectory(dir=ctx.config.root) as directory:
            path = Path(directory) / ("preview." + fmt)
            if personal:
                note = ctx.fixed_documents.get(identifier)
                ctx.fixed_documents.export(identifier, note["revision"], fmt, path)
            elif fmt == "pdf":
                template_catalog.write_pdf(template, path)
            else:
                template_catalog.presentation(template).save(path)
            if path.stat().st_size > 24 * 1024 * 1024:
                raise ValueError("O arquivo excede 24 MB. Abra uma cópia para visualizar.")
            result = {"format": fmt, "bytes": base64.b64encode(path.read_bytes()).decode("ascii")}
            if fmt == "pptx":
                from pptx import Presentation
                deck = Presentation(path)
                result.update(width=deck.slide_width, height=deck.slide_height)
            return result

"""Fixed document snapshots, optimistic revisions, recovery, and native exports."""

import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4
from ..fixed_document.schema import create
from ..fixed_document.serialization import serialize, load
from ..readers.pdf.service import PdfService
from ..readers.pdf.security import validated_pdf
from ..readers.pptx.service import PresentationService
from .document_service import RevisionConflict
from .export_service import safe_stem


class FixedDocumentService:
    def __init__(self, documents, config, fonts):
        self.documents, self.config, self.fonts = documents, config, fonts
        with documents._connect() as c:
            c.executescript(
                "CREATE TABLE IF NOT EXISTS fixed_documents (id TEXT PRIMARY KEY,title TEXT NOT NULL,source_kind TEXT NOT NULL,source_path TEXT NOT NULL,source_sha256 TEXT NOT NULL,content_json TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS fixed_recovery (id TEXT PRIMARY KEY,title TEXT NOT NULL,content_json TEXT NOT NULL,revision INTEGER NOT NULL);"
            )

    def directory(self, identifier):
        return self.config.root / ".veladata" / "fixed" / str(UUID(identifier))

    def exists(self, identifier):
        with self.documents._connect() as c:
            return (
                c.execute(
                    "SELECT 1 FROM fixed_documents WHERE id=?", (str(UUID(identifier)),)
                ).fetchone()
                is not None
            )

    def active_kind(self):
        with self.documents._connect() as c:
            row = c.execute(
                "SELECT value FROM session WHERE key='active_kind'"
            ).fetchone()
        return row[0] if row else "rich"

    def activate(self, kind, identifier=None):
        with self.documents._connect() as c:
            c.execute(
                "INSERT OR REPLACE INTO session VALUES ('active_kind',?)", (kind,)
            )
            if identifier:
                c.execute(
                    "INSERT OR REPLACE INTO session VALUES ('active_fixed',?)",
                    (identifier,),
                )

    def current(self):
        with self.documents._connect() as c:
            row = c.execute(
                "SELECT value FROM session WHERE key='active_fixed'"
            ).fetchone()
        return self.get(row[0]) if row else None

    def list_documents(self):
        with self.documents._connect() as c:
            return [
                dict(r)
                for r in c.execute(
                    "SELECT id,title,revision,updated_at,source_kind FROM fixed_documents ORDER BY updated_at DESC"
                )
            ]

    def get(self, identifier):
        identifier = str(UUID(identifier))
        with self.documents._connect() as c:
            row = c.execute(
                "SELECT * FROM fixed_documents WHERE id=?", (identifier,)
            ).fetchone()
            recovery = c.execute(
                "SELECT * FROM fixed_recovery WHERE id=?", (identifier,)
            ).fetchone()
        if not row:
            raise ValueError("Documento fixo não encontrado.")
        note = {
            k: v
            for k, v in dict(row).items()
            if k not in ["source_path", "source_sha256", "content_json"]
        }
        note.update(
            content_format="opendoc-fixed-v1",
            content=load(row["content_json"]),
            markdown="",
            recovery=None,
        )
        if recovery:
            note["recovery"] = {
                **dict(recovery),
                "content": load(recovery["content_json"]),
            }
        preview = self.directory(identifier) / "preview.pdf"
        can_preview = note["source_kind"] in {"pdf", "pptx"}
        handwriting = getattr(self, "handwriting", None)
        note["capabilities"] = {
            "preview": can_preview,
            "ink": can_preview,
            "edit_slides": note["source_kind"] == "pptx" and note["content"].get("editable_deck") is True,
            "handwriting": can_preview
            and handwriting is not None
            and any(b["available"] for b in handwriting.capabilities()),
            "pptx_preview": {
                "available": note["source_kind"] == "pptx",
                "backend": (
                    "pptx-viewer-0.2.2" if note["source_kind"] == "pptx" else None
                ),
            },
        }
        return note

    def select(self, identifier):
        note = self.get(identifier)
        self.activate(note["source_kind"], identifier)
        return note

    def create_presentation(self, title="Nova apresentação"):
        """Create a real, valid blank PPTX and a separately editable slide model.

        The source file remains immutable. All subsequent slide edits are
        stored in the validated fixed-document JSON and exported to PPTX.
        """
        from pptx import Presentation
        from pptx.util import Inches

        self.documents._validate(title, "")
        fd, name = tempfile.mkstemp(
            prefix=".open-doc-new-slides-", suffix=".pptx", dir=self.config.root
        )
        os.close(fd)
        temporary = Path(name)
        try:
            deck = Presentation()
            deck.slide_width = Inches(13.333)
            deck.slide_height = Inches(7.5)
            deck.slides.add_slide(deck.slide_layouts[6])
            deck.save(temporary)
            note = self.import_pptx(temporary)
            model = json.loads(json.dumps(note["content"]))
            model["editable_deck"] = True
            for surface in model["surfaces"]:
                surface["elements"] = []
                surface["background"] = "#FFFFFF"
                surface["notes"] = ""
            # Only this trusted server-side creation path can mark the source
            # as an editable blank deck; regular imports remain immutable.
            with self.documents._lock, self.documents._connect() as connection:
                connection.execute(
                    "UPDATE fixed_documents SET title=?,content_json=? WHERE id=?",
                    (title, serialize(model), note["id"]),
                )
            return self.select(note["id"])
        finally:
            temporary.unlink(missing_ok=True)

    def import_pdf(self, path):
        return self._import(path, "pdf")

    def import_pptx(self, path):
        return self._import(path, "pptx")

    def _import(self, path, kind):
        path = Path(path)
        if (
            path.is_symlink()
            or not path.resolve().is_relative_to(self.config.root)
            or not path.is_file()
        ):
            raise ValueError("Origem inválida.")
        metadata = (
            PdfService().metadata(path, self.config.root)
            if kind == "pdf"
            else PresentationService().metadata(path)
        )
        identifier = str(uuid4())
        directory = self.directory(identifier)
        directory.mkdir(parents=True)
        try:
            source = directory / ("source." + kind)
            shutil.copyfile(path, source)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            model = create(kind, digest, metadata["pages"])
            if kind == "pptx":
                from ..readers.pptx.native_importer import read_editable_deck
                imported = read_editable_deck(source)
                if imported is not None:
                    model.update(imported)

            with self.documents._connect() as c:
                c.execute(
                    "INSERT INTO fixed_documents VALUES (?,?,?,?,?,?,?,?)",
                    (
                        identifier,
                        path.stem,
                        kind,
                        source.relative_to(self.config.root).as_posix(),
                        digest,
                        serialize(model),
                        1,
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
        except Exception:
            shutil.rmtree(directory)
            raise
        return self.select(identifier)

    def source(self, identifier, preview=False):
        note = self.get(identifier)
        path = self.directory(identifier) / (
            "preview.pdf" if preview else "source." + note["source_kind"]
        )
        if preview or note["source_kind"] == "pdf":
            validated_pdf(path, self.config.root)
        if (
            path.is_symlink()
            or not path.is_file()
            or not path.resolve().is_relative_to(self.config.root)
        ):
            raise ValueError("Origem indisponível.")
        if (
            not preview
            and hashlib.sha256(path.read_bytes()).hexdigest()
            != note["content"]["source_sha256"]
        ):
            raise ValueError("A cópia original foi alterada fora do aplicativo.")
        return path

    def _checked(self, identifier, content):
        old = self.get(identifier)
        serialize(content)
        origin_changed = (
            content["source_sha256"] != old["content"]["source_sha256"]
            or content["source_kind"] != old["source_kind"]
        )
        editable = bool(old["content"].get("editable_deck"))
        if editable:
            # The source slide is a bootstrap template, not the editable deck.
            # Page size remains locked, but slides may be added or removed.
            size = (old["content"]["surfaces"][0]["width_pt"],
                    old["content"]["surfaces"][0]["height_pt"])
            bad_geometry = any(
                (s["width_pt"], s["height_pt"]) != size
                for s in content["surfaces"]
            )
            bad_geometry |= content.get("editable_deck") is not True
        else:
            bad_geometry = (
                [(s["width_pt"], s["height_pt"]) for s in content["surfaces"]]
                != [(s["width_pt"], s["height_pt"]) for s in old["content"]["surfaces"]]
            )
            # Never promote an imported PPTX into an editable source through
            # a normal document/save request. That could discard OOXML parts.
            bad_geometry |= content.get("editable_deck") is True
        if origin_changed or bad_geometry:
            raise ValueError("Não altere a origem ou as dimensões do documento.")
        return old

    def save(self, identifier, title, content, revision):
        self._checked(identifier, content)
        self.documents._validate(title, "")
        with self.documents._lock, self.documents._connect() as c:
            cursor = c.execute(
                "UPDATE fixed_documents SET title=?,content_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
                (
                    title,
                    serialize(content),
                    datetime.now(timezone.utc).isoformat(),
                    identifier,
                    revision,
                ),
            )
            if cursor.rowcount != 1:
                raise RevisionConflict("O documento foi alterado em outra janela.")
            c.execute("DELETE FROM fixed_recovery WHERE id=?", (identifier,))
        return self.get(identifier)

    def recovery(self, identifier, title, content, revision, discard=False):
        if not discard:
            old = self._checked(identifier, content)
            self.documents._validate(title, "")
            if old["revision"] != revision:
                raise RevisionConflict("Recuperação baseada em revisão antiga.")
        with self.documents._connect() as c:
            if discard:
                c.execute("DELETE FROM fixed_recovery WHERE id=?", (identifier,))
            else:
                cursor = c.execute(
                    "INSERT OR REPLACE INTO fixed_recovery SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM fixed_documents WHERE id=? AND revision=?)",
                    (
                        identifier,
                        title,
                        serialize(content),
                        revision,
                        identifier,
                        revision,
                    ),
                )
                if cursor.rowcount != 1:
                    raise RevisionConflict("Recuperação baseada em revisão antiga.")
        return {"stored": not discard}

    def rename(self, identifier, title, revision):
        return self.save(identifier, title, self.get(identifier)["content"], revision)

    def delete(self, identifier, revision):
        with self.documents._connect() as c:
            row = c.execute(
                "DELETE FROM fixed_documents WHERE id=? AND revision=?",
                (identifier, revision),
            )
            if row.rowcount != 1:
                raise RevisionConflict("Documento alterado ou excluído.")
            c.execute("DELETE FROM fixed_recovery WHERE id=?", (identifier,))
            c.execute(
                "DELETE FROM session WHERE key='active_fixed' AND value=?",
                (identifier,),
            )
        self.activate("rich")
        return {"deleted": True}

    def duplicate(self, identifier):
        old = self.get(identifier)
        if old["content"].get("editable_deck"):
            note = self.create_presentation(old["title"][:170] + " (cópia)")
            model = json.loads(json.dumps(old["content"]))
            model["source_sha256"] = note["content"]["source_sha256"]
            return self.save(note["id"], note["title"], model, note["revision"])
        note = self._import(self.source(identifier), old["source_kind"])
        return self.save(
            note["id"],
            old["title"][:170] + " (cópia)",
            {**old["content"]},
            note["revision"],
        )

    def export(self, identifier, revision, fmt, destination):
        note = self.get(identifier)
        if note["revision"] != revision:
            raise RevisionConflict("Salve antes de exportar.")
        if fmt not in (["pdf"] if note["source_kind"] == "pdf" else ["pptx"]):
            raise ValueError("Formato incompatível com este documento.")
        destination = Path(destination).with_suffix("." + fmt)
        source = self.source(
            identifier, preview=note["source_kind"] == "pptx" and fmt == "pdf"
        )
        if destination.resolve() == source.resolve() or (
            destination.is_file()
            and hashlib.sha256(destination.read_bytes()).hexdigest()
            == note["content"]["source_sha256"]
        ):
            raise ValueError("Escolha um destino diferente do original.")
        fd, name = tempfile.mkstemp(
            prefix=".opendoc-", suffix="." + fmt, dir=destination.parent
        )
        os.close(fd)
        temporary = Path(name)
        try:
            if fmt == "pptx":
                from ..readers.pptx.exporter import export_pptx

                export_pptx(source, note["content"], temporary)
            else:
                from ..ink.exporters import export_pdf

                export_pdf(source, note["content"], temporary, self.fonts)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return {
            "path": str(destination),
            "name": destination.name,
            "revision": revision,
            "lossy": False,
            "warnings": (
                ["Fontes ausentes podem usar fallback visual no PDF."]
                if fmt == "pdf"
                else []
            ),
        }

    def require_native_pdf_edit(self, identifier, revision):
        """Check the source document before editing original PDF content."""
        note = self.get(identifier)
        if note["source_kind"] != "pdf":
            raise ValueError("A edição nativa só está disponível para documentos PDF.")
        if type(revision) is not int or revision != note["revision"]:
            raise RevisionConflict("Salve as anotações antes de modificar o PDF.")
        content = note["content"]
        if content.get("annotations") or any(
            surface.get("strokes") or surface.get("text_overlays")
            for surface in content.get("surfaces", [])
        ):
            raise ValueError(
                "Este documento possui anotações. Exporte uma cópia anotada "
                "antes de iniciar a edição do conteúdo original."
            )
        return note

    def export_native_pdf_edit(self, identifier, revision, operation, destination):
        """Apply a native PDF content transaction without touching source.pdf.

        Ink/comment overlays are separate from PDF operators. Refuse to silently
        discard them in this early native-export implementation.
        """
        from ..readers.pdf.native_edit import PdfNativeEditor

        note = self.require_native_pdf_edit(identifier, revision)
        content = note["content"]
        source = self.source(identifier)
        return PdfNativeEditor.apply(
            source, destination, operation,
            expected_sha256=content.get("source_sha256"),
        )

    def export_selected_slide(self, identifier, revision, slide_index, destination):
        """Export exactly one editable slide as an independently editable PPTX.

        The user-selected index is zero-based, validated before filesystem work.
        Never modifies the source presentation, source model or active session.
        """
        from copy import deepcopy
        from ..readers.pptx.exporter import export_pptx

        note = self.get(identifier)
        if note["source_kind"] != "pptx" or not note["content"].get("editable_deck"):
            raise ValueError("Exporte slides isolados de uma apresentação editável.")
        if type(revision) is not int or revision != note["revision"]:
            raise RevisionConflict("Salve a apresentação antes de exportar um slide.")
        surfaces = note["content"]["surfaces"]
        if type(slide_index) is not int or not 0 <= slide_index < len(surfaces):
            raise ValueError("Slide selecionado inválido.")
        destination = Path(destination).with_suffix(".pptx")
        source = self.source(identifier)
        if (
            destination.is_symlink()
            or destination.resolve() == source.resolve()
            or not destination.parent.is_dir()
        ):
            raise ValueError("Escolha um destino válido, diferente do original.")
        model = deepcopy(note["content"])
        model["surfaces"] = [deepcopy(surfaces[slide_index])]
        model["surfaces"][0]["index"] = 0
        # Preserve native shapes, charts, workbook, images and transitions.
        fd, name = tempfile.mkstemp(
            prefix=".opendoc-slide-", suffix=".pptx", dir=destination.parent
        )
        os.close(fd)
        temporary = Path(name)
        try:
            export_pptx(source, model, temporary)
            if not temporary.is_file() or temporary.stat().st_size == 0:
                raise ValueError("Falha ao criar a apresentação do slide.")
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return {
            "path": str(destination),
            "name": destination.name,
            "revision": revision,
            "slide_index": slide_index,
            "slides": 1,
            "lossy": False,
            "warnings": [],
        }

    def extract_pages(self, identifier, revision, first_page, last_page, destination):
        """Extract an inclusive PDF page interval with existing ink/annotations.

        Export through the ordinary annotated-PDF path first, then copy pages
        losslessly. The immutable imported source and SQLite history stay intact.
        """
        from pypdf import PdfReader, PdfWriter

        note = self.get(identifier)
        if note["source_kind"] != "pdf":
            raise ValueError("A extração de páginas só está disponível para PDFs.")
        if type(first_page) is not int or type(last_page) is not int:
            raise ValueError("Os números de página devem ser inteiros.")
        total = len(note["content"]["surfaces"])
        if not 1 <= first_page <= last_page <= total:
            raise ValueError("Intervalo de páginas inválido.")
        if note["revision"] != revision:
            raise RevisionConflict("Salve a versão atual antes de extrair páginas.")

        destination = Path(destination).with_suffix(".pdf")
        source = self.source(identifier)
        if (destination.is_symlink() or
            destination.resolve() == source.resolve() or
            (destination.is_file() and
             hashlib.sha256(destination.read_bytes()).hexdigest()
             == note["content"]["source_sha256"])):
            raise ValueError("Escolha um destino diferente do original.")
        if not destination.parent.is_dir():
            raise ValueError("Pasta de exportação não encontrada.")

        with tempfile.TemporaryDirectory(
            prefix=".opendoc-pages-", dir=destination.parent
        ) as folder:
            work = Path(folder)
            annotated = work / "annotated.pdf"
            self.export(identifier, revision, "pdf", annotated)
            reader = PdfReader(annotated, strict=False)
            if len(reader.pages) != total:
                raise ValueError("A quantidade de páginas exportadas não confere.")
            writer = PdfWriter()
            for index in range(first_page - 1, last_page):
                writer.add_page(reader.pages[index])
            writer.add_metadata({"/Title": note["title"], "/Creator": "Open Doc"})
            staged = work / "extracted.pdf"
            with staged.open("wb") as stream:
                writer.write(stream)
            if not staged.stat().st_size:
                raise ValueError("O PDF extraído está vazio.")
            os.replace(staged, destination)

        return {
            "path": str(destination),
            "name": destination.name,
            "revision": revision,
            "pages": last_page - first_page + 1,
            "lossy": False,
            "warnings": [],
        }

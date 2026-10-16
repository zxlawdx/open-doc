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
from ..readers.pptx.preview import libreoffice_executable, convert_to_pdf
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
        can_preview = note["source_kind"] == "pdf" or preview.is_file()
        handwriting = getattr(self, "handwriting", None)
        note["capabilities"] = {
            "preview": can_preview,
            "ink": can_preview,
            "handwriting": can_preview
            and handwriting is not None
            and any(b["available"] for b in handwriting.capabilities()),
            "pptx_preview": {
                "available": preview.is_file(),
                "backend": "libreoffice" if preview.is_file() else None,
            },
        }
        return note

    def select(self, identifier):
        note = self.get(identifier)
        self.activate(note["source_kind"], identifier)
        return note

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
            if kind == "pptx" and libreoffice_executable():
                try:
                    temporary, preview = convert_to_pdf(
                        libreoffice_executable(), source
                    )
                    try:
                        shutil.copyfile(preview, directory / "preview.pdf")
                    finally:
                        temporary.cleanup()
                except Exception:
                    # Keep original and annotations available if conversion fails.
                    pass
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
        if (
            content["source_sha256"] != old["content"]["source_sha256"]
            or content["source_kind"] != old["source_kind"]
            or [(s["width_pt"], s["height_pt"]) for s in content["surfaces"]]
            != [(s["width_pt"], s["height_pt"]) for s in old["content"]["surfaces"]]
        ):
            raise ValueError("Não altere a geometria/origem do documento fixo.")
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
                c.execute(
                    "INSERT OR REPLACE INTO fixed_recovery VALUES (?,?,?,?)",
                    (identifier, title, serialize(content), revision),
                )
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
        if fmt not in (["pdf"] if note["source_kind"] == "pdf" else ["pptx", "pdf"]):
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

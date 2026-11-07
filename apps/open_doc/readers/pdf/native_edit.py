"""Strict native PDF content-stream edits, never annotation overlays.

Supports only unambiguous WinAnsi Standard-14 text-show operations and image
drawing occurrences with an isolated q/cm/Do/Q graphics-state block. All other
layouts (subset/CID fonts, complex shaped text, shared or masked image
operators, signed/encrypted documents) fail closed, preserving the original.
pypdf is BSD-3-Clause; this module deliberately does not depend on PyMuPDF.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import tempfile
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ByteStringObject,
    ContentStream,
    FloatObject,
    NameObject,
)

STANDARD_FONTS = {
    "/Helvetica", "/Helvetica-Bold", "/Helvetica-Oblique",
    "/Helvetica-BoldOblique", "/Times-Roman", "/Times-Bold",
    "/Times-Italic", "/Times-BoldItalic", "/Courier",
    "/Courier-Bold", "/Courier-Oblique", "/Courier-BoldOblique",
    "/Symbol", "/ZapfDingbats",
}


class PdfNativeEditError(ValueError):
    """A safe native edit cannot be guaranteed for this document or operation."""


class PdfNativeEditor:
    """Transactional modifications to original PDF drawing instructions."""

    @staticmethod
    def _reader(source: Path, expected_sha256: str | None) -> PdfReader:
        if not source.is_file() or source.stat().st_size > 50 * 1024 * 1024:
            raise PdfNativeEditError("PDF ausente ou grande demais para edição segura.")
        content = source.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if expected_sha256 is not None and digest != expected_sha256:
            raise PdfNativeEditError("O PDF original mudou desde o início da edição.")
        # Editing a digitally signed PDF invalidates signatures.
        if b"/ByteRange" in content:
            raise PdfNativeEditError("PDF assinado: edição bloqueada para preservar a assinatura.")
        reader = PdfReader(str(source), strict=True)
        if reader.is_encrypted:
            raise PdfNativeEditError("PDF criptografado: desbloqueie uma cópia autorizada.")
        fields = reader.get_fields() or {}
        if any(str(value.get("/FT", "")) == "/Sig" for value in fields.values()):
            raise PdfNativeEditError("PDF com campos de assinatura não pode ser alterado.")
        return reader

    @staticmethod
    def _font(page, resource_name) -> str:
        resources = page.get("/Resources")
        fonts = resources.get("/Font", {}) if resources else {}
        entry = fonts.get(resource_name)
        if entry is None:
            raise PdfNativeEditError("Fonte PDF não encontrada no dicionário de recursos.")
        font = entry.get_object()
        name = str(font.get("/BaseFont", ""))
        if (
            name not in STANDARD_FONTS
            or font.get("/ToUnicode") is not None
            or font.get("/DescendantFonts") is not None
            or str(font.get("/Encoding", "/WinAnsiEncoding")) not in
                {"/WinAnsiEncoding", "/StandardEncoding"}
            or name in {"/Symbol", "/ZapfDingbats"}
        ):
            raise PdfNativeEditError(
                "Fonte incorporada/subsetada ou codificação complexa: edição nativa não segura."
            )
        return name

    @staticmethod
    def _open_ops(writer: PdfWriter, page_index: int):
        if type(page_index) is not int or not 0 <= page_index < len(writer.pages):
            raise PdfNativeEditError("Número de página inválido.")
        page = writer.pages[page_index]
        if page.get_contents() is None:
            raise PdfNativeEditError("A página não possui conteúdo editável.")
        return page, ContentStream(page.get_contents(), writer)

    @classmethod
    def _replace_text(
        cls, writer: PdfWriter, page_index: int, old: str, new: str,
        occurrence: int | None, allow_expansion: bool,
    ) -> dict:
        if not old or old == new or "\n" in old or "\r" in old or "\n" in new or "\r" in new:
            raise PdfNativeEditError("Selecione uma expressão textual de uma única linha.")
        try:
            old_bytes, new_bytes = old.encode("cp1252"), new.encode("cp1252")
        except UnicodeEncodeError as exc:
            raise PdfNativeEditError("Esta fonte não representa os caracteres solicitados.") from exc
        if not new or len(new_bytes) > len(old_bytes) * 1.1 and not allow_expansion:
            raise PdfNativeEditError(
                "O texto novo pode ultrapassar a caixa; confirme expansão explicitamente."
            )
        page, stream = cls._open_ops(writer, page_index)
        inside_text = False
        active_font = None
        matches = []
        for index, (operands, op) in enumerate(stream.operations):
            if op == b"Tf":
                # PDF text-state font is retained across BT/ET blocks. In
                # particular FPDF2 selects /F1 in a separate BT/ET sequence.
                active_font = operands[0]
            elif op == b"BT":
                inside_text = True
            elif op == b"ET":
                inside_text = False
            elif inside_text and op == b"Tj" and operands:
                value = operands[0]
                try:
                    original = (
                        value.original_bytes if hasattr(value, "original_bytes")
                        else bytes(value)
                    )
                except (TypeError, ValueError):
                    raise PdfNativeEditError("Operando de texto PDF não suportado.")
                if old_bytes not in original:
                    continue
                if active_font is None:
                    raise PdfNativeEditError("Fonte ativa não identificada.")
                cls._font(page, active_font)
                # Each match is an occurrence; never alter all identical words
                # without an explicit, stable selection.
                offset = 0
                while True:
                    loc = original.find(old_bytes, offset)
                    if loc < 0:
                        break
                    matches.append((index, loc, original))
                    offset = loc + len(old_bytes)
        if not matches:
            raise PdfNativeEditError(
                "Texto não localizado em operador Tj editável; PDF complexo não alterado."
            )
        if occurrence is None:
            if len(matches) != 1:
                raise PdfNativeEditError("Mais de uma ocorrência; selecione a ocorrência exata.")
            occurrence = 0
        if type(occurrence) is not int or not 0 <= occurrence < len(matches):
            raise PdfNativeEditError("Ocorrência de texto inválida.")
        op_index, offset, original = matches[occurrence]
        patched = original[:offset] + new_bytes + original[offset + len(old_bytes):]
        stream.operations[op_index][0][0] = ByteStringObject(patched)
        page.replace_contents(stream)
        return {
            "page": page_index, "kind": "replace_text", "occurrence": occurrence,
            "matches": len(matches),
            "warnings": (
                ["O texto ampliado pode alterar o encaixe visual. Confira a prévia."]
                if len(new_bytes) > len(old_bytes) else []
            ),
        }

    @classmethod
    def _move_image(
        cls, writer: PdfWriter, page_index: int, occurrence: int,
        dx: float, dy: float,
    ) -> dict:
        if type(occurrence) is not int or occurrence < 0:
            raise PdfNativeEditError("Ocorrência de imagem inválida.")
        if not all(
            type(v) in (int, float) and math.isfinite(v) and abs(v) <= 20000
            for v in (dx, dy)
        ):
            raise PdfNativeEditError("Deslocamento da imagem fora dos limites.")
        page, stream = cls._open_ops(writer, page_index)
        resources = page.get("/Resources", {})
        images = resources.get("/XObject", {})
        candidates = []
        for i, (operands, op) in enumerate(stream.operations):
            if op != b"Do" or not operands:
                continue
            object_ref = images.get(operands[0])
            if object_ref is None:
                continue
            obj = object_ref.get_object()
            if str(obj.get("/Subtype")) != "/Image":
                continue
            candidates.append(i)
        if occurrence >= len(candidates):
            raise PdfNativeEditError("Imagem não localizada na página.")
        i = candidates[occurrence]
        ops = stream.operations
        # A standalone graphics-state block changes ONE drawing occurrence,
        # even when the same Image XObject is reused elsewhere.
        if not (
            i >= 2 and i + 1 < len(ops)
            and ops[i - 2][1] == b"q"
            and ops[i - 1][1] == b"cm"
            and ops[i + 1][1] == b"Q"
            and len(ops[i - 1][0]) == 6
        ):
            raise PdfNativeEditError(
                "Imagem com transformações compartilhadas; mover requer análise avançada."
            )
        matrix = ops[i - 1][0]
        matrix[4] = FloatObject(float(matrix[4]) + dx)
        matrix[5] = FloatObject(float(matrix[5]) + dy)
        page.replace_contents(stream)
        return {"page": page_index, "kind": "move_image",
                "occurrence": occurrence, "dx": dx, "dy": dy, "warnings": []}

    @classmethod
    def apply(
        cls, source: str | Path, destination: str | Path,
        operation: dict, *, expected_sha256: str | None = None,
    ) -> dict:
        """Apply one operation atomically, then reopen/validate its actual output."""
        source, destination = Path(source), Path(destination)
        if not isinstance(operation, dict) or destination.suffix.lower() != ".pdf":
            raise PdfNativeEditError("Operação ou arquivo de destino inválido.")
        if destination.is_symlink() or source.resolve() == destination.resolve():
            raise PdfNativeEditError("Preserve o arquivo original; escolha outro destino.")
        if not destination.parent.is_dir():
            raise PdfNativeEditError("A pasta de destino não existe.")
        reader = cls._reader(source, expected_sha256)
        writer = PdfWriter(clone_from=reader)
        kind = operation.get("kind")
        if kind == "batch":
            tasks = operation.get("operations")
            if not isinstance(tasks, list) or not 1 <= len(tasks) <= 20:
                raise PdfNativeEditError("Lote deve conter entre 1 e 20 alterações.")
            if any(not isinstance(item, dict) or item.get("kind") not in
                   {"replace_text", "move_image"} for item in tasks):
                raise PdfNativeEditError("Lote de edição PDF inválido.")
        else:
            tasks = [operation]
        results = []
        for task in tasks:
            current_kind = task.get("kind")
            page_index = task.get("page")
            if current_kind == "replace_text":
                result = cls._replace_text(
                    writer, page_index, task.get("old", ""), task.get("new", ""),
                    task.get("occurrence"), task.get("allow_expansion", False),
                )
            elif current_kind == "move_image":
                result = cls._move_image(
                    writer, page_index, task.get("occurrence", 0),
                    task.get("dx", 0), task.get("dy", 0),
                )
            else:
                raise PdfNativeEditError("Operação de edição PDF ainda não suportada.")
            results.append(result)
        fd, tmp_name = tempfile.mkstemp(
            prefix=".open-doc-native-", suffix=".pdf", dir=destination.parent
        )
        os.close(fd)
        temporary = Path(tmp_name)
        try:
            with temporary.open("wb") as file:
                writer.write(file)
            checked = PdfReader(str(temporary), strict=True)
            if len(checked.pages) != len(reader.pages):
                raise PdfNativeEditError("A exportação alterou o número de páginas.")
            # Group replacements per page/word to check every change against
            # the original, not just the last mutation. No partial results.
            count_by_source = {}
            for item in tasks:
                if item["kind"] != "replace_text":
                    continue
                page_index = item["page"]
                key = (page_index, item["old"])
                count_by_source[key] = count_by_source.get(key, 0) + 1
                text = checked.pages[page_index].extract_text()
                if item["new"] not in text:
                    raise PdfNativeEditError("Texto substituto não presente no PDF.")
            for (page_index, old), expected in count_by_source.items():
                before = reader.pages[page_index].extract_text()
                after = checked.pages[page_index].extract_text()
                pattern = re.compile(r"(?<!\w)" + re.escape(old) + r"(?!\w)")
                before_count = len(pattern.findall(before))
                after_count = len(pattern.findall(after))
                if before_count < expected or before_count-after_count != expected:
                    raise PdfNativeEditError(
                        "As ocorrências originais não foram substituídas com segurança."
                    )
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        if kind == "batch":
            return {"kind": "batch", "operations": results,
                    "path": str(destination), "pages": len(checked.pages)}
        return {**results[0], "path": str(destination),
                "pages": len(checked.pages)}

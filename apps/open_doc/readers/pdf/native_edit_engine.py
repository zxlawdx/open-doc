"""Transactional edits to PDF *content*, not visual annotation overlays.

This intentionally narrow engine rewrites actual PDF drawing instructions. If a
file uses unknown fonts, encoded glyph maps, multiple drawing contexts, or a
non-trivial graphics state, it raises an explicit UnsupportedPdfEdit rather
than silently claiming to edit a document. pikepdf is MPL-2.0.
"""

from __future__ import annotations

import hashlib
import io
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import pikepdf
from PIL import Image


class UnsupportedPdfEdit(ValueError):
    """The requested edit cannot safely preserve unrelated PDF content."""


@dataclass(frozen=True)
class PdfEditOperation:
    kind: Literal[
        "replace_literal_text",
        "insert_text",
        "delete_image_draw",
        "move_image_draw",
        "replace_image",
    ]
    page: int
    target: str = ""
    replacement: str = ""
    x: float = 0.0
    y: float = 0.0
    occurrence: int = 0
    image_bytes: bytes = b""


_SIMPLE_FONTS = {
    "/Helvetica",
    "/Helvetica-Bold",
    "/Helvetica-Oblique",
    "/Helvetica-BoldOblique",
    "/Times-Roman",
    "/Times-Bold",
    "/Times-Italic",
    "/Courier",
    "/Courier-Bold",
}


def _simple_fonts_only(page):
    fonts = page.get("/Resources", {}).get("/Font", {})
    for font in fonts.values():
        font_name = str(font.get("/BaseFont", ""))
        subtype = str(font.get("/Subtype", ""))
        encoding = str(font.get("/Encoding", "/StandardEncoding"))
        if (
            subtype != "/Type1"
            or font_name not in _SIMPLE_FONTS
            or encoding not in {"/WinAnsiEncoding", "/StandardEncoding"}
        ):
            return False
    return True


def _page(pdf, index):
    if not isinstance(index, int) or isinstance(index, bool):
        raise UnsupportedPdfEdit("O número da página precisa ser inteiro.")
    if index < 0 or index >= len(pdf.pages):
        raise UnsupportedPdfEdit("Página fora dos limites.")
    page = pdf.pages[index]
    if "/Contents" not in page:
        raise UnsupportedPdfEdit("Esta página não possui conteúdo editável.")
    return page


def _instructions(page):
    try:
        return [
            (list(operands), operator)
            for operands, operator in pikepdf.parse_content_stream(page)
        ]
    except (ValueError, pikepdf.PdfError) as error:
        raise UnsupportedPdfEdit(
            "Não foi possível interpretar com segurança o conteúdo PDF."
        ) from error


def _rewrite(pdf, page, instructions):
    content = pikepdf.unparse_content_stream(instructions)
    page.Contents = pdf.make_stream(content)


def _ascii_safe(text):
    if not isinstance(text, str) or not text or not text.isascii():
        raise UnsupportedPdfEdit(
            "Esta operação admite apenas texto ASCII em fontes simples."
        )
    if any(ord(character) < 32 or ord(character) > 126 for character in text):
        raise UnsupportedPdfEdit("Texto contém controles não suportados.")


def _replace_literal_text(pdf, page, operation):
    _ascii_safe(operation.target)
    _ascii_safe(operation.replacement)
    if not _simple_fonts_only(page):
        raise UnsupportedPdfEdit(
            "PDF com fontes incorporadas, CID ou mapeamento de glifos não suportado."
        )
    instructions = _instructions(page)
    matches = []
    for index, (operands, operator) in enumerate(instructions):
        # Only a complete single Tj literal is safe. String spans,
        # glyph-coded fonts, TJ arrays and Form XObjects are not guessed.
        if str(operator) != "Tj" or len(operands) != 1:
            continue
        if str(operands[0]) == operation.target:
            matches.append(index)
    if len(matches) != 1:
        raise UnsupportedPdfEdit(
            "Texto ausente ou ambíguo no fluxo original; nenhuma alteração realizada."
        )
    index = matches[0]
    instructions[index] = (
        [pikepdf.String(operation.replacement)],
        pikepdf.Operator("Tj"),
    )
    _rewrite(pdf, page, instructions)


def _insert_text(pdf, page, operation):
    _ascii_safe(operation.replacement)
    if not (0 <= operation.x <= float(page.mediabox[2])) or not (
        0 <= operation.y <= float(page.mediabox[3])
    ):
        raise UnsupportedPdfEdit("Texto inserido fora da página.")
    if "/Resources" not in page:
        page.Resources = pikepdf.Dictionary()
    else:
        # Copy inherited/shared resources before modifying the page.
        page.Resources = pikepdf.Dictionary(page.Resources)
    current_fonts = page.Resources.get("/Font", pikepdf.Dictionary())
    fonts = pikepdf.Dictionary(current_fonts)
    name = pikepdf.Name("/OpenDocNativeText")
    if name in fonts:
        raise UnsupportedPdfEdit("Esta página já contém a fonte reservada.")
    fonts[name] = pikepdf.Dictionary(
        Type=pikepdf.Name("/Font"),
        Subtype=pikepdf.Name("/Type1"),
        BaseFont=pikepdf.Name("/Helvetica"),
        Encoding=pikepdf.Name("/WinAnsiEncoding"),
    )
    page.Resources.Font = fonts
    operations = [
        ([], pikepdf.Operator("q")),
        ([], pikepdf.Operator("BT")),
        ([name, 12], pikepdf.Operator("Tf")),
        ([operation.x, operation.y], pikepdf.Operator("Td")),
        ([pikepdf.String(operation.replacement)], pikepdf.Operator("Tj")),
        ([], pikepdf.Operator("ET")),
        ([], pikepdf.Operator("Q")),
    ]
    page.add_content(pikepdf.unparse_content_stream(operations))


def _image_resource(page, target):
    if not target or not target.startswith("/") or "/" in target[1:]:
        raise UnsupportedPdfEdit("Informe um nome de recurso PDF como /Im0.")
    resources = page.get("/Resources", {})
    xobjects = resources.get("/XObject", {})
    key = pikepdf.Name(target)
    obj = xobjects.get(key)
    if obj is None or str(obj.get("/Subtype", "")) != "/Image":
        raise UnsupportedPdfEdit("Recurso de imagem ausente ou não é uma imagem.")
    return key, obj


def _image_draws(instructions, name):
    return [
        index
        for index, (operands, operator) in enumerate(instructions)
        if str(operator) == "Do" and len(operands) == 1 and operands[0] == name
    ]


def _delete_image_draw(pdf, page, operation):
    name, _ = _image_resource(page, operation.target)
    instructions = _instructions(page)
    draws = _image_draws(instructions, name)
    if operation.occurrence < 0 or operation.occurrence >= len(draws):
        raise UnsupportedPdfEdit("Ocorrência de imagem não encontrada.")
    del instructions[draws[operation.occurrence]]
    _rewrite(pdf, page, instructions)
    # Drop the resource when the last draw is removed (no hidden image draw
    # remains in this page's stream). This is a real content edit.
    if len(draws) == 1:
        page.Resources = pikepdf.Dictionary(page.Resources)
        xobjects = pikepdf.Dictionary(page.Resources.XObject)
        del xobjects[name]
        page.Resources.XObject = xobjects


def _move_image_draw(pdf, page, operation):
    name, _ = _image_resource(page, operation.target)
    instructions = _instructions(page)
    draws = _image_draws(instructions, name)
    if operation.occurrence < 0 or operation.occurrence >= len(draws):
        raise UnsupportedPdfEdit("Ocorrência de imagem não encontrada.")
    draw = draws[operation.occurrence]
    # Only the isolated pattern q, cm, /Name Do, Q is safe to translate.
    # Arbitrarily modifying a surrounding cm can also move unrelated text.
    if draw < 2 or draw + 1 >= len(instructions):
        raise UnsupportedPdfEdit("A matriz desta imagem não está isolada.")
    if [
        str(instructions[draw - 2][1]),
        str(instructions[draw - 1][1]),
        str(instructions[draw + 1][1]),
    ] != ["q", "cm", "Q"]:
        raise UnsupportedPdfEdit(
            "A imagem compartilha estado gráfico com outros objetos."
        )
    transform = instructions[draw - 1][0]
    if len(transform) != 6:
        raise UnsupportedPdfEdit("Matriz de transformação inesperada.")
    transform[4] = float(transform[4]) + operation.x
    transform[5] = float(transform[5]) + operation.y
    _rewrite(pdf, page, instructions)


def _replace_image(pdf, page, operation):
    name, original = _image_resource(page, operation.target)
    if not operation.image_bytes or len(operation.image_bytes) > 20_000_000:
        raise UnsupportedPdfEdit("Imagem ausente ou excede 20 MB.")
    # Do not silently erase masks, ICC profiles or other advanced semantics.
    if any(x in original for x in ("/SMask", "/Mask", "/ImageMask")):
        raise UnsupportedPdfEdit("Máscaras de imagem precisam de editor avançado.")
    with Image.open(io.BytesIO(operation.image_bytes)) as candidate:
        if candidate.width < 1 or candidate.height < 1:
            raise UnsupportedPdfEdit("Dimensões de imagem inválidas.")
        image = candidate.convert("RGB")
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=94)
    replacement = pdf.make_stream(output.getvalue())
    replacement.Type = pikepdf.Name("/XObject")
    replacement.Subtype = pikepdf.Name("/Image")
    replacement.Width = image.width
    replacement.Height = image.height
    replacement.ColorSpace = pikepdf.Name("/DeviceRGB")
    replacement.BitsPerComponent = 8
    replacement.Filter = pikepdf.Name("/DCTDecode")
    page.Resources = pikepdf.Dictionary(page.Resources)
    xobjects = pikepdf.Dictionary(page.Resources.XObject)
    xobjects[name] = replacement
    page.Resources.XObject = xobjects


class NativePdfEditSession:
    """Revision-limited atomic edits with undo/redo and source-byte integrity."""

    def __init__(self, source: bytes, max_revisions: int = 15):
        if not source.startswith(b"%PDF-") or len(source) > 50_000_000:
            raise UnsupportedPdfEdit("O PDF precisa ser válido e ter até 50 MB.")
        if not 1 <= max_revisions <= 30:
            raise ValueError("Limite de histórico inválido.")
        self._states = [source]
        self._cursor = 0
        self._max_revisions = max_revisions
        self.origin_sha256 = hashlib.sha256(source).hexdigest()

    def snapshot(self):
        return self._states[self._cursor]

    def apply(self, operation: PdfEditOperation):
        if not isinstance(operation, PdfEditOperation):
            raise TypeError("Operação PDF inválida.")
        with pikepdf.Pdf.open(io.BytesIO(self.snapshot())) as pdf:
            if pdf.is_encrypted:
                raise UnsupportedPdfEdit("PDF criptografado não é editável.")
            page = _page(pdf, operation.page)
            handlers = {
                "replace_literal_text": _replace_literal_text,
                "insert_text": _insert_text,
                "delete_image_draw": _delete_image_draw,
                "move_image_draw": _move_image_draw,
                "replace_image": _replace_image,
            }
            handler = handlers.get(operation.kind)
            if handler is None:
                raise UnsupportedPdfEdit("Tipo de edição ainda não suportado.")
            handler(pdf, page, operation)
            output = io.BytesIO()
            pdf.save(output)
            value = output.getvalue()
        if not value.startswith(b"%PDF-"):
            raise UnsupportedPdfEdit("A gravação gerou um PDF inválido.")
        with pikepdf.Pdf.open(io.BytesIO(value)) as check:
            if not len(check.pages):
                raise UnsupportedPdfEdit("O PDF editado perdeu suas páginas.")
        self._states = self._states[: self._cursor + 1] + [value]
        if len(self._states) > self._max_revisions:
            self._states.pop(0)
        self._cursor = len(self._states) - 1
        return {"revision": self._cursor, "bytes": len(value)}

    def undo(self):
        if self._cursor == 0:
            return False
        self._cursor -= 1
        return True

    def redo(self):
        if self._cursor + 1 >= len(self._states):
            return False
        self._cursor += 1
        return True

    def export(self, destination: Path):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, path = tempfile.mkstemp(
            dir=destination.parent, prefix=".open-doc-edit-", suffix=".pdf"
        )
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(self.snapshot())
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(path, destination)
        finally:
            Path(path).unlink(missing_ok=True)
        return destination

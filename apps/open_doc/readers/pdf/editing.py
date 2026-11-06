"""Conservative *native content-stream* PDF editing, not visual overlays.

Only supports verifiable standard-font text and isolated image draw commands.
Unknown transforms, fonts, signatures or ambiguous occurrences are refused.
Original files are never modified. Operator changes are applied to a copy.
"""
from __future__ import annotations

import io
import re
import uuid
from pathlib import Path

from PIL import Image, ImageOps
from pypdf import PdfReader
from pikepdf import Array, Dictionary, Name, Operator, Pdf, String
from pikepdf import parse_content_stream, unparse_content_stream

_STANDARD_FONTS = {
    "/Helvetica", "/Helvetica-Bold", "/Helvetica-Oblique",
    "/Helvetica-BoldOblique", "/Times-Roman", "/Times-Bold",
    "/Times-Italic", "/Times-BoldItalic", "/Courier", "/Courier-Bold",
    "/Courier-Oblique", "/Courier-BoldOblique",
}


class UnsafePDFEdit(ValueError):
    """Cannot guarantee that the requested edit preserves original content."""


def _signature_present(reader: PdfReader) -> bool:
    try:
        if reader.trailer["/Root"].get("/Perms"):
            return True
        fields = reader.get_fields() or {}
        if any(str(field.get("/FT", "")) == "/Sig" or field.get("/V")
               and str(field.get("/FT", "")) == "/Sig"
               for field in fields.values()):
            return True
    except Exception as exc:
        raise UnsafePDFEdit("Não foi possível verificar assinaturas do PDF.") from exc
    return False


def _instructions(page):
    try:
        return [(list(operands), operator)
                for operands, operator in parse_content_stream(page)]
    except Exception as exc:
        raise UnsafePDFEdit("Fluxo de conteúdo PDF não suportado.") from exc


def _safe_font(page, font_key):
    resources = page.obj.get("/Resources", Dictionary())
    fonts = resources.get("/Font", Dictionary())
    font = fonts.get(font_key)
    if font is None:
        return False
    base = str(font.get("/BaseFont", ""))
    # Custom/subset fonts map byte codes to glyphs unpredictably. Never assume
    # that replacing bytes will replace the intended Unicode characters.
    return (
        str(font.get("/Subtype", "")) == "/Type1"
        and base in _STANDARD_FONTS
        and font.get("/ToUnicode") is None
        and str(font.get("/Encoding", "/StandardEncoding"))
        in {"/StandardEncoding", "/WinAnsiEncoding"}
    )


def _edit_text(page, instructions, edit):
    old = edit["old_text"]
    new = edit["new_text"]
    if not (1 <= len(old) <= 256 and 0 <= len(new) <= 256):
        raise UnsafePDFEdit("Substituição textual fora dos limites suportados.")
    if not all(32 <= ord(ch) < 127 for ch in old + new):
        raise UnsafePDFEdit(
            "Esta versão aceita texto ASCII em fontes padrão. "
            "Fontes codificadas ou acentos requerem mapeamento verificado."
        )
    matches = []
    font_key = None
    for index, (operands, operator) in enumerate(instructions):
        if operator == Operator("Tf") and operands:
            font_key = operands[0]
        elif operator == Operator("Tj") and len(operands) == 1:
            value = operands[0]
            try:
                literal = bytes(value).decode("ascii")
            except (ValueError, UnicodeError, TypeError):
                continue
            if old in literal:
                if not _safe_font(page, font_key):
                    raise UnsafePDFEdit(
                        "O texto utiliza fonte incorporada/complexa. Edição recusada."
                    )
                matches.extend([(index, literal)] * literal.count(old))
    if len(matches) != 1:
        raise UnsafePDFEdit(
            "Trecho de texto ausente ou ambíguo. Selecione um fragmento único."
        )
    index, literal = matches[0]
    operands, operator = instructions[index]
    operands[0] = String(literal.replace(old, new, 1))
    instructions[index] = (operands, operator)
    return True


def _image_draws(page, instructions):
    xobjects = page.obj.get("/Resources", Dictionary()).get("/XObject", Dictionary())
    for index, (operands, operator) in enumerate(instructions):
        if operator != Operator("Do") or len(operands) != 1:
            continue
        name = operands[0]
        xobj = xobjects.get(name)
        if xobj is not None and str(xobj.get("/Subtype", "")) == "/Image":
            yield index, name


def _image_operation(pdf, page, instructions, edit, asset_directory):
    drawings = list(_image_draws(page, instructions))
    occurrence = edit["occurrence"]
    if not isinstance(occurrence, int) or isinstance(occurrence, bool) or not 0 <= occurrence < len(drawings):
        raise UnsafePDFEdit("Ocorrência de imagem inválida.")
    index, name = drawings[occurrence]
    if not (index >= 2 and index + 1 < len(instructions)
            and instructions[index-2][1] == Operator("q")
            and instructions[index-1][1] == Operator("cm")
            and instructions[index+1][1] == Operator("Q")):
        raise UnsafePDFEdit(
            "Imagem usa transformações complexas. Não é seguro mover esta ocorrência."
        )
    matrix, op = instructions[index-1]
    if len(matrix) != 6:
        raise UnsafePDFEdit("Matriz gráfica inválida.")
    a, b, c, d, e, f = map(float, matrix)
    if abs(b)>0.000001 or abs(c)>0.000001 or a<=0 or d<=0:
        raise UnsafePDFEdit("Imagem rotacionada/refletida exige editor avançado.")
    kind = edit["kind"]
    if kind == "move_image":
        dx = float(edit["dx_pt"])
        dy = float(edit["dy_pt"])
        if not all(abs(n) <= 20000 for n in (dx,dy)):
            raise UnsafePDFEdit("Movimento fora da página.")
        e += dx
        f -= dy  # viewport y increases downward; PDF y increases upward
    elif kind == "resize_image":
        sx, sy = float(edit["scale_x"]), float(edit["scale_y"])
        if not all(0.05 <= v <= 8 for v in (sx,sy)):
            raise UnsafePDFEdit("Escala da imagem fora dos limites.")
        a *= sx
        d *= sy
        f -= d * (1 - 1 / sy)  # preserve upper-left anchor
    elif kind == "delete_image":
        del instructions[index]
        return
    elif kind == "replace_image":
        asset = edit["asset"]
        if not re.fullmatch(r"[a-f0-9]{32}\.png", asset):
            raise UnsafePDFEdit("Identificador de imagem inválido.")
        image_path = asset_directory / asset
        if (image_path.is_symlink() or not image_path.is_file()
                or image_path.resolve().parent != asset_directory.resolve()):
            raise UnsafePDFEdit("Imagem substituta indisponível.")
        if image_path.stat().st_size > 10*1024*1024:
            raise UnsafePDFEdit("Imagem excede 10 MB.")
        with Image.open(image_path) as uploaded:
            image = ImageOps.exif_transpose(uploaded).convert("RGBA")
            image.thumbnail((4096,4096))
            rgb = Image.new("RGB", image.size, (255,255,255))
            rgb.paste(image, mask=image.getchannel("A"))
            new_image = pdf.make_stream(rgb.tobytes())
            new_image.Type = Name("/XObject")
            new_image.Subtype = Name("/Image")
            new_image.Width, new_image.Height = image.size
            new_image.BitsPerComponent = 8
            new_image.ColorSpace = Name("/DeviceRGB")
            if image.getchannel("A").getextrema() != (255,255):
                alpha = pdf.make_stream(image.getchannel("A").tobytes())
                alpha.Type, alpha.Subtype = Name("/XObject"), Name("/Image")
                alpha.Width, alpha.Height = image.size
                alpha.BitsPerComponent = 8
                alpha.ColorSpace = Name("/DeviceGray")
                new_image.SMask = alpha
        resources = Dictionary(page.obj.get("/Resources", Dictionary()))
        xobjects = Dictionary(resources.get("/XObject", Dictionary()))
        resource_name = Name("/OD" + uuid.uuid4().hex[:12])
        xobjects[resource_name] = new_image
        resources[Name("/XObject")] = xobjects
        page.obj[Name("/Resources")] = resources
        instructions[index] = ([resource_name], Operator("Do"))
    else:
        raise UnsafePDFEdit("Operação de imagem desconhecida.")
    if kind in {"move_image", "resize_image"}:
        crop = page.obj.get("/CropBox") or page.obj.get("/MediaBox")
        if crop is None:
            raise UnsafePDFEdit("Imagem sem geometria de página válida.")
        x0, y0, x1, y1 = map(float, crop)
        if e < x0 or f < y0 or e+a > x1 or f+d > y1:
            raise UnsafePDFEdit("A imagem ultrapassaria os limites da página.")
        instructions[index-1] = ([a,0,0,d,e,f],op)


def apply_native_pdf_edits(source, edits, destination, *, asset_directory=None):
    """Apply validated operations and atomically create a *new* editable PDF.

    Rejects unsupported content instead of covering it with paint rectangles.
    The caller is responsible for a separate temporary output and atomic rename.
    """
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve():
        raise UnsafePDFEdit("O PDF original deve ser preservado.")
    reader = PdfReader(source)
    if reader.is_encrypted or _signature_present(reader):
        raise UnsafePDFEdit("PDF criptografado ou assinado não pode ser modificado.")
    if not edits:
        raise UnsafePDFEdit("Nenhuma operação de edição informada.")
    asset_directory = Path(asset_directory) if asset_directory else source.parent / "assets"
    with Pdf.open(source) as pdf:
        pending = {}
        checks = []
        for edit in edits:
            index = edit["page_index"]
            if not isinstance(index,int) or isinstance(index,bool) or not 0 <= index < len(pdf.pages):
                raise UnsafePDFEdit("Página de edição inválida.")
            page = pdf.pages[index]
            operations = pending.setdefault(index, _instructions(page))
            if edit["kind"] == "replace_text":
                _edit_text(page,operations,edit)
                checks.append((index,edit["new_text"],edit["old_text"]))
            else:
                _image_operation(pdf,page,operations,edit,asset_directory)
        for index, operations in pending.items():
            pdf.pages[index].obj[Name("/Contents")] = pdf.make_stream(
                unparse_content_stream(operations)
            )
        pdf.save(destination)
    verified = PdfReader(destination)
    if len(verified.pages) != len(reader.pages):
        raise UnsafePDFEdit("O PDF gerado perdeu páginas.")
    for index, replacement, old in checks:
        extracted = verified.pages[index].extract_text()
        if replacement and replacement not in extracted or old in extracted:
            raise UnsafePDFEdit(
                "Texto editado não pôde ser verificado na extração do PDF."
            )
    return {"ok":True,"pages":len(verified.pages),"operations":len(edits)}

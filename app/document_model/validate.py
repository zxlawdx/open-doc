"""Bounded graph/style validation for the canonical document model."""

import json
import math
import re
from dataclasses import fields
from app.document_model.schema import TextStyle, ParagraphStyle

VERSION = "opendoc-rich-v1"
MAX_MODEL_JSON_BYTES = 16 * 1024 * 1024
MAX_OPAQUE_BYTES = 1024 * 1024
INLINE = {
    "text",
    "break",
    "tab",
    "image",
    "hyperlink",
    "note-reference",
    "field",
    "opaque-ooxml",
}
BLOCK = {"paragraph", "table", "opaque-ooxml"}
COLOR = re.compile(r"^[A-Fa-f0-9]{6}$")
HIGHLIGHTS = {
    "none",
    "yellow",
    "green",
    "cyan",
    "magenta",
    "blue",
    "red",
    "darkBlue",
    "darkCyan",
    "darkGreen",
    "darkMagenta",
    "darkRed",
    "darkYellow",
    "darkGray",
    "lightGray",
    "black",
    "white",
}


def validate_rich_document(model):
    if not isinstance(model, dict) or model.get("version") != VERSION:
        raise ValueError("Modelo de documento inválido.")
    encoded = json.dumps(model, ensure_ascii=False, allow_nan=False)
    if len(encoded.encode()) > MAX_MODEL_JSON_BYTES:
        raise ValueError("Modelo ultrapassa 16 MB.")
    ids = set()
    count = 0

    def identifier(obj):
        value = obj.get("id")
        if not isinstance(value, str) or not value or len(value) > 100 or value in ids:
            raise ValueError("Identificador de nó inválido/duplicado.")
        ids.add(value)

    def style(obj, paragraph=False):
        allowed = {f.name for f in fields(ParagraphStyle if paragraph else TextStyle)}
        if paragraph:
            allowed |= {"outline_level", "tabs"}
        if not isinstance(obj, dict) or set(obj) - allowed:
            raise ValueError("Propriedade de estilo inválida.")
        for key, value in obj.items():
            if (
                key.endswith("_pt") or key in {"outline_level", "line_spacing"}
            ) and value is not None:
                if (
                    type(value) not in (int, float)
                    or not math.isfinite(value)
                    or abs(value) > 1000000
                ):
                    raise ValueError("Medida inválida.")
        if obj.get("font_size_pt") is not None and not 1 <= obj["font_size_pt"] <= 512:
            raise ValueError("Tamanho inválido.")
        for key in (
            "bold",
            "italic",
            "strike",
            "small_caps",
            "all_caps",
            "keep_next",
            "keep_lines",
            "page_break_before",
            "widow_control",
        ):
            if obj.get(key) is not None and type(obj[key]) is not bool:
                raise ValueError("Propriedade booleana inválida.")
        for key in ("underline", "language", "style_id"):
            if obj.get(key) is not None and (
                not isinstance(obj[key], str) or len(obj[key]) > 200
            ):
                raise ValueError("Estilo textual inválido.")
        font = obj.get("font_family")
        if font is not None and (
            not isinstance(font, str)
            or len(font) > 200
            or any(c in font for c in "<>\x00")
        ):
            raise ValueError("Fonte inválida.")
        if obj.get("color") not in (None, "auto") and not COLOR.fullmatch(
            str(obj["color"])
        ):
            raise ValueError("Cor inválida.")
        if (
            obj.get("highlight") is not None
            and obj["highlight"] not in HIGHLIGHTS
            and not COLOR.fullmatch(str(obj["highlight"]))
        ):
            raise ValueError("Realce inválido.")
        if obj.get("alignment") not in (
            None,
            "left",
            "right",
            "center",
            "justify",
            "distribute",
        ):
            raise ValueError("Alinhamento inválido.")
        if obj.get("vertical_align") not in (
            None,
            "baseline",
            "superscript",
            "subscript",
        ):
            raise ValueError("Posição inválida.")

    def nodes(values, block=True, depth=0):
        nonlocal count
        if not isinstance(values, list) or depth > 40:
            raise ValueError("Estrutura inválida.")
        for obj in values:
            count += 1
            if count > 100000 or not isinstance(obj, dict):
                raise ValueError("Documento muito complexo.")
            identifier(obj)
            kind = obj.get("type")
            if kind not in (BLOCK if block else INLINE):
                raise ValueError("Tipo de nó inválido.")
            if kind == "paragraph":
                style(obj.get("style", {}), True)
                nodes(obj.get("children"), False, depth + 1)
                li = obj.get("list_info")
                if li and (
                    not isinstance(li, dict)
                    or type(li.get("level", 0)) is not int
                    or not 0 <= li.get("level", 0) <= 8
                ):
                    raise ValueError("Nível de lista inválido.")
            elif kind == "table":
                if not isinstance(obj.get("rows"), list):
                    raise ValueError("Tabela inválida.")
                for row in obj["rows"]:
                    identifier(row)
                    if not isinstance(row.get("cells"), list):
                        raise ValueError("Linha inválida.")
                    for cell in row["cells"]:
                        identifier(cell)
                        for key in ("col_span", "row_span"):
                            if (
                                type(cell.get(key, 1)) is not int
                                or not 1 <= cell.get(key, 1) <= 1000
                            ):
                                raise ValueError("Mesclagem inválida.")
                        nodes(cell.get("blocks"), True, depth + 1)
            elif kind == "text":
                if not isinstance(obj.get("text"), str):
                    raise ValueError("Texto inválido.")
                style(obj.get("style", {}))
            elif kind == "hyperlink":
                if not re.match(r"^(https?://|mailto:|#)", obj.get("href", ""), re.I):
                    raise ValueError("Link inválido.")
                nodes(obj.get("children"), False, depth + 1)
            elif kind == "image" and not re.fullmatch(
                "[a-f0-9]{64}", obj.get("media_id", "")
            ):
                raise ValueError("Imagem inválida.")
            elif kind == "break" and obj.get("break_type") not in {
                "line",
                "page",
                "column",
                "textWrapping",
            }:
                raise ValueError("Quebra inválida.")
            for key in ("xml", "raw_xml", "raw_properties", "raw_anchor_xml"):
                raw = obj.get(key)
                if raw is not None and (
                    not isinstance(raw, str) or len(raw.encode()) > MAX_OPAQUE_BYTES
                ):
                    raise ValueError("XML preservado muito grande.")

    nodes(model.get("blocks"))
    for key in ("headers", "footers", "footnotes", "endnotes", "comments"):
        if not isinstance(model.get(key, {}), dict):
            raise ValueError("Subdocumento inválido.")
        for values in model.get(key, {}).values():
            nodes(values)
    if not isinstance(model.get("sections", []), list):
        raise ValueError("Seções inválidas.")
    return model

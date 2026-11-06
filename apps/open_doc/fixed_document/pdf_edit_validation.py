"""Strictly validated, bounded operations for native PDF content changes."""
from __future__ import annotations

import math
import re


def validate_pdf_edits(model):
    edits = model.get("pdf_edits", [])
    if not isinstance(edits, list) or len(edits) > 1000:
        raise ValueError("Operações PDF inválidas ou muito numerosas.")
    if edits and model.get("source_kind") != "pdf":
        raise ValueError("Edição de conteúdo disponível apenas em PDF.")
    count = len(model.get("surfaces", []))
    for edit in edits:
        if not isinstance(edit, dict) or edit.get("kind") not in {
            "replace_text", "move_image", "resize_image", "delete_image", "replace_image"
        }:
            raise ValueError("Operação de conteúdo PDF não suportada.")
        page = edit.get("page_index")
        if isinstance(page, bool) or not isinstance(page, int) or not 0 <= page < count:
            raise ValueError("Índice de página inválido.")
        if edit["kind"] == "replace_text":
            old, new = edit.get("old_text"), edit.get("new_text")
            if (not isinstance(old, str) or not isinstance(new, str)
                or not 1 <= len(old) <= 256 or len(new) > 256
                or any(not 32 <= ord(ch) < 127 for ch in old + new)):
                raise ValueError("Texto de substituição inválido ou codificação não suportada.")
            if old == new:
                raise ValueError("A substituição não modifica o texto.")
        else:
            occurrence = edit.get("occurrence")
            if isinstance(occurrence, bool) or not isinstance(occurrence,int) or not 0 <= occurrence < 100000:
                raise ValueError("Ocorrência de imagem inválida.")
            keys = {
                "move_image": ("dx_pt", "dy_pt"),
                "resize_image": ("scale_x", "scale_y"),
                "delete_image": (),
                "replace_image": ()
            }[edit["kind"]]
            for field in keys:
                value = edit.get(field)
                if not isinstance(value, (int,float)) or isinstance(value,bool) or not math.isfinite(value):
                    raise ValueError("Deslocamento ou escala inválidos.")
            if edit["kind"] == "replace_image" and not re.fullmatch(
                r"[a-f0-9]{32}\.png", str(edit.get("asset", ""))
            ):
                raise ValueError("Imagem substituta inválida.")
    return edits

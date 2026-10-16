import json
import re
from .schema import VERSION
from ..ink.validation import validate_layers, number, MAX_JSON


def validate(model):
    if (
        not isinstance(model, dict)
        or model.get("version") != VERSION
        or model.get("source_kind") not in ["pdf", "pptx"]
    ):
        raise ValueError("Documento fixo inválido.")
    if not re.fullmatch("[a-f0-9]{64}", model.get("source_sha256", "")):
        raise ValueError("Origem inválida.")
    surfaces = model.get("surfaces")
    if not isinstance(surfaces, list) or not 1 <= len(surfaces) <= 10000:
        raise ValueError("Páginas inválidas.")
    for index, surface in enumerate(surfaces):
        if surface.get("index") != index:
            raise ValueError("Índice de página inválido.")
        number(surface.get("width_pt"), 1, 20000)
        number(surface.get("height_pt"), 1, 20000)
    validate_layers([{**s, "surface_index": s["index"]} for s in surfaces])
    if len(json.dumps(model, allow_nan=False).encode()) > MAX_JSON:
        raise ValueError("Documento ultrapassa 16 MB de anotações.")
    return model

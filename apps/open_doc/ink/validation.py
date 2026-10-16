"""Reject non-finite geometry and bound work before rendering or recognition."""

import math
import re

MAX_STROKES = 50000
MAX_POINTS = 20000
MAX_JSON = 16 * 1024 * 1024


def number(value, low, high):
    if (
        type(value) not in (int, float)
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise ValueError("Coordenada ou dimensão de tinta inválida.")
    return value


def color(value):
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValueError("Cor inválida.")


def validate_layers(layers):
    if not isinstance(layers, list) or len(layers) > 10000:
        raise ValueError("Camadas de tinta inválidas.")
    ids = set()
    count = points = 0
    for layer in layers:
        if not isinstance(layer, dict):
            raise ValueError("Camada inválida.")
        if (
            type(layer.get("surface_index")) is not int
            or not 0 <= layer["surface_index"] < 10000
        ):
            raise ValueError("Página de tinta inválida.")
        for key in ["width_pt", "height_pt"]:
            number(layer.get(key, 595.28), 1, 20000)
        strokes = layer.get("strokes", layer.get("ink", []))
        texts = layer.get("text_overlays", [])
        if not isinstance(strokes, list) or not isinstance(texts, list):
            raise ValueError("Camada inválida.")
        count += len(strokes) + len(texts)
        if count > MAX_STROKES:
            raise ValueError("Limite de tinta excedido.")
        for item in strokes + texts:
            if not isinstance(item, dict):
                raise ValueError("Elemento de tinta inválido.")
            identifier = item.get("id")
            if (
                not isinstance(identifier, str)
                or not re.fullmatch("[a-zA-Z0-9_-]{1,100}", identifier)
                or identifier in ids
            ):
                raise ValueError("Identificador de tinta inválido.")
            ids.add(identifier)
            color(item.get("color", "#202124"))
        for stroke in strokes:
            if stroke.get("tool") not in ["pen", "highlighter"]:
                raise ValueError("Ferramenta inválida.")
            number(stroke.get("size", 2), 0.1, 100)
            number(stroke.get("opacity", 1), 0, 1)
            values = stroke.get("points")
            outline = stroke.get("outline", [])
            if (
                not isinstance(values, list)
                or not 1 <= len(values) <= MAX_POINTS
                or not isinstance(outline, list)
                or len(outline) > MAX_POINTS * 4
            ):
                raise ValueError("Traço inválido.")
            points += len(values) + len(outline)
            if points > 1000000:
                raise ValueError("Limite total de pontos excedido.")
            for point in values:
                if not isinstance(point, dict):
                    raise ValueError("Ponto inválido.")
                number(point.get("x"), 0, 1)
                number(point.get("y"), 0, 1)
                number(point.get("pressure", 0.5), 0, 1)
                number(point.get("tilt_x", 0), -90, 90)
                number(point.get("tilt_y", 0), -90, 90)
                number(point.get("timestamp_ms", 0), 0, 1e15)
            for point in outline:
                if not isinstance(point, (list, tuple)) or len(point) != 2:
                    raise ValueError("Contorno inválido.")
                number(point[0], 0, 1)
                number(point[1], 0, 1)
        for text in texts:
            if not isinstance(text.get("text"), str) or len(text["text"]) > 100000:
                raise ValueError("Texto inválido.")
            for key in ["x", "y", "width", "height"]:
                number(text.get(key, 0), 0, 1)
            number(text.get("font_size_pt", 12), 1, 512)
            family = text.get("font_family", "Arial")
            if (
                not isinstance(family, str)
                or not 1 <= len(family) <= 200
                or any(c in family for c in "<>\x00")
            ):
                raise ValueError("Fonte inválida.")
            if text.get("confidence") is not None:
                number(text["confidence"], 0, 1)
    return layers

"""Semantic PDF text annotations: validation and native PDF serialization.

The source PDF is immutable. Coordinates are expressed in PDF default user space,
not screen pixels or zoom-dependent positions. Legacy fixed models may omit the
optional annotations collection.
"""

from __future__ import annotations

import re

from pypdf import Transformation
from pypdf.annotations import Highlight, Text
from pypdf.generic import RectangleObject
from pypdf.generic import ArrayObject, FloatObject, NameObject, TextStringObject

from shared.services.ink.validation import color, number

KINDS = {"highlight", "underline", "strikeout", "note"}
MAX_ANNOTATIONS = 10000
MAX_QUADS_PER_ANNOTATION = 2048
MAX_QUOTE = 20000
MAX_COMMENT = 20000


def validate_annotations(model: dict) -> list[dict]:
    annotations = model.get("annotations", [])
    if not isinstance(annotations, list) or len(annotations) > MAX_ANNOTATIONS:
        raise ValueError("Coleção de anotações PDF inválida.")
    if annotations and model["source_kind"] != "pdf":
        raise ValueError("Anotações semânticas são exclusivas de PDFs.")

    surfaces = model["surfaces"]
    seen = set()
    total_quads = 0
    for annotation in annotations:
        if not isinstance(annotation, dict):
            raise ValueError("Anotação PDF inválida.")
        identifier = annotation.get("id")
        if (
            not isinstance(identifier, str)
            or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", identifier)
            or identifier in seen
        ):
            raise ValueError("Identificador de anotação PDF inválido.")
        seen.add(identifier)
        if annotation.get("kind") not in KINDS:
            raise ValueError("Tipo de anotação PDF inválido.")
        page = annotation.get("page_index")
        if type(page) is not int or not 0 <= page < len(surfaces):
            raise ValueError("Página da anotação PDF inválida.")
        quote = annotation.get("selected_text")
        comment = annotation.get("comment", "")
        if not isinstance(quote, str) or not 1 <= len(quote) <= MAX_QUOTE:
            raise ValueError("Trecho de anotação PDF inválido.")
        if not isinstance(comment, str) or len(comment) > MAX_COMMENT:
            raise ValueError("Comentário PDF inválido.")
        color(annotation.get("color"))
        number(annotation.get("opacity", 0.35), 0, 1)
        quads = annotation.get("quad_points")
        if (
            not isinstance(quads, list)
            or not 1 <= len(quads) <= (1 if annotation["kind"] == "note" else MAX_QUADS_PER_ANNOTATION)
        ):
            raise ValueError("Geometria da anotação PDF inválida.")
        total_quads += len(quads)
        if total_quads > 100000:
            raise ValueError('Limite de fragmentos de anotações PDF excedido.')
        for quad in quads:
            if not isinstance(quad, list) or len(quad) != 8:
                raise ValueError("QuadPoints inválidos.")
            for value in quad:
                number(value, -20000, 20000)
            xs, ys = quad[0::2], quad[1::2]
            if max(xs) - min(xs) < 0.01 or max(ys) - min(ys) < 0.01:
                raise ValueError("Anotação PDF sem área.")
    return annotations


def rotation_transform(page):
    """Match pypdf PageObject.transfer_rotation_to_content geometry."""
    box = RectangleObject(page.mediabox)
    center_x = float(box.left + box.width / 2)
    center_y = float(box.bottom + box.height / 2)
    transform = Transformation().translate(-center_x, -center_y).rotate(-page.rotation)
    p1 = transform.apply_on(box.lower_left)
    p2 = transform.apply_on(box.upper_right)
    return transform.translate(-min(p1[0], p2[0]), -min(p1[1], p2[1]))


def add_native_annotations(writer, model: dict, transforms=None) -> None:
    """Write standard markup annotation objects without flattening the PDF text."""
    for annotation in validate_annotations(model):
        quads = annotation["quad_points"]
        coordinates = [point for quad in quads for point in quad]
        transform = (transforms or {}).get(annotation["page_index"])
        if transform is not None:
            coordinates = [
                value
                for quad in quads
                for i in (0, 2, 4, 6)
                for value in transform.apply_on((quad[i], quad[i + 1]))
            ]
        xs, ys = coordinates[0::2], coordinates[1::2]
        if annotation["kind"] == "note":
            native = Text(
                rect=(min(xs), min(ys), max(xs), max(ys)),
                text=annotation.get("comment") or "Nota adicionada no Open Doc",
                open=False,
            )
        else:
            native = Highlight(
                rect=(min(xs), min(ys), max(xs), max(ys)),
                quad_points=ArrayObject([FloatObject(x) for x in coordinates]),
                highlight_color=annotation["color"][1:],
                printing=True,
            )
            native[NameObject("/Subtype")] = NameObject(
                "/" + {"highlight": "Highlight", "underline": "Underline",
                       "strikeout": "StrikeOut"}[annotation["kind"]]
            )
        native[NameObject("/NM")] = TextStringObject(annotation["id"])
        native[NameObject("/Contents")] = TextStringObject(
            annotation.get("comment") or annotation["selected_text"]
        )
        if annotation["kind"] == "note":
            native[NameObject("/C")] = ArrayObject([
                FloatObject(int(annotation["color"][i:i + 2], 16) / 255)
                for i in (1, 3, 5)
            ])
        native[NameObject("/T")] = TextStringObject("Open Doc")
        native[NameObject("/CA")] = FloatObject(
            annotation.get("opacity", 0.35)
        )
        writer.add_annotation(annotation["page_index"], native)

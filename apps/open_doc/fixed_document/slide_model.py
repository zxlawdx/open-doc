"""Validated, versioned editable slide elements. Native OOXML is produced at export.

Slides use the same normalized page geometry as Open Doc ink, with object
state isolated from the imported/source PPTX bytes.
"""
from __future__ import annotations

import re
from collections.abc import Mapping

from ..ink.validation import number

HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
MAX_SLIDES = 200
MAX_ELEMENTS = 500


class SlideModelValidator:
    """Validate editable slides at the persistence boundary, not in the DOM."""

    @staticmethod
    def _color(value, label):
        if not isinstance(value, str) or not HEX_COLOR.fullmatch(value):
            raise ValueError(f"Cor inválida em {label}.")

    def validate(self, model: dict) -> None:
        if not model.get("editable_deck", False):
            return
        if model.get("source_kind") != "pptx":
            raise ValueError("Um documento PDF não pode ser um editor de slides.")
        surfaces = model["surfaces"]
        if len(surfaces) > MAX_SLIDES:
            raise ValueError("O editor suporta no máximo 200 slides.")
        size = (surfaces[0]["width_pt"], surfaces[0]["height_pt"])
        for slide in surfaces:
            if (slide["width_pt"], slide["height_pt"]) != size:
                raise ValueError("Slides devem compartilhar o mesmo tamanho de página.")
            elements = slide.get("elements", [])
            if not isinstance(elements, list) or len(elements) > MAX_ELEMENTS:
                raise ValueError("Quantidade de elementos de slide inválida.")
            self._color(slide.get("background", "#FFFFFF"), "fundo do slide")
            notes = slide.get("notes", "")
            if not isinstance(notes, str) or len(notes) > 5000:
                raise ValueError("Notas do apresentador inválidas.")
            ids = set()
            for element in elements:
                self.validate_element(element, ids)

    def validate_element(self, element: dict, ids: set[str]) -> None:
        if not isinstance(element, Mapping):
            raise ValueError("Elemento de slide inválido.")
        uid = element.get("id")
        if not isinstance(uid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", uid) or uid in ids:
            raise ValueError("Identificador de elemento inválido ou duplicado.")
        ids.add(uid)
        if element.get("type") not in {"text", "rect", "ellipse"}:
            raise ValueError("Tipo de elemento não suportado.")
        x = number(element.get("x"), 0, 1)
        y = number(element.get("y"), 0, 1)
        w = number(element.get("width"), .01, 1)
        h = number(element.get("height"), .01, 1)
        if x + w > 1.000001 or y + h > 1.000001:
            raise ValueError("O elemento ultrapassa os limites do slide.")
        self._color(element.get("color", "#191C1E"), "texto")
        self._color(element.get("fill", "#DAE2FD"), "preenchimento")
        self._color(element.get("stroke", "#004AC6"), "contorno")
        text = element.get("text", "")
        if not isinstance(text, str) or len(text) > 10000:
            raise ValueError("Texto de slide inválido.")
        family = element.get("font_family", "Inter")
        if not isinstance(family, str) or not 1 <= len(family) <= 80:
            raise ValueError("Fonte de slide inválida.")
        number(element.get("font_size_pt", 28), 6, 144)

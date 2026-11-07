"""Validated, versioned editable slide elements. Native OOXML is produced at export.

Slides use the same normalized page geometry as Open Doc ink, with object
state isolated from the imported/source PPTX bytes.
"""
from __future__ import annotations

import base64
import re
from binascii import Error as Base64Error
from collections.abc import Mapping
from io import BytesIO

from PIL import Image, UnidentifiedImageError

from ..ink.validation import number
from ..readers.pptx.native_math import validate_math_blocks

HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
MAX_SLIDES = 200
MAX_ELEMENTS = 500


class SlideModelValidator:
    """Validate editable slides at the persistence boundary, not in the DOM."""

    @staticmethod
    def _color(value, label):
        if not isinstance(value, str) or not HEX_COLOR.fullmatch(value):
            raise ValueError(f"Cor inválida em {label}.")

    @staticmethod
    def validate_assets(model):
        """Embedded deck assets are stored once, referenced by native image elements.

        No external path or URL may enter the persisted model.
        """
        assets = model.get("assets", {})
        if not isinstance(assets, dict) or len(assets) > 128:
            raise ValueError("Catálogo de imagens inválido.")
        formats = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
        for identifier, asset in assets.items():
            if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", identifier):
                raise ValueError("Identificador de imagem inválido.")
            if (not isinstance(asset, Mapping) or
                not isinstance(asset.get("mime"), str) or asset["mime"] not in formats):
                raise ValueError("Formato de imagem não suportado.")
            encoded = asset.get("data")
            if not isinstance(encoded, str) or len(encoded) > 5_600_000:
                raise ValueError("Imagem inválida ou muito grande.")
            try:
                payload = base64.b64decode(encoded, validate=True)
            except (Base64Error, ValueError) as exc:
                raise ValueError("Dados de imagem inválidos.") from exc
            if not payload or len(payload) > 4 * 1024 * 1024:
                raise ValueError("Imagem deve possuir no máximo 4 MB.")
            try:
                with Image.open(BytesIO(payload)) as picture:
                    width, height = picture.size
                    if (picture.format != formats[asset["mime"]] or
                        width <= 0 or height <= 0 or
                        width > 8000 or height > 8000 or width * height > 16_000_000):
                        raise ValueError("Formato ou dimensões da imagem inválidos.")
                    picture.verify()
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
                raise ValueError("Arquivo de imagem inválido.") from exc
        return assets

    def validate(self, model: dict) -> None:
        if not model.get("editable_deck", False):
            return
        if model.get("source_kind") != "pptx":
            raise ValueError("Um documento PDF não pode ser um editor de slides.")
        assets = self.validate_assets(model)
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
            effect=slide.get("transition", "none")
            if effect not in ("none","fade","push-left","push-right","wipe-left","wipe-right"):
                raise ValueError("Transição de slide inválida.")
            speed=slide.get("transition_speed", "med")
            if speed not in ("slow","med","fast"):
                raise ValueError("Velocidade da transição inválida.")
            notes = slide.get("notes", "")
            if not isinstance(notes, str) or len(notes) > 5000:
                raise ValueError("Notas do apresentador inválidas.")
            ids = set()
            for element in elements:
                self.validate_element(element, ids, assets)

    def validate_element(self, element: dict, ids: set[str], assets=None) -> None:
        if not isinstance(element, Mapping):
            raise ValueError("Elemento de slide inválido.")
        uid = element.get("id")
        if not isinstance(uid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", uid) or uid in ids:
            raise ValueError("Identificador de elemento inválido ou duplicado.")
        ids.add(uid)
        if not isinstance(element.get("type"), str) or element["type"] not in {"text", "rect", "ellipse", "round_rect", "line", "arrow", "triangle", "diamond", "image", "chart", "table", "chevron", "hexagon", "pentagon", "parallelogram", "star", "cloud", "math"}:
            raise ValueError("Tipo de elemento não suportado.")
        if element.get("text_runs") is not None:
            text_runs = element["text_runs"]
            if (element["type"] in {"image", "math", "table", "chart"} or not isinstance(text_runs, list)
                    or len(text_runs) > 100):
                raise ValueError("Runs de texto de slide inválidos.")
            num_runs = 0
            for paragraph in text_runs:
                if not isinstance(paragraph, list) or len(paragraph) > 200:
                    raise ValueError("Parágrafo PPTX inválido.")
                num_runs += len(paragraph)
                for run in paragraph:
                    if not isinstance(run, dict) or set(run) != {
                        "text", "font_family", "font_size_pt", "font_bold",
                        "font_italic", "color"
                    }:
                        raise ValueError("Estrutura de run PPTX inválida.")
                    if not isinstance(run["text"], str) or len(run["text"]) > 10000:
                        raise ValueError("Texto de run PPTX inválido.")
                    if not isinstance(run["font_family"], str) or len(run["font_family"]) > 80:
                        raise ValueError("Fonte do run PPTX inválida.")
                    number(run["font_size_pt"], 6, 144)
                    self._color(run["color"], "cor do run")
                    if type(run["font_bold"]) is not bool or type(run["font_italic"]) is not bool:
                        raise ValueError("Estilo do run PPTX inválido.")
            if num_runs > 2000 or sum(len(r["text"]) for p in text_runs for r in p)>10000:
                raise ValueError("Texto PPTX complexo demais.")
        if element.get("type") not in {"image", "math", "chart", "table"}:
            number(element.get("font_letter_spacing_pt", 0), -2, 20)
        if element.get("type") == "math":
            validate_math_blocks(element.get("math_blocks"))
        if element.get("type") == "table":
            cells = element.get("table_cells")
            if (not isinstance(cells, list) or not 1 <= len(cells) <= 30
                    or not isinstance(cells[0], list)
                    or not 1 <= len(cells[0]) <= 20):
                raise ValueError("Dimensões da tabela PPTX inválidas.")
            columns = len(cells[0])
            for row in cells:
                if not isinstance(row, list) or len(row) != columns:
                    raise ValueError("Tabela PPTX com células irregulares.")
                for cell in row:
                    if not isinstance(cell, str) or len(cell) > 2000:
                        raise ValueError("Conteúdo de célula PPTX inválido.")
            if element.get("rotation", 0) != 0:
                raise ValueError("Rotação de tabelas PPTX não suportada.")
        if element.get("type") == "chart":
            kind = element.get("chart_type", "bar")
            if kind not in {"bar", "hbar", "line", "area", "pie"}:
                raise ValueError("Tipo de gráfico não suportado para PPTX nativo.")
            if element.get("chart_palette", "blue") not in {
                "blue", "green", "orange", "contrast"
            }:
                raise ValueError("Paleta do gráfico inválida.")
            if element.get("rotation", 0) != 0:
                raise ValueError("Gráficos nativos não podem ser girados.")
            for key, limit in (("chart_title", 160), ("chart_subtitle", 160)):
                value = element.get(key, "")
                if not isinstance(value, str) or len(value) > limit:
                    raise ValueError("Título ou subtítulo do gráfico inválido.")
            categories = element.get("chart_categories")
            values = element.get("chart_values")
            if (not isinstance(categories, list) or
                    not isinstance(values, list) or
                    not 1 <= len(categories) <= 24 or
                    len(categories) != len(values)):
                raise ValueError("Categorias e valores do gráfico não correspondem.")
            for item in categories:
                if (not isinstance(item, str) or not item.strip() or
                        len(item) > 240):
                    raise ValueError("Rótulo de categoria inválido.")
            for value in values:
                number(value, -100000000, 100000000)
            series = element.get("chart_series")
            if series is not None:
                if (not isinstance(series, list) or not 1 <= len(series) <= 5 or
                        (kind == "pie" and len(series) > 1)):
                    raise ValueError("Quantidade de séries do gráfico inválida.")
                for entry in series:
                    if (not isinstance(entry, dict) or
                            not isinstance(entry.get("name"), str) or
                            not 1 <= len(entry["name"]) <= 80 or
                            not isinstance(entry.get("values"), list) or
                            len(entry["values"]) != len(categories)):
                        raise ValueError("Séries do gráfico incompatíveis.")
                    for value in entry["values"]:
                        number(value, -100000000, 100000000)
            else:
                series = [{"values": values}]
            if kind == "pie":
                pie_values = series[0]["values"]
                if any(value < 0 for value in pie_values) or not any(
                    value > 0 for value in pie_values
                ):
                    raise ValueError("Gráficos de pizza exigem valores positivos.")
            for key in ("chart_label_bold", "chart_label_italic",
                        "chart_label_wrap", "chart_label_visible",
                        "chart_layout_auto"):
                if type(element.get(key, True)) is not bool:
                    raise ValueError("Opção de gráfico deve ser booleana.")
            font = element.get("chart_label_font", "Arial")
            if not isinstance(font, str) or not 1 <= len(font) <= 80:
                raise ValueError("Família da fonte dos rótulos inválida.")
            number(element.get("chart_label_font_size", 12), 7, 24)
            number(element.get("chart_label_letter_spacing", 0), -2, 8)
            if element.get("chart_label_rotation", 0) not in (0, 30, 45, 60, 90):
                raise ValueError("Rotação dos rótulos inválida.")
            if element.get("chart_label_align", "center") not in {
                "left", "center", "right"
            }:
                raise ValueError("Alinhamento dos rótulos inválido.")
            for field in ("chart_label_color", "chart_background_color"):
                self._color(element.get(field, "#FFFFFF"), field)
            for key, options in {
                "chart_background": {"solid", "transparent"},
                "chart_color_mode": {"palette", "custom"},
                "chart_data_labels": {"none", "value", "percent", "both"},
                "chart_percent_mode": {"share", "provided"},
                "chart_margin_mode": {"auto", "custom"},
                "chart_legend_position": {"auto", "right", "bottom"},
            }.items():
                if element.get(key, next(iter(options))) not in options:
                    raise ValueError("Opção de formatação do gráfico inválida: " + key)
            number(element.get("chart_margin", 0), 0, 80)
            colors = element.get("chart_item_colors", [])
            if not isinstance(colors, list) or len(colors) > len(categories):
                raise ValueError("Cores individuais do gráfico inválidas.")
            for color in colors:
                self._color(color, "cor de categoria do gráfico")
        if element.get("type") == "image":
            if not isinstance(element.get("asset_id"), str) or element["asset_id"] not in (assets or {}):
                raise ValueError("Imagem não encontrada no catálogo de recursos.")
            if not isinstance(element.get("flip_h", False), bool) or not isinstance(element.get("flip_v", False), bool):
                raise ValueError("Espelhamento de imagem inválido.")
            if element.get("image_tint") is not None:
                self._color(element["image_tint"], "tom da imagem")
            number(element.get("image_opacity", 100), 0, 100)
            number(element.get("image_brightness", 0), -100, 100)
            number(element.get("image_contrast", 0), -100, 100)
            if not isinstance(element.get("image_grayscale", False), bool):
                raise ValueError("Escala de cinza inválida.")
            crop = {key: number(element.get(key, 0), 0, .95)
                    for key in ("crop_left", "crop_right", "crop_top", "crop_bottom")}
            if (crop["crop_left"] + crop["crop_right"] > .9500001 or
                crop["crop_top"] + crop["crop_bottom"] > .9500001):
                raise ValueError("O recorte não pode eliminar toda a imagem.")
        x = number(element.get("x"), 0, 1)
        y = number(element.get("y"), 0, 1)
        # Imported design templates can have hairline rules and fine stripes.
        # Do not reject the entire deck solely because a native shape is thin.
        w = number(element.get("width"), .00001, 1)
        h = number(element.get("height"), .00001, 1)
        if x + w > 1.000001 or y + h > 1.000001:
            raise ValueError("O elemento ultrapassa os limites do slide.")
        self._color(element.get("color", "#191C1E"), "texto")
        self._color(element.get("fill", "#DAE2FD"), "preenchimento")
        self._color(element.get("stroke", "#004AC6"), "contorno")
        label = element.get("name")
        if label is not None and (not isinstance(label, str) or not 1 <= len(label) <= 80):
            raise ValueError("Nome de forma inválido.")
        text = element.get("text", "")
        if not isinstance(text, str) or len(text) > 10000:
            raise ValueError("Texto de slide inválido.")
        family = element.get("font_family", "Inter")
        if not isinstance(family, str) or not 1 <= len(family) <= 80:
            raise ValueError("Fonte de slide inválida.")
        for key in ("font_bold", "font_italic"):
            if not isinstance(element.get(key, False), bool):
                raise ValueError("Estilo de fonte de slide inválido.")
        number(element.get("font_size_pt", 28), 6, 144)
        number(element.get("stroke_width", 1.5), .5, 20)
        number(element.get("rotation", 0), -360, 360)

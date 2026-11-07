"""Strict native-OOXML importer for the *editable* Open Doc slide subset.

The original imported PPTX remains intact on disk.  A deck that includes
unknown constructs stays in the read-only preview instead of silently losing
shapes/animations when exported from the editable model.
"""
from __future__ import annotations

import base64
from uuid import uuid4

from pptx import Presentation
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE, MSO_SHAPE_TYPE
from pptx.dml.color import RGBColor

from ...fixed_document.slide_model import SlideModelValidator
from .image_effects import import_image_effects

MARKER = "OpenDoc:EditableSlide-v1"

_SHAPES = {
    MSO_SHAPE.RECTANGLE: "rect",
    MSO_SHAPE.OVAL: "ellipse",
    MSO_SHAPE.ROUNDED_RECTANGLE: "round_rect",
    MSO_SHAPE.RIGHT_ARROW: "arrow",
    MSO_SHAPE.ISOSCELES_TRIANGLE: "triangle",
    MSO_SHAPE.DIAMOND: "diamond",
}
_CHARTS = {
    XL_CHART_TYPE.COLUMN_CLUSTERED: "bar",
    XL_CHART_TYPE.LINE_MARKERS: "line",
    XL_CHART_TYPE.PIE: "pie",
}
_NS = "{http://schemas.openxmlformats.org/presentationml/2006/main}"


def _rgb(color, default: str) -> str:
    try:
        value = color.rgb
        if value is not None:
            return "#" + str(value).upper()
    except (AttributeError, TypeError, ValueError):
        pass
    return default


def _coordinates(shape, width: int, height: int) -> dict:
    x = max(0.0, min(1.0, shape.left / width))
    y = max(0.0, min(1.0, shape.top / height))
    w = max(.00001, min(1.0 - x, shape.width / width))
    h = max(.00001, min(1.0 - y, shape.height / height))
    if w < .01 or h < .01:
        raise ValueError("Objeto fora do tamanho editável.")
    return dict(x=round(x, 7), y=round(y, 7),
                width=round(min(w, 1-x), 7), height=round(min(h, 1-y), 7))


def _transition(slide) -> tuple[str, str]:
    element = slide._element.find(_NS + "transition")
    if element is None:
        return "none", "med"
    speed = element.get("spd", "med")
    if speed not in {"slow", "med", "fast"}:
        raise ValueError("Velocidade de transição não editável.")
    children = list(element)
    if len(children) != 1:
        raise ValueError("Transição não suportada.")
    node = children[0]
    kind = node.tag.rsplit("}", 1)[-1]
    if kind == "fade":
        return "fade", speed
    if kind in {"push", "wipe"} and node.get("dir") in {"l", "r"}:
        return kind + ("-left" if node.get("dir") == "l" else "-right"), speed
    raise ValueError("Efeito de transição não suportado.")


def _shape_element(shape, width: int, height: int, assets: dict) -> dict:
    name = str(shape.name or "Objeto")[:80]
    name = name or "Objeto"
    base = dict(id=str(uuid4()), name=name, **_coordinates(shape, width, height),
                color="#191C1E", fill="#DAE2FD", stroke="#004AC6",
                font_family="Inter", font_size_pt=28, stroke_width=1.5,
                rotation=round(float(shape.rotation or 0), 4), text="")
    if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
        mime = shape.image.content_type
        if mime not in {"image/png", "image/jpeg"}:
            raise ValueError("Formato de imagem não suportado na edição.")
        payload = shape.image.blob
        if len(payload) > 4 * 1024 * 1024:
            raise ValueError("Imagem muito grande para edição.")
        asset_id = str(uuid4())
        assets[asset_id] = {"mime": mime, "data": base64.b64encode(payload).decode("ascii")}
        base.update(import_image_effects(shape._pic.blipFill.blip))
        base.update(type="image", asset_id=asset_id,
                    crop_left=shape.crop_left, crop_right=shape.crop_right,
                    crop_top=shape.crop_top, crop_bottom=shape.crop_bottom,
                    flip_h=bool(shape._pic.spPr.xfrm.flipH) if shape._pic.spPr.xfrm is not None else False,
                    flip_v=bool(shape._pic.spPr.xfrm.flipV) if shape._pic.spPr.xfrm is not None else False)
    elif shape.shape_type == MSO_SHAPE_TYPE.CHART:
        chart = shape.chart
        kind = _CHARTS.get(chart.chart_type)
        if kind is None or len(chart.series) != 1:
            raise ValueError("Gráfico fora do subconjunto nativo.")
        series = chart.series[0]
        categories = [str(category.label) for category in chart.plots[0].categories]
        values = [float(value) for value in series.values]
        if len(categories) != len(values):
            raise ValueError("Gráfico com categorias inconsistentes.")
        title = chart.chart_title.text_frame.text if chart.has_title else ""
        base.update(type="chart", rotation=0, chart_type=kind,
                    chart_categories=categories, chart_values=values,
                    chart_title=title[:160], chart_palette="blue")
    else:
        if shape.shape_type == MSO_SHAPE_TYPE.TEXT_BOX:
            kind = "text"
        elif shape.shape_type == MSO_SHAPE_TYPE.LINE:
            kind = "line"
        elif shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
            kind = _SHAPES.get(shape.auto_shape_type)
        else:
            kind = None
        if kind is None:
            raise ValueError("Objeto PPTX fora do subconjunto editável.")
        base["type"] = kind
        if kind not in {"text", "line"}:
            base["fill"] = _rgb(shape.fill.fore_color, base["fill"])
        if kind != "text":
            base["stroke"] = _rgb(shape.line.color, base["stroke"])
        if shape.line.width:
            base["stroke_width"] = min(20.0, max(.5, float(shape.line.width / 12700)))
        if shape.has_text_frame:
            base["text"] = shape.text_frame.text[:10000]
            paragraphs = shape.text_frame.paragraphs
            runs = paragraphs[0].runs if paragraphs else []
            if runs:
                font = runs[0].font
                base["font_family"] = str(font.name or "Inter")[:80]
                if font.size:
                    base["font_size_pt"] = max(6.0, min(144.0, float(font.size.pt)))
                base["color"] = _rgb(font.color, base["color"])
                if font.bold is not None:
                    base["font_bold"] = font.bold
                if font.italic is not None:
                    base["font_italic"] = font.italic
    return base


def read_editable_deck(path) -> dict | None:
    """Return a validated editable model only for identified Open Doc exports.

    No lossy conversion for arbitrary user decks: if an imported slide contains
    animation timing, groups, unsupported graphics, or shapes, preserve it as
    an immutable original instead. Legacy non-marked decks remain in viewer
    mode and can later use an explicit, reviewed conversion operation.
    """
    deck = Presentation(path)
    if MARKER not in (deck.core_properties.keywords or ""):
        return None
    if not 1 <= len(deck.slides) <= 200:
        return None
    width, height = deck.slide_width, deck.slide_height
    if width <= 0 or height <= 0:
        return None
    surfaces = []
    assets = {}
    try:
        for index, slide in enumerate(deck.slides):
            # The editable model does not yet preserve object animation trees.
            if slide._element.find(_NS + "timing") is not None:
                return None
            effect, speed = _transition(slide)
            color = _rgb(slide.background.fill.fore_color, "#FFFFFF")
            notes = ""
            if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
                notes = slide.notes_slide.notes_text_frame.text[:5000]
            surface = dict(index=index, preview_kind="pptx-native",
                           width_pt=width / 12700, height_pt=height / 12700,
                           strokes=[], text_overlays=[], background=color,
                           notes=notes, transition=effect, transition_speed=speed,
                           elements=[])
            if len(slide.shapes) > 500:
                return None
            for shape in slide.shapes:
                surface["elements"].append(_shape_element(shape, width, height, assets))
            surfaces.append(surface)
        model = dict(editable_deck=True, assets=assets, surfaces=surfaces)
        SlideModelValidator().validate(dict(source_kind="pptx", **model))
    except (AttributeError, KeyError, TypeError, ValueError, IndexError, OverflowError):
        return None
    return model

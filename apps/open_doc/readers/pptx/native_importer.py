"""Strict native-OOXML importer for the *editable* Open Doc slide subset.

The original imported PPTX remains intact on disk.  A deck that includes
unknown constructs stays in the read-only preview instead of silently losing
shapes/animations when exported from the editable model.
"""
from __future__ import annotations

import base64
from copy import deepcopy
from uuid import uuid4

from pptx import Presentation
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE, MSO_SHAPE_TYPE
from pptx.dml.color import RGBColor

from ...fixed_document.slide_model import SlideModelValidator
from .image_effects import import_image_effects
from .native_math import read_math

MARKER = "OpenDoc:EditableSlide-v1"

_SHAPES = {
    MSO_SHAPE.RECTANGLE: "rect",
    MSO_SHAPE.OVAL: "ellipse",
    MSO_SHAPE.ROUNDED_RECTANGLE: "round_rect",
    MSO_SHAPE.RIGHT_ARROW: "arrow",
    MSO_SHAPE.ISOSCELES_TRIANGLE: "triangle",
    MSO_SHAPE.DIAMOND: "diamond",
    MSO_SHAPE.CHEVRON: "chevron",
    MSO_SHAPE.HEXAGON: "hexagon",
    MSO_SHAPE.PENTAGON: "pentagon",
    MSO_SHAPE.PARALLELOGRAM: "parallelogram",
    MSO_SHAPE.STAR_5_POINT: "star",
    MSO_SHAPE.CLOUD: "cloud",
}
_CHARTS = {
    XL_CHART_TYPE.COLUMN_CLUSTERED: "bar",
    XL_CHART_TYPE.BAR_CLUSTERED: "hbar",
    XL_CHART_TYPE.AREA: "area",
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


def _fill_color(fill, default: str) -> str:
    """Read explicit fill colors without raising on inherited or empty fills."""
    try:
        return _rgb(fill.fore_color, default)
    except (AttributeError, TypeError, ValueError):
        return default


def _coordinates(shape, width: int, height: int) -> dict:
    x = max(0.0, min(1.0, shape.left / width))
    y = max(0.0, min(1.0, shape.top / height))
    w = max(.00001, min(1.0 - x, shape.width / width))
    h = max(.00001, min(1.0 - y, shape.height / height))
    if w < .00001 or h < .00001:
        raise ValueError("Objeto sem dimensões geométricas válidas.")
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
    elif shape.has_table:
        table = shape.table
        if not 1 <= len(table.rows) <= 30 or not 1 <= len(table.columns) <= 20:
            raise ValueError("Tabela grande demais para edição nativa.")
        cells = [[table.cell(row, col).text[:2000]
                  for col in range(len(table.columns))]
                 for row in range(len(table.rows))]
        base.update(type="table", rotation=0, table_cells=cells)
    elif shape.shape_type == MSO_SHAPE_TYPE.CHART:
        chart = shape.chart
        kind = _CHARTS.get(chart.chart_type)
        if kind is None or not 1 <= len(chart.series) <= 5:
            raise ValueError("Gráfico fora do subconjunto nativo.")
        categories = [str(category.label) for category in chart.plots[0].categories]
        all_series = [{
            "name": str(series.name or f"Série {index+1}")[:80],
            "values": [float(value) for value in series.values],
        } for index, series in enumerate(chart.series)]
        if any(len(series["values"]) != len(categories) for series in all_series):
            raise ValueError("Gráfico com categorias inconsistentes.")
        full_title = chart.chart_title.text_frame.text if chart.has_title else ""
        parts = full_title.split("\n", 1)
        background = (
            "transparent"
            if chart._chartSpace.xpath("./c:spPr/a:noFill")
            else "solid"
        )
        # Original categories are never inferred from a column of years.
        base.update(type="chart", rotation=0, chart_type=kind,
                    chart_categories=categories,
                    chart_values=all_series[0]["values"],
                    chart_title=parts[0][:160], chart_palette="blue",
                    chart_background=background,
                    chart_data_labels="none")
        if len(parts) > 1:
            base["chart_subtitle"] = parts[1][:160]
        if len(all_series) > 1:
            base["chart_series"] = all_series
        if kind != "pie":
            tick = chart.category_axis.tick_labels
            if tick.font.name:
                base["chart_label_font"] = tick.font.name[:80]
            if tick.font.size:
                base["chart_label_font_size"] = max(7, min(24, float(tick.font.size.pt)))
            if tick.font.bold is not None:
                base["chart_label_bold"] = tick.font.bold
            if tick.font.italic is not None:
                base["chart_label_italic"] = tick.font.italic
            if tick.font._rPr is not None:
                spacing = tick.font._rPr.get("spc")
                if spacing is not None:
                    base["chart_label_letter_spacing"] = max(
                        -2, min(8, int(spacing)/100))
            body = chart.category_axis._element.xpath("./c:txPr/a:bodyPr")
            if body and body[0].get("rot"):
                rotation = abs(round(int(body[0].get("rot"))/60000))
                if rotation in (0,30,45,60,90):
                    base["chart_label_rotation"] = rotation
        point_colors=[]
        for point in chart.series[0].points:
            try:
                actual=point.format.fill.fore_color.rgb
                point_colors.append("#"+str(actual).upper() if actual else "")
            except (AttributeError, TypeError, ValueError):
                point_colors.append("")
        if len(point_colors)==len(categories) and all(point_colors):
            base["chart_color_mode"]="custom"
            base["chart_item_colors"]=point_colors
        labels=chart.series[0]._element.xpath("./c:dLbls/c:dLbl")
        if labels:
            base["chart_data_labels"]="percent"
        elif chart.plots[0].has_data_labels:
            data=chart.plots[0].data_labels
            if data.show_percentage:
                base["chart_data_labels"]="percent"
            elif data.show_value:
                base["chart_data_labels"]="value"
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
            base["fill"] = _fill_color(shape.fill, base["fill"])
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
                # PowerPoint text formatting commonly lives on a:defRPr
                # (paragraph default run properties), not the individual
                # a:rPr. Treat an unset run property as inherited rather
                # than substituting small black text in the editor.
                paragraph_font = paragraphs[0].font
                base["font_family"] = str(
                    font.name or paragraph_font.name or "Inter"
                )[:80]
                effective_size = font.size or paragraph_font.size
                if effective_size is not None:
                    base["font_size_pt"] = max(
                        6.0, min(144.0, float(effective_size.pt))
                    )
                base["color"] = _rgb(
                    font.color, _rgb(paragraph_font.color, base["color"])
                )
                bold = font.bold if font.bold is not None else paragraph_font.bold
                italic = font.italic if font.italic is not None else paragraph_font.italic
                if bold is not None:
                    base["font_bold"] = bold
                if italic is not None:
                    base["font_italic"] = italic
                raw_tracking = runs[0]._r.get_or_add_rPr().get("spc")
                if raw_tracking is not None:
                    base["font_letter_spacing_pt"] = max(-2, min(20,
                        int(raw_tracking) / 100))
        if shape.has_text_frame and any(p.runs for p in shape.text_frame.paragraphs):
            # Capture each original text run separately. The editor may change
            # its text while untouched run formatting/OOXML remains original.
            formatted = []
            for paragraph in shape.text_frame.paragraphs:
                entries = []
                for run in paragraph.runs:
                    font = run.font
                    inherited = paragraph.font
                    size = font.size or inherited.size
                    entries.append({
                        "text": run.text,
                        "font_family": str(font.name or inherited.name or
                                           base["font_family"])[:80],
                        "font_size_pt": max(6.0, min(144.0, float(size.pt))) if
                                        size is not None else base["font_size_pt"],
                        "font_bold": bool(font.bold if font.bold is not None
                                          else inherited.bold),
                        "font_italic": bool(font.italic if font.italic is not None
                                            else inherited.italic),
                        "color": _rgb(font.color, _rgb(inherited.color,
                                                       base["color"])),
                    })
                formatted.append(entries)
            base["text_runs"] = formatted
    if base.get("type") == "text":
        blocks = read_math(shape)
        if blocks is not None:
            base.update(type="math", math_blocks=blocks, text="")
    return base


def read_editable_deck(path) -> dict | None:
    """Convert supported decks, including externally created PPTX presentations.

    Never silently remove unknown shapes, groups, or animations. A presentation
    requiring unsupported features remains a read-only preview; the source
    is retained unchanged for future conversion support.
    """
    deck = Presentation(path)
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
            color = _fill_color(slide.background.fill, "#FFFFFF")
            notes = ""
            if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
                notes = slide.notes_slide.notes_text_frame.text[:5000]
            surface = dict(index=index, source_slide_index=index, preview_kind="pptx-native",
                           width_pt=width / 12700, height_pt=height / 12700,
                           strokes=[], text_overlays=[], background=color,
                           source_background=color, notes=notes, transition=effect, transition_speed=speed,
                           elements=[])
            if len(slide.shapes) > 500:
                return None
            for source_index, shape in enumerate(slide.shapes):
                element = _shape_element(shape, width, height, assets)
                element["source_shape_index"] = source_index
                element["source_original"] = deepcopy(element)
                surface["elements"].append(element)
            surfaces.append(surface)
        model = dict(editable_deck=True, preserve_source=True, assets=assets, surfaces=surfaces)
        SlideModelValidator().validate(dict(source_kind="pptx", **model))
    except (AttributeError, KeyError, TypeError, ValueError, IndexError, OverflowError):
        return None
    return model

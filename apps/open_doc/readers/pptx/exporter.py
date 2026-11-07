"""PPTX export for imported documents and fully editable Open Doc slide decks.

Use python-pptx, already installed by Open Doc. Never rasterize native slide
text or figures; keep source shapes intact for imported presentations.
"""
from __future__ import annotations

import base64
from io import BytesIO

from PIL import Image

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_TICK_LABEL_POSITION
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import MSO_AUTO_SIZE
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Pt

from ...ink.raster import render_layer
from .image_effects import export_image_effects
from .native_math import write_math, read_math


def rgb(value: str) -> RGBColor:
    return RGBColor.from_string(value.lstrip("#").upper())


class SlideDeckExporter:
    """Project validated normalized geometry into editable OOXML shapes."""

    def __init__(self, source, model):
        self.model = model
        self.native = model.get("editable_deck") is True
        # Reimport exactly the native subset without losing editability.
        # Non-OpenDoc originals remain read-only until explicitly converted.
        self.preserve_source = bool(self.native and model.get('preserve_source'))
        self.presentation = Presentation(source) if self.preserve_source or not self.native else Presentation()
        if self.native and not self.preserve_source:
            self.presentation.core_properties.keywords = "OpenDoc:EditableSlide-v1"
            first = model["surfaces"][0]
            self.presentation.slide_width = Pt(first["width_pt"])
            self.presentation.slide_height = Pt(first["height_pt"])

    @staticmethod
    def _chart_style(chart, obj, palette):
        """Format chart parts without flattening categories or percentage values.

        Native workbook cells keep numeric originals. For non-pie percentage
        labels, c:dLbl stores display-only text; the underlying value stays
        numeric and unchanged.
        """
        from pptx.oxml.ns import qn

        def fill(parent, transparent, color):
            current = parent.find(qn("c:spPr"))
            if current is not None:
                parent.remove(current)
            prop = OxmlElement("c:spPr")
            if transparent:
                prop.append(OxmlElement("a:noFill"))
            else:
                solid = OxmlElement("a:solidFill")
                srgb = OxmlElement("a:srgbClr")
                srgb.set("val", color.lstrip("#").upper())
                solid.append(srgb)
                prop.append(solid)
            parent.insert_element_before(prop, "c:txPr", "c:externalData",
                                         "c:printSettings", "c:extLst")

        transparent = obj.get("chart_background", "solid") == "transparent"
        bg_color = obj.get("chart_background_color", "#FFFFFF")
        fill(chart._chartSpace, transparent, bg_color)
        fill(chart._chartSpace.chart.plotArea, transparent, bg_color)
        kind = obj.get("chart_type", "bar")
        show = obj.get("chart_data_labels", "percent")
        colors = obj.get("chart_item_colors") or []
        customize = obj.get("chart_color_mode", "palette") == "custom"
        for series_index, series in enumerate(chart.series):
            source_values = (
                obj["chart_series"][series_index]["values"]
                if obj.get("chart_series") else obj["chart_values"]
            )
            for i, point in enumerate(series.points):
                if kind == "line":
                    break
                color = (colors[i] if customize and i < len(colors)
                         else palette[(i if len(chart.series) == 1 else series_index) % len(palette)])
                point.format.fill.solid()
                point.format.fill.fore_color.rgb = rgb(color)
            if kind == "line":
                series.format.line.color.rgb = rgb(palette[series_index % len(palette)])
                series.format.line.width = Pt(2.5)
            # Explicit data label strings remain independent of workbook data.
            # PowerPoint's built-in showPercent is used for pies.
            if show in {"percent", "both"} and kind != "pie":
                old_labels = series._element.find(
                    "{http://schemas.openxmlformats.org/drawingml/2006/chart}dLbls"
                )
                if old_labels is not None:
                    series._element.remove(old_labels)
                labels = OxmlElement("c:dLbls")
                positive_total = sum(v for v in source_values if v > 0)
                for i, value in enumerate(source_values):
                    if obj.get("chart_percent_mode") == "provided":
                        percentage = f"{value:.2f}".rstrip("0").rstrip(".") + "%"
                    else:
                        percentage = (f"{value / positive_total * 100:.2f}".rstrip("0").rstrip(".") + "%"
                                      if value >= 0 and positive_total > 0 else "—")
                    value_text = f"{value:g}" + obj.get("chart_unit", "")
                    display = (value_text + " (" + percentage + ")"
                               if show == "both" else percentage)
                    label = OxmlElement("c:dLbl")
                    index = OxmlElement("c:idx")
                    index.set("val", str(i))
                    label.append(index)
                    tx = OxmlElement("c:tx")
                    rich = OxmlElement("c:rich")
                    rich.append(OxmlElement("a:bodyPr"))
                    rich.append(OxmlElement("a:lstStyle"))
                    paragraph = OxmlElement("a:p")
                    run = OxmlElement("a:r")
                    rpr = OxmlElement("a:rPr")
                    rpr.set("sz", str(round(
                        float(obj.get("chart_label_font_size", 12)) * 100)))
                    if obj.get("chart_label_letter_spacing"):
                        rpr.set("spc", str(round(
                            float(obj["chart_label_letter_spacing"]) * 100)))
                    run.append(rpr)
                    text = OxmlElement("a:t")
                    text.text = display
                    run.append(text)
                    paragraph.append(run)
                    rich.append(paragraph)
                    tx.append(rich)
                    label.append(tx)
                    labels.append(label)
                show_val = OxmlElement("c:showVal")
                show_val.set("val", "0")
                labels.append(show_val)
                series._element.insert_element_before(
                    labels, "c:trendline", "c:errBars", "c:cat", "c:val", "c:xVal"
                )
        plot = chart.plots[0]
        if show == "value":
            plot.has_data_labels = True
            plot.data_labels.show_value = True
        elif kind == "pie" and show in {"percent", "both"}:
            plot.has_data_labels = True
            plot.data_labels.show_percentage = True
            plot.data_labels.show_value = show == "both"
        try:
            if kind != "pie":
                axis = chart.category_axis
                axis.tick_label_position = (
                    XL_TICK_LABEL_POSITION.NEXT_TO_AXIS
                    if obj.get("chart_label_visible", True)
                    else XL_TICK_LABEL_POSITION.NONE
                )
                face = axis.tick_labels.font
                face.name = obj.get("chart_label_font", "Arial")
                face.size = Pt(obj.get("chart_label_font_size", 12))
                face.bold = bool(obj.get("chart_label_bold", False))
                face.italic = bool(obj.get("chart_label_italic", False))
                face.color.rgb = rgb(obj.get("chart_label_color", "#43546B"))
                if obj.get("chart_label_letter_spacing"):
                    face._rPr.set("spc", str(round(
                        obj["chart_label_letter_spacing"] * 100)))
                rotation = obj.get("chart_label_rotation", 0)
                if rotation:
                    axis._element.txPr.bodyPr.set("rot", str(rotation * 60000))
        except ValueError:
            # Pie charts do not have a categorical axis.
            pass
        if chart.has_legend:
            position = obj.get("chart_legend_position", "auto")
            chart.legend.position = (
                XL_LEGEND_POSITION.BOTTOM if position == "bottom"
                else XL_LEGEND_POSITION.RIGHT
            )

    def _native_shape(self, slide, obj):
        width, height = self.presentation.slide_width, self.presentation.slide_height
        left = int(obj["x"] * width)
        top = int(obj["y"] * height)
        w = max(1, int(obj["width"] * width))
        h = max(1, int(obj["height"] * height))
        kind = obj["type"]
        if kind == "table":
            cells = obj["table_cells"]
            shape = slide.shapes.add_table(
                len(cells), len(cells[0]), left, top, w, h
            )
            for row_index, row in enumerate(cells):
                for col_index, value in enumerate(row):
                    shape.table.cell(row_index, col_index).text = value
        elif kind == "chart":
            native_data=CategoryChartData()
            native_data.categories=obj["chart_categories"]
            payload=obj.get("chart_series") or [{
                "name":"Valores", "values":obj["chart_values"]
            }]
            for series in payload:
                native_data.add_series(series["name"], series["values"])
            chart_type={
                "bar":XL_CHART_TYPE.COLUMN_CLUSTERED,
                "hbar":XL_CHART_TYPE.BAR_CLUSTERED,
                "line":XL_CHART_TYPE.LINE_MARKERS,
                "area":XL_CHART_TYPE.AREA,
                "pie":XL_CHART_TYPE.PIE,
            }[obj.get("chart_type","bar")]
            shape=slide.shapes.add_chart(chart_type,left,top,w,h,native_data)
            chart=shape.chart
            title=obj.get("chart_title","")
            subtitle=obj.get("chart_subtitle","")
            chart.has_title=bool(title or subtitle)
            if chart.has_title:
                chart.chart_title.text_frame.text=title+(
                    "\n"+subtitle if subtitle else ""
                )
            chart.has_legend=(obj.get("chart_type")=="pie" or len(payload)>1)
            palette={
                "blue":["#004AC6","#6A9EFF","#90C2FF","#274F98","#AFCBFF"],
                "green":["#2B886A","#72C3A0","#A2DEC5","#14634B","#D0F0DD"],
                "orange":["#F07938","#FFC16D","#BE4F2E","#EACB90","#F9DFCA"],
                "contrast":["#004AC6","#B64264","#267D4D","#D18919","#784FC5"],
            }[obj.get("chart_palette","blue")]
            self._chart_style(chart,obj,palette)
        elif kind == "image":
            asset = self.model["assets"][obj["asset_id"]]
            picture_data = BytesIO(base64.b64decode(asset["data"], validate=True))
            if asset["mime"] == "image/webp":
                with Image.open(picture_data) as webp:
                    raster = BytesIO()
                    webp.save(raster, format="PNG")
                    raster.seek(0)
                    picture_data = raster
            shape = slide.shapes.add_picture(picture_data, left, top, w, h)
            # Native OOXML a:srcRect is non-destructive: the full image is
            # preserved in the presentation and crop can be readjusted later.
            export_image_effects(shape._pic.blipFill.blip, obj)
            shape.crop_left = obj.get("crop_left", 0)
            shape.crop_right = obj.get("crop_right", 0)
            shape.crop_top = obj.get("crop_top", 0)
            shape.crop_bottom = obj.get("crop_bottom", 0)
            # python-pptx exposes picture transforms via its OOXML shape properties.
            xfrm = shape._pic.spPr.get_or_add_xfrm()
            xfrm.flipH = obj.get("flip_h", False)
            xfrm.flipV = obj.get("flip_v", False)
        elif kind == "math":
            shape = slide.shapes.add_textbox(left, top, w, h)
            write_math(shape, obj["math_blocks"])
            shape.fill.background()
        elif kind == "text":
            shape = slide.shapes.add_textbox(left, top, w, h)
            shape.fill.background()
        elif kind == "line":
            shape = slide.shapes.add_connector(
                MSO_CONNECTOR.STRAIGHT, left, top + h, left + w, top
            )
            shape.line.color.rgb = rgb(obj.get("stroke", "#004AC6"))
            shape.line.width = Pt(2)
        else:
            types = {
                "rect": MSO_SHAPE.RECTANGLE,
                "round_rect": MSO_SHAPE.ROUNDED_RECTANGLE,
                "ellipse": MSO_SHAPE.OVAL,
                "arrow": MSO_SHAPE.RIGHT_ARROW,
                "triangle": MSO_SHAPE.ISOSCELES_TRIANGLE,
                "diamond": MSO_SHAPE.DIAMOND,
                "chevron": MSO_SHAPE.CHEVRON,
                "hexagon": MSO_SHAPE.HEXAGON,
                "pentagon": MSO_SHAPE.PENTAGON,
                "parallelogram": MSO_SHAPE.PARALLELOGRAM,
                "star": MSO_SHAPE.STAR_5_POINT,
                "cloud": MSO_SHAPE.CLOUD,
            }
            shape = slide.shapes.add_shape(types[kind], left, top, w, h)
            shape.fill.solid()
            shape.fill.fore_color.rgb = rgb(obj.get("fill", "#DAE2FD"))
            shape.line.color.rgb = rgb(obj.get("stroke", "#004AC6"))
        if kind not in {"text", "image", "chart", "table", "math"}:
            shape.line.width = Pt(obj.get("stroke_width", 1.5))
        if kind not in {"chart", "table"}:
            shape.rotation = obj.get("rotation", 0)
        if obj.get("name"):
            shape.name = obj["name"]
        if kind == "text" or (kind not in {"table", "math"} and obj.get("text")):
            frame = shape.text_frame
            frame.clear()
            frame.word_wrap = True
            if kind == "text":
                frame.auto_size = MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT
            for index, line in enumerate(obj.get("text", "").split("\n")):
                paragraph = frame.add_paragraph() if index else frame.paragraphs[0]
                run = paragraph.add_run()
                run.text = line
                run.font.name = obj.get("font_family", "Inter")
                run.font.size = Pt(obj.get("font_size_pt", 28))
                run.font.bold = obj.get("font_bold")
                run.font.italic = obj.get("font_italic")
                run.font.color.rgb = rgb(obj.get("color", "#191C1E"))
                if obj.get("font_letter_spacing_pt") is not None:
                    run._r.get_or_add_rPr().set("spc",
                        str(round(float(obj["font_letter_spacing_pt"]) * 100)))
        return shape

    @staticmethod
    def _apply_transition(slide, surface):
        """Write native ECMA-376 p:transition. Never rasterize an effect.

        These simple transitions are understood by legacy PowerPoint and
        LibreOffice without 2010+ extension namespaces. Speed is a native
        slow/med/fast property; the editor does not claim exact durations.
        """
        effect=surface.get("transition", "none")
        if effect=="none":
            return
        transition=OxmlElement("p:transition")
        transition.set("spd",surface.get("transition_speed","med"))
        if effect=="fade":
            child=OxmlElement("p:fade")
        elif effect.startswith("push-"):
            child=OxmlElement("p:push")
            child.set("dir","l" if effect.endswith("left") else "r")
        else:
            child=OxmlElement("p:wipe")
            child.set("dir","l" if effect.endswith("left") else "r")
        transition.append(child)
        # Valid CT_Slide order: cSld, clrMapOvr, transition, timing, extLst.
        root=slide._element
        existing=root.find("{http://schemas.openxmlformats.org/presentationml/2006/main}transition")
        if existing is not None:
            root.remove(existing)
        timing=root.find("{http://schemas.openxmlformats.org/presentationml/2006/main}timing")
        if timing is not None:
            root.insert(list(root).index(timing),transition)
        else:
            extension=root.find("{http://schemas.openxmlformats.org/presentationml/2006/main}extLst")
            if extension is not None:
                root.insert(list(root).index(extension),transition)
            else:
                root.append(transition)

    def _raster_ink(self, slide, surface):
        """Add ink before editable OOXML shapes on a native slide.

        python-pptx appends shapes front-to-back. A full-slide ink picture
        inserted after native shapes would cover them in exported PowerPoint.
        """
        if surface.get("strokes"):
            image = render_layer(
                surface["strokes"],
                width=round(surface["width_pt"] * 2),
                height=round(surface["height_pt"] * 2),
            )
            stream = BytesIO()
            image.save(stream, format="PNG")
            stream.seek(0)
            slide.shapes.add_picture(
                stream, 0, 0,
                width=self.presentation.slide_width,
                height=self.presentation.slide_height,
            )
    def _text_overlays(self, slide, surface):
        for text in surface.get("text_overlays", []):
            shape = slide.shapes.add_textbox(
                int(text["x"] * self.presentation.slide_width),
                int(text["y"] * self.presentation.slide_height),
                max(1, int(text["width"] * self.presentation.slide_width)),
                max(1, int(text["height"] * self.presentation.slide_height)),
            )
            shape.text_frame.clear()
            run = shape.text_frame.paragraphs[0].add_run()
            run.text = text["text"]
            run.font.name = text["font_family"]
            run.font.size = Pt(text["font_size_pt"])
            run.font.color.rgb = rgb(text["color"])

    def _overlay(self, slide, surface):
        """Preserve the historical annotation order for imported slides."""
        self._raster_ink(slide, surface)
        self._text_overlays(slide, surface)


    def _patch_original_shape(self, shape, obj):
        """Edit only requested properties, leaving all untouched OOXML intact.

        Templates often contain formatting, theme references and relationship
        metadata absent from the compact Open Doc model.
        """
        original = obj["source_original"]
        changed = {key for key, value in obj.items()
                   if key not in {"id", "source_original", "source_shape_index"}
                   and original.get(key) != value}
        if not changed:
            return
        if shape.has_chart:
            chart_options = {
                "chart_type", "chart_title", "chart_subtitle", "chart_palette",
                "chart_categories", "chart_values", "chart_series",
                "chart_background", "chart_background_color",
                "chart_color_mode", "chart_item_colors",
                "chart_data_labels", "chart_percent_mode",
                "chart_label_font", "chart_label_font_size",
                "chart_label_letter_spacing", "chart_label_color",
                "chart_label_bold", "chart_label_italic",
                "chart_label_wrap", "chart_label_visible",
                "chart_label_rotation", "chart_label_align",
                "chart_margin_mode", "chart_margin", "chart_layout_auto",
                "chart_legend_position"
            }
            if changed - chart_options - {"x", "y", "width", "height", "name"}:
                raise ValueError("Propriedade do gráfico original não editável.")
            if "chart_type" in changed:
                raise ValueError("Trocar o tipo de gráfico importado ainda exige recriar o gráfico.")
            chart = shape.chart
            if changed & {"chart_categories", "chart_values", "chart_series"}:
                data = CategoryChartData()
                data.categories = obj["chart_categories"]
                for series in obj.get("chart_series") or [{
                    "name": "Valores", "values": obj["chart_values"]
                }]:
                    data.add_series(series["name"], series["values"])
                chart.replace_data(data)
            if changed & {"chart_title", "chart_subtitle"}:
                title = obj.get("chart_title", "")
                subtitle = obj.get("chart_subtitle", "")
                chart.has_title = bool(title or subtitle)
                if chart.has_title:
                    chart.chart_title.text_frame.text = title + (
                        "\\n" + subtitle if subtitle else ""
                    )
            if changed & chart_options:
                chart.has_legend = (
                    obj.get("chart_type") == "pie" or
                    len(obj.get("chart_series") or []) > 1
                )
                palette = {
                    "blue": ["#004AC6", "#6A9EFF", "#90C2FF", "#274F98", "#AFCBFF"],
                    "green": ["#2B886A", "#72C3A0", "#A2DEC5", "#14634B", "#D0F0DD"],
                    "orange": ["#F07938", "#FFC16D", "#BE4F2E", "#EACB90", "#F9DFCA"],
                    "contrast": ["#004AC6", "#B64264", "#267D4D", "#D18919", "#784FC5"],
                }[obj.get("chart_palette", "blue")]
                self._chart_style(chart, obj, palette)
            for field, attr, scale in (
                ("x", "left", self.presentation.slide_width),
                ("y", "top", self.presentation.slide_height),
                ("width", "width", self.presentation.slide_width),
                ("height", "height", self.presentation.slide_height),
            ):
                if field in changed:
                    setattr(shape, attr, int(obj[field] * scale))
            if "name" in changed:
                shape.name = obj["name"]
            return
        if "math_blocks" in changed:
            if read_math(shape) is None:
                raise ValueError("O objeto original não contém matemática OMML.")
            write_math(shape, obj["math_blocks"])
            changed.remove("math_blocks")
        if "text_runs" in changed:
            if not shape.has_text_frame:
                raise ValueError("O objeto original não possui runs de texto.")
            target_runs = obj["text_runs"]
            source_runs = original.get("text_runs")
            paragraphs = shape.text_frame.paragraphs
            if (not isinstance(target_runs, list)
                    or not isinstance(source_runs, list)
                    or len(target_runs) != len(paragraphs)
                    or len(target_runs) != len(source_runs)):
                raise ValueError("Não é seguro reestruturar parágrafos externos.")
            for line_index, line in enumerate(target_runs):
                actual = paragraphs[line_index].runs
                if len(line) != len(actual) or len(line) != len(source_runs[line_index]):
                    raise ValueError("Não é seguro alterar a quantidade de runs.")
                for index, item in enumerate(line):
                    prev = source_runs[line_index][index]
                    if {key: val for key, val in item.items() if key != "text"} != {
                        key: val for key, val in prev.items() if key != "text"
                    }:
                        raise ValueError("Modificar estilos de runs externos exige suporte adicional.")
                    if actual[index].text != item["text"]:
                        actual[index].text = item["text"]
            joined = "\n".join("".join(run["text"] for run in line)
                               for line in target_runs)
            if "text" in changed and obj["text"] != joined:
                raise ValueError("Texto agregado diverge dos runs preservados.")
            changed.discard("text")
            changed.remove("text_runs")
        if "table_cells" in changed:
            if not shape.has_table:
                raise ValueError("O objeto original não contém tabela editável.")
            cells = obj["table_cells"]
            table = shape.table
            if len(cells) != len(table.rows) or any(
                len(row) != len(table.columns) for row in cells
            ):
                raise ValueError(
                    "Alterar estrutura de tabela externa ainda não é seguro."
                )
            for row_index, row in enumerate(cells):
                for col_index, value in enumerate(row):
                    cell = table.cell(row_index, col_index)
                    if cell.text != value:
                        # Touch only the changed cell; other cells retain
                        # their exact native OOXML (fills, borders, runs).
                        paragraph = cell.text_frame.paragraphs[0]
                        if len(cell.text_frame.paragraphs) == 1 and len(paragraph.runs) == 1:
                            paragraph.runs[0].text = value
                        else:
                            cell.text = value
            changed.remove("table_cells")
        supported = {"x", "y", "width", "height", "rotation", "name",
                     "text", "color", "font_family", "font_size_pt",
                     "font_bold", "font_italic", "font_letter_spacing_pt", "fill", "stroke", "stroke_width",
                     "crop_left", "crop_right", "crop_top", "crop_bottom",
                     "flip_h", "flip_v"}
        unsupported = changed - supported
        if unsupported:
            raise ValueError("A edição exige suporte adicional para propriedades originais: "
                             + ", ".join(sorted(unsupported)))
        width, height = self.presentation.slide_width, self.presentation.slide_height
        for field, scale in (("x", width), ("y", height),
                             ("width", width), ("height", height)):
            if field in changed:
                setattr(shape, {"x": "left", "y": "top"}.get(field, field),
                        int(obj[field] * scale))
        if "rotation" in changed:
            shape.rotation = obj["rotation"]
        if "name" in changed:
            shape.name = obj["name"]
        if "text" in changed:
            if not shape.has_text_frame:
                raise ValueError("O objeto original não possui texto editável.")
            paragraphs = shape.text_frame.paragraphs
            # A single existing run can be edited without destroying its
            # OOXML style (font fallback, spacing, effects and theme links).
            if (len(paragraphs) == 1 and len(paragraphs[0].runs) == 1
                    and "\\n" not in obj["text"]):
                paragraphs[0].runs[0].text = obj["text"]
            else:
                # A whole-text replacement is intentional, so retain the
                # leading run's OOXML formatting (and the text-frame style)
                # rather than replacing the entire text frame. The replaced
                # text no longer contains the original rich-text segments.
                first = paragraphs[0]
                if first.runs:
                    leading = first.runs[0]
                else:
                    leading = first.add_run()
                leading.text = obj["text"]
                for paragraph_index, paragraph in enumerate(list(shape.text_frame.paragraphs)):
                    for run_index, run in enumerate(list(paragraph.runs)):
                        if paragraph_index != 0 or run_index != 0:
                            run._r.getparent().remove(run._r)
                    if paragraph_index != 0:
                        paragraph._p.getparent().remove(paragraph._p)
        font_fields = changed & {"color", "font_family", "font_size_pt",
                                 "font_bold", "font_italic", "font_letter_spacing_pt"}
        if font_fields:
            if not shape.has_text_frame:
                raise ValueError("O objeto original não possui fonte editável.")
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    if "color" in changed:
                        run.font.color.rgb = rgb(obj["color"])
                    if "font_family" in changed:
                        run.font.name = obj["font_family"]
                    if "font_size_pt" in changed:
                        run.font.size = Pt(obj["font_size_pt"])
                    if "font_bold" in changed:
                        run.font.bold = obj["font_bold"]
                    if "font_italic" in changed:
                        run.font.italic = obj["font_italic"]
                    if "font_letter_spacing_pt" in changed:
                        run._r.get_or_add_rPr().set("spc",
                            str(round(float(obj["font_letter_spacing_pt"]) * 100)))
        if "fill" in changed:
            shape.fill.solid()
            shape.fill.fore_color.rgb = rgb(obj["fill"])
        if "stroke" in changed:
            shape.line.color.rgb = rgb(obj["stroke"])
        if "stroke_width" in changed:
            shape.line.width = Pt(obj["stroke_width"])
        for key in ("crop_left", "crop_right", "crop_top", "crop_bottom"):
            if key in changed:
                if not hasattr(shape, key):
                    raise ValueError("Recorte não suportado por este objeto.")
                setattr(shape, key, obj[key])
        if changed & {"flip_h", "flip_v"}:
            if not hasattr(shape, "_pic"):
                raise ValueError("Espelhamento não suportado por este objeto.")
            xfrm = shape._pic.spPr.get_or_add_xfrm()
            if "flip_h" in changed:
                xfrm.flipH = obj["flip_h"]
            if "flip_v" in changed:
                xfrm.flipV = obj["flip_v"]

    def _write_preserving_source(self):
        """Patch original slides instead of rebuilding theme/master/layouts.

        Structural slide changes are rejected until reordering and slide
        master inheritance are implemented without loss.
        """
        surfaces = self.model["surfaces"]
        if len(surfaces) != len(self.presentation.slides) or any(
            surface.get("source_slide_index") != index
            for index, surface in enumerate(surfaces)
        ):
            raise ValueError(
                "A edição da estrutura dos slides externos ainda não preserva "
                "todos os modelos originais; o arquivo não foi modificado."
            )
        for surface, slide in zip(surfaces, self.presentation.slides):
            original_shapes = list(slide.shapes)
            original_indices = set()
            ordered_elements = []
            for obj in surface.get("elements", []):
                if "source_shape_index" in obj:
                    index = obj["source_shape_index"]
                    if (not isinstance(index, int) or
                        index < 0 or index >= len(original_shapes) or
                        index in original_indices or
                        not isinstance(obj.get("source_original"), dict)):
                        raise ValueError("Referência ao objeto original inválida.")
                    original_indices.add(index)
                    shape = original_shapes[index]
                    self._patch_original_shape(shape, obj)
                else:
                    shape = self._native_shape(slide, obj)
                ordered_elements.append(shape._element)
            tree = slide.shapes._spTree
            for old in original_shapes:
                tree.remove(old._element)
            for element in ordered_elements:
                if element.getparent() is tree:
                    tree.remove(element)
                tree.append(element)
            if surface.get("background", "#FFFFFF") != self._source_background(slide):
                # If the user's editor changed the background, apply that change.
                baseline = surface.get("source_background")
                if baseline is not None and surface["background"] != baseline:
                    slide.background.fill.solid()
                    slide.background.fill.fore_color.rgb = rgb(surface["background"])
            if surface.get("notes") is not None and slide.has_notes_slide:
                original_notes = slide.notes_slide.notes_text_frame.text
                if surface["notes"] != original_notes:
                    slide.notes_slide.notes_text_frame.text = surface["notes"]
            self._overlay(slide, surface)

    @staticmethod
    def _source_background(slide):
        from .native_importer import _fill_color
        return _fill_color(slide.background.fill, "#FFFFFF")

    def write(self, destination):
        if self.preserve_source:
            self._write_preserving_source()
        elif self.native:
            for surface in self.model["surfaces"]:
                slide = self.presentation.slides.add_slide(self.presentation.slide_layouts[6])
                slide.background.fill.solid()
                slide.background.fill.fore_color.rgb = rgb(surface.get("background", "#FFFFFF"))
                # Paint ink first so vector shapes remain above the bitmap.
                # Legacy text overlays stay above native objects.
                self._raster_ink(slide, surface)
                for obj in surface.get("elements", []):
                    self._native_shape(slide, obj)
                if surface.get("notes"):
                    slide.notes_slide.notes_text_frame.text = surface["notes"]
                self._text_overlays(slide, surface)
                self._apply_transition(slide,surface)
        else:
            for slide, surface in zip(self.presentation.slides, self.model["surfaces"]):
                self._overlay(slide, surface)
        self.presentation.save(destination)


def export_pptx(source, model, destination):
    """Stable public entry point preserved for the existing Vela service."""
    SlideDeckExporter(source, model).write(destination)

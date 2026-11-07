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
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Pt

from ...ink.raster import render_layer
from .image_effects import export_image_effects


def rgb(value: str) -> RGBColor:
    return RGBColor.from_string(value.lstrip("#").upper())


class SlideDeckExporter:
    """Project validated normalized geometry into editable OOXML shapes."""

    def __init__(self, source, model):
        self.model = model
        self.native = model.get("editable_deck") is True
        # Reimport exactly the native subset without losing editability.
        # Non-OpenDoc originals remain read-only until explicitly converted.
        self.presentation = Presentation() if self.native else Presentation(source)
        if self.native:
            self.presentation.core_properties.keywords = "OpenDoc:EditableSlide-v1"
            first = model["surfaces"][0]
            self.presentation.slide_width = Pt(first["width_pt"])
            self.presentation.slide_height = Pt(first["height_pt"])

    def _native_shape(self, slide, obj):
        width, height = self.presentation.slide_width, self.presentation.slide_height
        left = int(obj["x"] * width)
        top = int(obj["y"] * height)
        w = max(1, int(obj["width"] * width))
        h = max(1, int(obj["height"] * height))
        kind = obj["type"]
        if kind == "chart":
            native_data=CategoryChartData()
            native_data.categories=obj["chart_categories"]
            native_data.add_series("Valores", obj["chart_values"])
            chart_type={
                "bar":XL_CHART_TYPE.COLUMN_CLUSTERED,
                "line":XL_CHART_TYPE.LINE_MARKERS,
                "pie":XL_CHART_TYPE.PIE,
            }[obj.get("chart_type","bar")]
            shape=slide.shapes.add_chart(chart_type,left,top,w,h,native_data)
            chart=shape.chart
            chart.has_title=bool(obj.get("chart_title"))
            if chart.has_title:
                chart.chart_title.text_frame.text=obj["chart_title"]
            chart.has_legend=(obj.get("chart_type")=="pie")
            if chart.has_legend:
                chart.legend.position=XL_LEGEND_POSITION.RIGHT
            # Native OOXML chart parts + embedded editable XLSX workbook.
            # Palette is editable property, not a pre-rendered screenshot.
            palette={
                "blue":["004AC6","6A9EFF","90C2FF","274F98","AFCBFF"],
                "green":["2B886A","72C3A0","A2DEC5","14634B","D0F0DD"],
                "orange":["F07938","FFC16D","BE4F2E","EACB90","F9DFCA"],
                "contrast":["004AC6","B64264","267D4D","D18919","784FC5"],
            }[obj.get("chart_palette","blue")]
            series=chart.series[0]
            if obj.get("chart_type")=="line":
                series.format.line.color.rgb=RGBColor.from_string(palette[0])
                series.format.line.width=Pt(2.5)
            else:
                for i,point in enumerate(series.points):
                    point.format.fill.solid()
                    point.format.fill.fore_color.rgb=RGBColor.from_string(palette[i%len(palette)])
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
            }
            shape = slide.shapes.add_shape(types[kind], left, top, w, h)
            shape.fill.solid()
            shape.fill.fore_color.rgb = rgb(obj.get("fill", "#DAE2FD"))
            shape.line.color.rgb = rgb(obj.get("stroke", "#004AC6"))
        if kind not in {"text", "image", "chart"}:
            shape.line.width = Pt(obj.get("stroke_width", 1.5))
        if kind!="chart":
            shape.rotation = obj.get("rotation", 0)
        if obj.get("name"):
            shape.name = obj["name"]
        if kind == "text" or obj.get("text"):
            frame = shape.text_frame
            frame.clear()
            frame.word_wrap = True
            run = frame.paragraphs[0].add_run()
            run.text = obj.get("text", "")
            run.font.name = obj.get("font_family", "Inter")
            run.font.size = Pt(obj.get("font_size_pt", 28))
            run.font.color.rgb = rgb(obj.get("color", "#191C1E"))
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

    def write(self, destination):
        if self.native:
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

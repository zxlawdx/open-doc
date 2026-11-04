"""PPTX export for imported documents and fully editable Open Doc slide decks.

Use python-pptx, already installed by Open Doc. Never rasterize native slide
text or figures; keep source shapes intact for imported presentations.
"""
from __future__ import annotations

from io import BytesIO

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Pt

from ...ink.raster import render_layer


def rgb(value: str) -> RGBColor:
    return RGBColor.from_string(value.lstrip("#").upper())


class SlideDeckExporter:
    """Project validated normalized geometry into editable OOXML shapes."""

    def __init__(self, source, model):
        self.model = model
        self.native = model.get("editable_deck") is True
        self.presentation = Presentation() if self.native else Presentation(source)
        if self.native:
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
        if kind == "text":
            shape = slide.shapes.add_textbox(left, top, w, h)
            shape.fill.background()
        else:
            shape_type = MSO_SHAPE.RECTANGLE if kind == "rect" else MSO_SHAPE.OVAL
            shape = slide.shapes.add_shape(shape_type, left, top, w, h)
            shape.fill.solid()
            shape.fill.fore_color.rgb = rgb(obj.get("fill", "#DAE2FD"))
            shape.line.color.rgb = rgb(obj.get("stroke", "#004AC6"))
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

    def _overlay(self, slide, surface):
        # Keep legacy layer ordering: raster ink is behind editable text.
        # This is also required for exported PPTX text to stay clickable.
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

    def write(self, destination):
        if self.native:
            for surface in self.model["surfaces"]:
                slide = self.presentation.slides.add_slide(self.presentation.slide_layouts[6])
                slide.background.fill.solid()
                slide.background.fill.fore_color.rgb = rgb(surface.get("background", "#FFFFFF"))
                for obj in surface.get("elements", []):
                    self._native_shape(slide, obj)
                if surface.get("notes"):
                    slide.notes_slide.notes_text_frame.text = surface["notes"]
                self._overlay(slide, surface)
        else:
            for slide, surface in zip(self.presentation.slides, self.model["surfaces"]):
                self._overlay(slide, surface)
        self.presentation.save(destination)


def export_pptx(source, model, destination):
    """Stable public entry point preserved for the existing Vela service."""
    SlideDeckExporter(source, model).write(destination)

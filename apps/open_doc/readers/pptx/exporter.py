from pptx import Presentation
from pptx.util import Pt
from pptx.dml.color import RGBColor
from io import BytesIO
from ...ink.raster import render_layer


def export_pptx(source, model, destination):
    presentation = Presentation(source)
    for slide, surface in zip(presentation.slides, model["surfaces"]):
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
                stream,
                0,
                0,
                width=presentation.slide_width,
                height=presentation.slide_height,
            )
        for text in surface.get("text_overlays", []):
            shape = slide.shapes.add_textbox(
                int(text["x"] * presentation.slide_width),
                int(text["y"] * presentation.slide_height),
                max(1, int(text["width"] * presentation.slide_width)),
                max(1, int(text["height"] * presentation.slide_height)),
            )
            shape.text_frame.clear()
            run = shape.text_frame.paragraphs[0].add_run()
            run.text = text["text"]
            run.font.name = text["font_family"]
            run.font.size = Pt(text["font_size_pt"])
            run.font.color.rgb = RGBColor.from_string(text["color"].lstrip("#"))
    presentation.save(destination)

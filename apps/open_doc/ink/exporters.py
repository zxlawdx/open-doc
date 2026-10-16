"""Native text plus transparent ink, merged with the unmodified PDF source."""

from io import BytesIO
from fpdf import FPDF
from pypdf import PdfReader, PdfWriter
from .raster import render_layer
from ..services.preferences_service import PROJECT_ROOT


def overlay_pdf(surface, fonts=None):
    w, h = surface["width_pt"], surface["height_pt"]
    pdf = FPDF(unit="pt", format=(w, h))
    pdf.set_auto_page_break(False)
    pdf.set_margins(0, 0, 0)
    pdf.add_page()
    strokes = surface.get("strokes", [])
    if strokes:
        image = render_layer(
            strokes, width=min(5000, round(w * 2)), height=min(5000, round(h * 2))
        )
        pdf.image(image, x=0, y=0, w=w, h=h)
    for index, text in enumerate(surface.get("text_overlays", [])):
        candidate = fonts.resolve(text["font_family"]) if fonts else None
        fallback = PROJECT_ROOT / "apps/open_doc/static/fonts/Inter.ttf"
        name = "Overlay" + str(index)
        try:
            pdf.add_font(name, fname=str(candidate or fallback))
        except Exception:
            pdf.add_font(name, fname=str(fallback))
        pdf.set_font(name, size=text["font_size_pt"])
        pdf.set_text_color(*(int(text["color"][i : i + 2], 16) for i in (1, 3, 5)))
        pdf.set_xy(text["x"] * w, text["y"] * h)
        pdf.multi_cell(
            max(1, text["width"] * w), max(1, text["font_size_pt"] * 1.25), text["text"]
        )
    return bytes(pdf.output())


def export_pdf(source, model, destination, fonts=None):
    writer = PdfWriter(clone_from=source)
    for index, page in enumerate(writer.pages):
        # Normalize rotation into content before merging in visual coordinates.
        if page.rotation:
            page.transfer_rotation_to_content()
        surface = model["surfaces"][index]
        if surface.get("strokes") or surface.get("text_overlays"):
            overlay = PdfReader(BytesIO(overlay_pdf(surface, fonts))).pages[0]
            box = page.cropbox
            from pypdf import Transformation

            page.merge_transformed_page(
                overlay, Transformation().translate(float(box.left), float(box.bottom))
            )
    with destination.open("wb") as stream:
        writer.write(stream)


def add_rich_ink(destination, layers, fonts=None):
    """Overlay rich page ink on the existing approximate PDF text layout."""
    writer = PdfWriter(clone_from=BytesIO(destination.read_bytes()))
    for layer in layers:
        if not layer.get("strokes"):
            continue
        index = layer["surface_index"]
        while len(writer.pages) <= index:
            writer.add_blank_page(
                width=layer.get("width_pt", 595.28),
                height=layer.get("height_pt", 841.89),
            )
        page = writer.pages[index]
        surface = {
            **layer,
            "width_pt": float(page.cropbox.width),
            "height_pt": float(page.cropbox.height),
        }
        overlay = PdfReader(BytesIO(overlay_pdf(surface, fonts))).pages[0]
        page.merge_page(overlay)
    with destination.open("wb") as stream:
        writer.write(stream)

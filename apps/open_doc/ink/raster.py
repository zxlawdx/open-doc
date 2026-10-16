"""Rasterize only annotation layers; documents themselves remain untouched."""

from PIL import Image, ImageDraw
from .validation import validate_layers


def render_layer(strokes, *, width, height):
    validate_layers([{"surface_index": 0, "strokes": strokes}])
    if width * height > 40000000 or min(width, height) < 1:
        raise ValueError("Camada muito grande.")
    image = Image.new("RGBA", (width, height))
    for stroke in strokes:
        outline = stroke.get("outline", [])
        if len(outline) < 3:
            continue
        overlay = Image.new("RGBA", image.size)
        rgb = tuple(int(stroke["color"][i : i + 2], 16) for i in (1, 3, 5))
        ImageDraw.Draw(overlay).polygon(
            [(x * width, y * height) for x, y in outline],
            fill=(*rgb, round(255 * stroke.get("opacity", 1))),
        )
        image = Image.alpha_composite(image, overlay)
    return image


def recognition_image(strokes):
    image = render_layer(
        [{**s, "color": "#000000", "opacity": 1} for s in strokes],
        width=1800,
        height=1800,
    )
    bounds = image.getbbox()
    if not bounds:
        raise ValueError("Escreva antes de converter.")
    cropped = image.crop(bounds)
    out = Image.new("RGB", (cropped.width + 48, cropped.height + 48), "white")
    out.paste(cropped, (24, 24), cropped)
    return out

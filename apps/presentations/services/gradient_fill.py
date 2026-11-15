"""Read and write editable two-stop linear DrawingML fills."""

from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_FILL


def read_gradient(fill):
    if fill.type != MSO_FILL.GRADIENT:
        return None
    try:
        stops = fill.gradient_stops
        if len(stops) != 2 or stops[0].position != 0 or stops[1].position != 1:
            return None
        angle = (90 - fill.gradient_angle) % 360
        return {
            "start": f"#{stops[0].color.rgb}",
            "end": f"#{stops[1].color.rgb}",
            "angle": round(angle, 5),
        }
    except (AttributeError, TypeError, ValueError):
        return None


def write_fill(fill, color, gradient=None):
    if gradient is None:
        fill.solid()
        fill.fore_color.rgb = RGBColor.from_string(color[1:].upper())
        return
    fill.gradient()
    fill.gradient_angle = (90 - gradient["angle"]) % 360
    for position, key in enumerate(("start", "end")):
        stop = fill.gradient_stops[position]
        stop.position = position
        stop.color.rgb = RGBColor.from_string(gradient[key][1:].upper())

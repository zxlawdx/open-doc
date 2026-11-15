"""Centralized OOXML names and unit conversions."""

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W, "r": R, "a": A, "wp": WP, "rel": REL}
TWIPS_PER_POINT = 20
EMU_PER_POINT = 12700
HALF_POINTS_PER_POINT = 2


def w(tag):
    return "{" + W + "}" + tag


def attr(node, key="val", default=None):
    return node.get(w(key), default) if node is not None else default


def twips_to_pt(v):
    return None if v is None else int(v) / TWIPS_PER_POINT


def half_points_to_pt(v):
    return None if v is None else int(v) / HALF_POINTS_PER_POINT


def emu_to_pt(v):
    return None if v is None else int(v) / EMU_PER_POINT

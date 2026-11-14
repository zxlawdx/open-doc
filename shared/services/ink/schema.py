"""Normalized, local, versioned ink primitives shared by all document kinds."""

from dataclasses import asdict, dataclass, field
from uuid import uuid4


def new_id():
    return str(uuid4())


@dataclass(slots=True)
class InkPoint:
    x: float
    y: float
    pressure: float = 0.5
    tilt_x: float = 0
    tilt_y: float = 0
    timestamp_ms: float = 0


@dataclass(slots=True)
class InkStroke:
    id: str = field(default_factory=new_id)
    tool: str = "pen"
    color: str = "#202124"
    size: float = 2
    opacity: float = 1
    points: list = field(default_factory=list)
    outline: list = field(default_factory=list)


@dataclass(slots=True)
class TextOverlay:
    id: str = field(default_factory=new_id)
    text: str = ""
    x: float = 0
    y: float = 0
    width: float = 0.3
    height: float = 0.05
    font_family: str = "Arial"
    font_size_pt: float = 12
    color: str = "#202124"
    confidence: float | None = None


@dataclass(slots=True)
class InkLayer:
    surface_index: int = 0
    strokes: list = field(default_factory=list)
    text_overlays: list = field(default_factory=list)
    width_pt: float = 595.28
    height_pt: float = 841.89


def to_dict(value):
    return asdict(value)

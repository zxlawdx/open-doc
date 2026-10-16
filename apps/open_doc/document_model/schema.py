from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal
from uuid import uuid4


def node_id() -> str:
    return str(uuid4())


@dataclass(slots=True)
class TextStyle:
    font_family: str | None = None
    font_size_pt: float | None = None
    bold: bool | None = None
    italic: bool | None = None
    underline: str | None = None
    strike: bool | None = None
    color: str | None = None
    highlight: str | None = None
    vertical_align: Literal["baseline", "superscript", "subscript"] = "baseline"
    language: str | None = None
    character_spacing_pt: float | None = None
    small_caps: bool | None = None
    all_caps: bool | None = None


@dataclass(slots=True)
class ParagraphStyle:
    style_id: str | None = None
    alignment: Literal["left", "center", "right", "justify", "distribute"] | None = None
    line_spacing: float | None = None
    line_spacing_rule: str | None = None
    space_before_pt: float | None = None
    space_after_pt: float | None = None
    first_line_indent_pt: float | None = None
    hanging_indent_pt: float | None = None
    left_indent_pt: float | None = None
    right_indent_pt: float | None = None
    keep_next: bool | None = None
    keep_lines: bool | None = None
    page_break_before: bool | None = None
    widow_control: bool | None = None
    outline_level: int | None = None
    tabs: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class TextRun:
    id: str = field(default_factory=node_id)
    type: Literal["text"] = "text"
    text: str = ""
    style: TextStyle = field(default_factory=TextStyle)
    raw_properties: str | None = None


@dataclass(slots=True)
class BreakRun:
    id: str = field(default_factory=node_id)
    type: Literal["break"] = "break"
    break_type: Literal["line", "page", "column"] = "line"


@dataclass(slots=True)
class TabRun:
    id: str = field(default_factory=node_id)
    type: Literal["tab"] = "tab"


@dataclass(slots=True)
class HyperlinkRun:
    id: str = field(default_factory=node_id)
    type: Literal["hyperlink"] = "hyperlink"
    href: str = ""
    children: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class ImageRun:
    id: str = field(default_factory=node_id)
    type: Literal["image"] = "image"
    media_id: str = ""
    width_pt: float | None = None
    height_pt: float | None = None
    alt_text: str = ""
    placement: Literal["inline", "floating"] = "inline"
    raw_anchor_xml: str | None = None


@dataclass(slots=True)
class ListInfo:
    num_id: str | None = None
    abstract_num_id: str | None = None
    level: int = 0
    format: str | None = None
    text_pattern: str | None = None
    start: int | None = None


@dataclass(slots=True)
class Paragraph:
    raw_xml: str | None = None
    block_kind: str | None = None
    id: str = field(default_factory=node_id)
    type: Literal["paragraph"] = "paragraph"
    style: ParagraphStyle = field(default_factory=ParagraphStyle)
    list_info: ListInfo | None = None
    children: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class TableCell:
    raw_properties: str | None = None
    merge_continue: bool = False
    id: str = field(default_factory=node_id)
    blocks: list[dict[str, Any]] = field(default_factory=list)
    col_span: int = 1
    row_span: int = 1
    width_pt: float | None = None
    vertical_align: str | None = None
    shading: str | None = None
    borders: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TableRow:
    raw_properties: str | None = None
    id: str = field(default_factory=node_id)
    cells: list[TableCell] = field(default_factory=list)
    height_pt: float | None = None
    cant_split: bool | None = None
    is_header: bool | None = None


@dataclass(slots=True)
class Table:
    raw_xml: str | None = None
    id: str = field(default_factory=node_id)
    type: Literal["table"] = "table"
    rows: list[TableRow] = field(default_factory=list)
    width_pt: float | None = None
    alignment: str | None = None
    layout: str | None = None
    style_id: str | None = None
    column_widths_pt: list[float] = field(default_factory=list)
    borders: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Section:
    raw_xml: str | None = None
    id: str = field(default_factory=node_id)
    type: Literal["section"] = "section"
    page_width_pt: float = 595.28
    page_height_pt: float = 841.89
    orientation: Literal["portrait", "landscape"] = "portrait"
    margin_top_pt: float = 72.0
    margin_right_pt: float = 72.0
    margin_bottom_pt: float = 72.0
    margin_left_pt: float = 72.0
    header_distance_pt: float | None = None
    footer_distance_pt: float | None = None
    columns: int = 1
    header_ids: list[str] = field(default_factory=list)
    footer_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class RichDocument:
    ink_layers: list[dict[str, Any]] = field(default_factory=list)
    version: Literal["opendoc-rich-v1"] = "opendoc-rich-v1"
    blocks: list[dict[str, Any]] = field(default_factory=list)
    styles: dict[str, Any] = field(default_factory=dict)
    numbering: dict[str, Any] = field(default_factory=dict)
    media: dict[str, Any] = field(default_factory=dict)
    sections: list[dict[str, Any]] = field(default_factory=list)
    headers: dict[str, Any] = field(default_factory=dict)
    footers: dict[str, Any] = field(default_factory=dict)
    footnotes: dict[str, Any] = field(default_factory=dict)
    endnotes: dict[str, Any] = field(default_factory=dict)
    comments: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    preserved_parts: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

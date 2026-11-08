"""Native DrawingML table formatting shared by the PPTX import and export paths."""

from lxml import etree
from pptx.dml.color import RGBColor
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Pt

TABLE_STYLE_FIELDS = {"table_preset", "table_transparent", "table_padding_pt"}
_STYLE_URI = "{FF970CB9-02B2-4CC5-82FC-F439E8B1F15E}"
_STYLE_TAG = "{urn:opendoc:pptx}tableStyle"


def read_table_style(table):
    props = table._tbl.tblPr
    if props is not None:
        marker = next(props.iter(_STYLE_TAG), None)
        if marker is not None:
            return {
                "table_preset": marker.get("preset", "header"),
                "table_transparent": marker.get("transparent") == "true",
                "table_padding_pt": float(marker.get("padding", "3")),
            }
    return {}


def _border(cell, tag, width):
    properties = cell._tc.get_or_add_tcPr()
    qualified = OxmlElement(tag).tag
    for old in properties.findall(qualified):
        properties.remove(old)
    line = OxmlElement(tag)
    if width:
        line.set("w", str(Pt(width)))
        fill = OxmlElement("a:solidFill")
        color = OxmlElement("a:srgbClr")
        color.set("val", "A0A9BA")
        fill.append(color)
    else:
        fill = OxmlElement("a:noFill")
    line.append(fill)
    properties.insert(0, line)


def write_table_style(table, obj, changed=TABLE_STYLE_FIELDS, *, new=False):
    preset = obj.get("table_preset", "header")
    transparent = obj.get("table_transparent", False)
    padding = obj.get("table_padding_pt", 3)
    if "table_preset" in changed:
        table.first_row = preset == "header"
    for row in range(len(table.rows)):
        for col in range(len(table.columns)):
            cell = table.cell(row, col)
            header = row == 0 and preset == "header"
            if changed & {"table_preset", "table_transparent"}:
                if transparent:
                    cell.fill.background()
                else:
                    cell.fill.solid()
                    cell.fill.fore_color.rgb = RGBColor.from_string(
                        "E9F2FF" if header or preset == "matrix" else "FFFFFF"
                    )
            if "table_padding_pt" in changed:
                cell.margin_left = cell.margin_right = Pt(padding)
                cell.margin_top = cell.margin_bottom = Pt(padding)
            if "table_preset" in changed:
                for tag in ("a:lnB", "a:lnT", "a:lnR", "a:lnL"):
                    _border(cell, tag, {"plain": 0, "matrix": 1.5}.get(preset, .75))
            if new or "table_preset" in changed:
                for paragraph in cell.text_frame.paragraphs:
                    paragraph.font.bold = header
                    if new:
                        paragraph.font.size = Pt(obj["font_size_pt"])
            if new or "color" in changed:
                color = RGBColor.from_string(obj.get("color", "#191C1E")[1:].upper())
                for paragraph in cell.text_frame.paragraphs:
                    paragraph.font.color.rgb = color
                    if not new:
                        for run in paragraph.runs:
                            run.font.color.rgb = color
    props = table._tbl.get_or_add_tblPr()
    ext_list = props.find(OxmlElement("a:extLst").tag)
    if ext_list is None:
        ext_list = OxmlElement("a:extLst")
        props.append(ext_list)
    extension = next((node for node in ext_list if node.get("uri") == _STYLE_URI), None)
    if extension is None:
        extension = OxmlElement("a:ext")
        extension.set("uri", _STYLE_URI)
        ext_list.append(extension)
    marker = extension.find(_STYLE_TAG)
    if marker is None:
        marker = etree.SubElement(extension, _STYLE_TAG)
    marker.set("preset", preset)
    marker.set("transparent", str(transparent).lower())
    marker.set("padding", str(padding))

"""Safe HTML interchange from model values; never render opaque XML."""

import base64
import io
import json
import re
from html import escape
from PIL import Image
from app.document_model.serialization import load_document


def export_html(model, target, title, *, package_directory=None):
    model = load_document(model)

    def text_style(s):
        css = []
        if s.get("font_family"):
            css.append("font-family:" + json.dumps(s["font_family"]))
        if s.get("font_size_pt"):
            css.append("font-size:" + str(float(s["font_size_pt"])) + "pt")
        if s.get("bold"):
            css.append("font-weight:bold")
        if s.get("italic"):
            css.append("font-style:italic")
        decorations = []
        if s.get("underline") not in (None, "none"):
            decorations.append("underline")
        if s.get("strike"):
            decorations.append("line-through")
        if decorations:
            css.append("text-decoration:" + " ".join(decorations))
        for key, prop in [("color", "color"), ("highlight", "background-color")]:
            value = s.get(key) or ""
            value = {"yellow": "FFFF00", "green": "00FF00", "cyan": "00FFFF"}.get(
                value, value
            )
            if re.fullmatch("[a-fA-F0-9]{6}", value):
                css.append(prop + ":#" + value)
        if s.get("vertical_align") in {"superscript", "subscript"}:
            css.append(
                "vertical-align:"
                + ("super" if s["vertical_align"] == "superscript" else "sub")
            )
        return ";".join(css)

    def inline(values):
        out = []
        for n in values:
            kind = n["type"]
            if kind == "text":
                out.append(
                    '<span style="'
                    + escape(text_style(n.get("style", {})), quote=True)
                    + '">'
                    + escape(n["text"])
                    + "</span>"
                )
            elif kind == "hyperlink":
                out.append(
                    '<a href="'
                    + escape(n["href"], quote=True)
                    + '">'
                    + inline(n["children"])
                    + "</a>"
                )
            elif kind == "tab":
                out.append("&#9;")
            elif kind == "break":
                out.append("<br>")
            elif kind == "image" and package_directory:
                path = package_directory / "media" / n["media_id"]
                if path.exists():
                    data = path.read_bytes()
                    with Image.open(io.BytesIO(data)) as image:
                        kind = image.format.lower()
                    out.append(
                        '<img alt="'
                        + escape(n.get("alt_text", ""), quote=True)
                        + '" style="max-width:100%" src="data:image/'
                        + kind
                        + ";base64,"
                        + base64.b64encode(data).decode()
                        + '">'
                    )
            elif kind == "note-reference":
                out.append("<sup>[" + escape(n["note_id"]) + "]</sup>")
            else:
                out.append("<span>[Conteúdo Word preservado no DOCX]</span>")
        return "".join(out)

    def blocks(values):
        out = []
        for n in values:
            if n["type"] == "table":
                rows = []
                for row in n["rows"]:
                    rows.append(
                        "<tr>"
                        + "".join(
                            '<td colspan="'
                            + str(c.get("col_span", 1))
                            + '" rowspan="'
                            + str(c.get("row_span", 1))
                            + '">'
                            + blocks(c["blocks"])
                            + "</td>"
                            for c in row["cells"]
                            if not c.get("merge_continue")
                        )
                        + "</tr>"
                    )
                out.append("<table>" + "".join(rows) + "</table>")
            elif n["type"] == "paragraph":
                s = n.get("style", {})
                level = s.get("outline_level")
                tag = (
                    "h" + str(level + 1)
                    if isinstance(level, int) and 0 <= level <= 5
                    else "p"
                )
                align = s.get("alignment") or "left"
                out.append(
                    "<"
                    + tag
                    + ' style="text-align:'
                    + align
                    + '">'
                    + inline(n["children"])
                    + "</"
                    + tag
                    + ">"
                )
            else:
                out.append("<p>[Conteúdo Word preservado no DOCX]</p>")
        return "".join(out)

    header = "".join(blocks(v) for v in model.get("headers", {}).values())
    footer = "".join(blocks(v) for v in model.get("footers", {}).values())
    target.write_text(
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>'
        + escape(title)
        + "</title><style>body{max-width:800px;margin:3em auto;font:12pt serif}table{border-collapse:collapse;width:100%}td{border:1px solid #aaa;padding:8px}header,footer{font-size:10pt;color:#444}</style><header>"
        + header
        + "</header><main>"
        + blocks(model["blocks"])
        + "</main><footer>"
        + footer
        + "</footer></html>",
        encoding="utf-8",
    )

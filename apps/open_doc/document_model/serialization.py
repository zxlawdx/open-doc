"""Canonical JSON plus explicitly lossy Markdown adapter."""

import json
from apps.open_doc.document_model.validate import validate_rich_document


def serialize_document(model):
    return validate_rich_document(model, return_encoded=True)


def load_document(value):
    return validate_rich_document(
        json.loads(value) if isinstance(value, str) else value
    )


def rich_to_markdown(model):
    def math_value(value):
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            return "".join(math_block(item) for item in value)
        return ""

    def math_block(part):
        kind = part.get("kind")
        value = lambda field: math_value(part.get(field, ""))
        if kind in {"text", "bold"}:
            return value("value")
        if kind == "fraction":
            return "(" + value("numerator") + ")/(" + value("denominator") + ")"
        if kind == "nary":
            return (
                part["operator"]
                + "_("
                + value("lower")
                + ")^("
                + value("upper")
                + ")"
                + value("body")
            )
        if kind == "superscript":
            return value("base") + "^(" + value("power") + ")"
        if kind == "subscript":
            return value("base") + "_(" + value("sub") + ")"
        if kind == "sqrt":
            return "√(" + value("radicand") + ")"
        if kind == "root":
            return "root(" + value("index") + "," + value("radicand") + ")"
        if kind == "limit":
            return value("base") + "_(" + value("lower") + ")"
        if kind == "matrix":
            return (
                "["
                + "; ".join(
                    ", ".join(math_value(cell) for cell in row) for row in part["rows"]
                )
                + "]"
            )
        return ""

    def inline(values):
        out = []
        for n in values:
            kind = n["type"]
            s = n.get("style", {})
            text = n.get("text", "")
            if s.get("bold"):
                text = "**" + text + "**"
            if s.get("italic"):
                text = "_" + text + "_"
            if kind == "math":
                text = math_value(n.get("math_blocks", []))
            if kind == "hyperlink":
                text = "[" + inline(n["children"]) + "](" + n["href"] + ")"
            if kind == "break":
                text = "\n"
            if kind == "tab":
                text = "\t"
            if kind == "note-reference":
                text = "[^" + str(n["note_id"]) + "]"
            out.append(text)
        return "".join(out)

    def blocks(values):
        out = []
        for n in values:
            if n["type"] == "paragraph":
                text = inline(n["children"])
                s = n.get("style", {})
                level = s.get("outline_level")
                if level is not None:
                    text = "#" * min(6, level + 1) + " " + text
                li = n.get("list_info")
                if li:
                    text = (
                        "  " * li.get("level", 0)
                        + ("- " if li.get("format") == "bullet" else "1. ")
                        + text
                    )
                if n.get("block_kind") == "quote":
                    text = "> " + text
                if n.get("block_kind") == "code":
                    import re

                    fence = "`" * max(
                        [3] + [len(m) + 1 for m in re.findall("`+", text)]
                    )
                    text = fence + "\n" + text + "\n" + fence
                out.append(text)
            elif n["type"] == "table":
                rows = [
                    "| "
                    + " | ".join(
                        blocks(c["blocks"]).replace("\n", " ")
                        for c in r["cells"]
                        if not c.get("merge_continue")
                    )
                    + " |"
                    for r in n["rows"]
                ]
                if rows:
                    rows.insert(
                        1,
                        "| "
                        + " | ".join(
                            "---"
                            for c in n["rows"][0]["cells"]
                            if not c.get("merge_continue")
                        )
                        + " |",
                    )
                out.append("\n".join(rows))
        return "\n\n".join(out)

    return blocks(model["blocks"])

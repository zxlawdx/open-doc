"""Patch known OPC parts, keeping all unrelated original package bytes."""

import io
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree
from docx import Document
from app.document_model.serialization import load_document
from app.importers.docx.package import DocxPackage, parse_xml
from app.importers.docx.namespaces import R, REL, w


def element(tag, values=None):
    e = etree.Element(w(tag))
    for key, value in (values or {}).items():
        if value is not None:
            e.set(w(key), str(value))
    return e


def properties(raw, tag):
    return parse_xml(raw.encode()) if raw else element(tag)


def set_property(parent, tag, values):
    e = parent.find(w(tag))
    if e is None:
        e = element(tag)
        parent.append(e)
    for key, value in values.items():
        if value is not None:
            e.set(w(key), str(value))
    return e


def write_borders(parent, tag, values):
    if not values:
        return
    root = parent.find(w(tag))
    if root is None:
        root = element(tag)
        parent.append(root)
    for side, b in values.items():
        if side in {
            "top",
            "right",
            "bottom",
            "left",
            "insideH",
            "insideV",
            "start",
            "end",
        }:
            set_property(
                root,
                side,
                {
                    "val": b.get("style", "single"),
                    "color": b.get("color"),
                    "sz": round(b.get("size_pt", 0.5) * 8),
                    "space": b.get("space_pt", 0),
                },
            )


def text_properties(style, raw=None):
    out = properties(raw, "rPr")
    for key, tag in [
        ("bold", "b"),
        ("italic", "i"),
        ("strike", "strike"),
        ("small_caps", "smallCaps"),
        ("all_caps", "caps"),
    ]:
        if style.get(key) is not None:
            set_property(out, tag, {"val": "1" if style[key] else "0"})
    for key, tag in [
        ("underline", "u"),
        ("color", "color"),
        ("highlight", "highlight"),
        ("vertical_align", "vertAlign"),
        ("language", "lang"),
    ]:
        value = style.get(key)
        if value is None:
            continue
        if key == "highlight" and len(value) == 6:
            old = out.find(w("highlight"))
            if old is not None:
                out.remove(old)
            set_property(out, "shd", {"fill": value})
            continue
        e = set_property(out, tag, {"val": value})
        if tag == "color":
            for a in ("themeColor", "themeTint", "themeShade"):
                e.attrib.pop(w(a), None)
    if style.get("font_family"):
        old = out.find(w("rFonts"))
        if old is not None:
            out.remove(old)
        set_property(
            out,
            "rFonts",
            {key: style["font_family"] for key in ("ascii", "hAnsi", "eastAsia", "cs")},
        )
    if style.get("font_size_pt"):
        set_property(out, "sz", {"val": round(style["font_size_pt"] * 2)})
    if style.get("character_spacing_pt") is not None:
        set_property(out, "spacing", {"val": round(style["character_spacing_pt"] * 20)})
    return out


class DocxPackageWriter:
    def __init__(self, original=None):
        self.original = Path(original) if original else None

    def write(self, model, target):
        model = load_document(model)
        if self.original and self.original.exists():
            self.parts = dict(DocxPackage.open(self.original).parts)
        else:
            stream = io.BytesIO()
            Document().save(stream)
            with ZipFile(stream) as z:
                self.parts = {name: z.read(name) for name in z.namelist()}
        self.rels = parse_xml(self.parts["word/_rels/document.xml.rels"])
        self.numbering = (
            parse_xml(self.parts["word/numbering.xml"])
            if "word/numbering.xml" in self.parts
            else element("numbering")
        )
        self.new_lists = {}
        root = parse_xml(self.parts["word/document.xml"])
        body = root.find(w("body"))
        old_section = body.find(w("sectPr"))
        for e in list(body):
            body.remove(e)
        for block in model["blocks"]:
            body.append(self.block(block))
        if model.get("sections"):
            section = model["sections"][-1]
            sect = properties(section.get("raw_xml"), "sectPr")
            set_property(
                sect,
                "pgSz",
                {
                    "w": round(section.get("page_width_pt", 595.28) * 20),
                    "h": round(section.get("page_height_pt", 841.89) * 20),
                    "orient": section.get("orientation", "portrait"),
                },
            )
            set_property(
                sect,
                "pgMar",
                {
                    side: round(section.get("margin_" + side + "_pt", 72) * 20)
                    for side in ("top", "right", "bottom", "left")
                },
            )
            body.append(sect)
        elif old_section is not None:
            body.append(old_section)
        self.parts["word/document.xml"] = etree.tostring(
            root, encoding="UTF-8", xml_declaration=True, standalone=True
        )
        self.parts["word/_rels/document.xml.rels"] = etree.tostring(
            self.rels, encoding="UTF-8", xml_declaration=True
        )
        if self.new_lists or "word/numbering.xml" in self.parts:
            self.parts["word/numbering.xml"] = etree.tostring(
                self.numbering, encoding="UTF-8", xml_declaration=True
            )
        if self.new_lists:
            # Some source packages have no numbering part or relationship.
            if not any(e.get("Type", "").endswith("/numbering") for e in self.rels):
                self.relationship("numbering.xml", "numbering", False)
                self.parts["word/_rels/document.xml.rels"] = etree.tostring(
                    self.rels, encoding="UTF-8", xml_declaration=True
                )
            ct = parse_xml(self.parts["[Content_Types].xml"])
            if not any(e.get("PartName") == "/word/numbering.xml" for e in ct):
                etree.SubElement(
                    ct,
                    "{http://schemas.openxmlformats.org/package/2006/content-types}Override",
                    PartName="/word/numbering.xml",
                    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
                )
                self.parts["[Content_Types].xml"] = etree.tostring(
                    ct, encoding="UTF-8", xml_declaration=True
                )
        with ZipFile(target, "w", ZIP_DEFLATED) as z:
            for name, data in self.parts.items():
                z.writestr(name, data)

    def relationship(self, target, kind, external=True):
        for e in self.rels:
            if e.get("Target") == target and e.get("Type", "").endswith("/" + kind):
                return e.get("Id")
        used = {e.get("Id") for e in self.rels}
        i = 1
        while "rId" + str(i) in used:
            i += 1
        rid = "rId" + str(i)
        attrs = {"Id": rid, "Type": R + "/" + kind, "Target": target}
        if external:
            attrs["TargetMode"] = "External"
        etree.SubElement(self.rels, "{" + REL + "}Relationship", **attrs)
        return rid

    def list_id(self, info):
        nid = info.get("num_id")
        if nid and any(
            e.get(w("numId")) == nid for e in self.numbering.findall(w("num"))
        ):
            return nid
        kind = info.get("format") or "bullet"
        if kind in self.new_lists:
            return self.new_lists[kind]
        aid = (
            max(
                [
                    int(e.get(w("abstractNumId")))
                    for e in self.numbering.findall(w("abstractNum"))
                ]
                + [-1]
            )
            + 1
        )
        nid = (
            max(
                [int(e.get(w("numId"))) for e in self.numbering.findall(w("num"))] + [0]
            )
            + 1
        )
        abstract = element("abstractNum", {"abstractNumId": aid})
        for level in range(9):
            lvl = element("lvl", {"ilvl": level})
            for tag, value in [
                ("start", 1),
                ("numFmt", kind),
                ("lvlText", "•" if kind == "bullet" else "%" + str(level + 1) + "."),
            ]:
                lvl.append(element(tag, {"val": value}))
            abstract.append(lvl)
        self.numbering.insert(0, abstract)
        num = element("num", {"numId": nid})
        num.append(element("abstractNumId", {"val": aid}))
        self.numbering.append(num)
        self.new_lists[kind] = str(nid)
        return str(nid)

    def block(self, n):
        if n["type"] == "opaque-ooxml":
            return parse_xml(n["xml"].encode())
        if n["type"] == "table":
            out = element("tbl")
            raw = parse_xml(n["raw_xml"].encode()) if n.get("raw_xml") else None
            for tag in ("tblPr", "tblGrid"):
                e = raw.find(w(tag)) if raw is not None else None
                if e is not None:
                    out.append(e)
            prop = out.find(w("tblPr"))
            if prop is None:
                prop = element("tblPr")
                out.insert(0, prop)
            write_borders(prop, "tblBorders", n.get("borders", {}))
            if n.get("layout"):
                set_property(prop, "tblLayout", {"type": n["layout"]})
            if out.find(w("tblGrid")) is None and n.get("column_widths_pt"):
                grid = element("tblGrid")
                for width in n["column_widths_pt"]:
                    grid.append(element("gridCol", {"w": round(width * 20)}))
                out.append(grid)
            for row in n["rows"]:
                tr = element("tr")
                rp = properties(row.get("raw_properties"), "trPr")
                tr.append(rp)
                if row.get("height_pt"):
                    set_property(rp, "trHeight", {"val": round(row["height_pt"] * 20)})
                for key, tag in [
                    ("cant_split", "cantSplit"),
                    ("is_header", "tblHeader"),
                ]:
                    if row.get(key) is not None:
                        set_property(rp, tag, {"val": "1" if row[key] else "0"})
                for cell in row["cells"]:
                    tc = element("tc")
                    cp = properties(cell.get("raw_properties"), "tcPr")
                    write_borders(cp, "tcBorders", cell.get("borders", {}))
                    set_property(cp, "gridSpan", {"val": cell.get("col_span", 1)})
                    if cell.get("merge_continue"):
                        set_property(cp, "vMerge", {"val": "continue"})
                    elif cell.get("row_span", 1) > 1:
                        set_property(cp, "vMerge", {"val": "restart"})
                    if cell.get("shading"):
                        set_property(cp, "shd", {"fill": cell["shading"]})
                    if cell.get("vertical_align"):
                        set_property(cp, "vAlign", {"val": cell["vertical_align"]})
                    tc.append(cp)
                    for b in cell["blocks"]:
                        tc.append(self.block(b))
                    if not cell["blocks"]:
                        tc.append(element("p"))
                    tr.append(tc)
                out.append(tr)
            return out
        out = element("p")
        raw = parse_xml(n["raw_xml"].encode()) if n.get("raw_xml") else None
        prop = raw.find(w("pPr")) if raw is not None else None
        prop = prop if prop is not None else element("pPr")
        s = n.get("style", {})
        if s.get("style_id"):
            set_property(prop, "pStyle", {"val": s["style_id"]})
        if n.get("block_kind") == "quote":
            set_property(prop, "pStyle", {"val": "Quote"})
        if s.get("outline_level") is not None:
            set_property(prop, "outlineLvl", {"val": s["outline_level"]})
        if s.get("alignment"):
            set_property(
                prop,
                "jc",
                {"val": "both" if s["alignment"] == "justify" else s["alignment"]},
            )
        for key, tag in [
            ("keep_next", "keepNext"),
            ("keep_lines", "keepLines"),
            ("page_break_before", "pageBreakBefore"),
            ("widow_control", "widowControl"),
        ]:
            if s.get(key) is not None:
                set_property(prop, tag, {"val": "1" if s[key] else "0"})
        spacing = {
            a: round(s[k] * 20)
            for k, a in [("space_before_pt", "before"), ("space_after_pt", "after")]
            if s.get(k) is not None
        }
        if s.get("line_spacing") is not None:
            rule = s.get("line_spacing_rule") or "auto"
            spacing.update(
                line=round(s["line_spacing"] * (240 if rule == "auto" else 20)),
                lineRule=rule,
            )
        if spacing:
            set_property(prop, "spacing", spacing)
        ind = {
            a: round(s[k] * 20)
            for k, a in [
                ("left_indent_pt", "left"),
                ("right_indent_pt", "right"),
                ("first_line_indent_pt", "firstLine"),
                ("hanging_indent_pt", "hanging"),
            ]
            if s.get(k) is not None
        }
        if ind:
            set_property(prop, "ind", ind)
        old_num = prop.find(w("numPr"))
        if old_num is not None:
            prop.remove(old_num)
        if n.get("list_info"):
            li = n["list_info"]
            num = element("numPr")
            num.extend(
                [
                    element("ilvl", {"val": li.get("level", 0)}),
                    element("numId", {"val": self.list_id(li)}),
                ]
            )
            prop.append(num)
        out.append(prop)
        for child in n.get("children", []):
            if n.get("block_kind") == "code" and child["type"] == "text":
                child = {
                    **child,
                    "style": {**child.get("style", {}), "font_family": "Courier New"},
                }
            generated = self.inline(child)
            out.extend(generated if isinstance(generated, list) else [generated])
        return out

    def inline(self, n):
        kind = n["type"]
        if kind == "hyperlink":
            out = element("hyperlink")
            if n["href"].startswith("#"):
                out.set(w("anchor"), n["href"][1:])
            else:
                out.set("{" + R + "}id", self.relationship(n["href"], "hyperlink"))
            for child in n["children"]:
                generated = self.inline(child)
                out.extend(generated if isinstance(generated, list) else [generated])
            return out
        if kind == "field" and n.get("xml_parts"):
            return [parse_xml(v.encode()) for v in n["xml_parts"]]
        if kind in {"field", "opaque-ooxml"}:
            raw = parse_xml(n["xml"].encode())
            if raw.tag in {
                w(t) for t in ("r", "fldSimple", "bookmarkStart", "bookmarkEnd")
            }:
                return raw
            out = element("r")
            out.append(raw)
            return out
        out = element("r")
        if kind == "text":
            out.append(text_properties(n.get("style", {}), n.get("raw_properties")))
            t = element("t")
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            t.text = n["text"]
            out.append(t)
        elif kind == "image" and n.get("xml"):
            out.append(parse_xml(n["xml"].encode()))
        elif kind == "tab":
            out.append(element("tab"))
        elif kind == "break":
            out.append(
                element(
                    "br",
                    {
                        "type": (
                            "textWrapping"
                            if n.get("break_type") == "line"
                            else n.get("break_type", "textWrapping")
                        )
                    },
                )
            )
        elif kind == "note-reference":
            out.append(
                element(
                    (
                        "footnoteReference"
                        if n["note_kind"] == "footnotes"
                        else "endnoteReference"
                    ),
                    {"id": n["note_id"]},
                )
            )
        return out

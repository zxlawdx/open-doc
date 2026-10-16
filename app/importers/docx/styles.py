"""Word style inheritance and direct run/paragraph properties."""

from app.importers.docx.namespaces import NS, w, attr, twips_to_pt, half_points_to_pt


def text_properties(root, theme=None):
    if root is None:
        return {}
    out = {}
    for tag, key in [
        ("b", "bold"),
        ("i", "italic"),
        ("strike", "strike"),
        ("dstrike", "strike"),
        ("smallCaps", "small_caps"),
        ("caps", "all_caps"),
    ]:
        e = root.find(w(tag))
        if e is not None:
            out[key] = attr(e, default="true") not in {"0", "false", "off"}
    for tag, key in [
        ("u", "underline"),
        ("color", "color"),
        ("highlight", "highlight"),
        ("vertAlign", "vertical_align"),
        ("lang", "language"),
    ]:
        v = attr(root.find(w(tag)))
        if v is not None:
            out[key] = v
    for tag, key, convert in [
        ("sz", "font_size_pt", half_points_to_pt),
        ("spacing", "character_spacing_pt", twips_to_pt),
    ]:
        v = attr(root.find(w(tag)))
        if v is not None:
            out[key] = convert(v)
    font = root.find(w("rFonts"))
    if font is not None:
        family = next(
            (
                attr(font, k)
                for k in ("ascii", "hAnsi", "eastAsia", "cs")
                if attr(font, k)
            ),
            None,
        )
        family = family or (theme or {}).get(
            attr(font, "asciiTheme") or attr(font, "hAnsiTheme")
        )
        if family:
            out["font_family"] = family
    c = root.find(w("color"))
    theme_color = attr(c, "themeColor")
    if theme_color and (theme or {}).get(theme_color):
        out["color"] = theme[theme_color]
    return out


def paragraph_properties(root):
    if root is None:
        return {}
    out = {}
    for tag, key in [("pStyle", "style_id"), ("jc", "alignment")]:
        v = attr(root.find(w(tag)))
        if v is not None:
            out[key] = {"both": "justify", "start": "left", "end": "right"}.get(v, v)
    for tag, key in [
        ("keepNext", "keep_next"),
        ("keepLines", "keep_lines"),
        ("pageBreakBefore", "page_break_before"),
        ("widowControl", "widow_control"),
    ]:
        e = root.find(w(tag))
        if e is not None:
            out[key] = attr(e, default="true") not in {"0", "false", "off"}
    spacing = root.find(w("spacing"))
    for a, k in [("before", "space_before_pt"), ("after", "space_after_pt")]:
        if attr(spacing, a) is not None:
            out[k] = twips_to_pt(attr(spacing, a))
    if attr(spacing, "line") is not None:
        rule = attr(spacing, "lineRule", "auto")
        out.update(
            line_spacing=int(attr(spacing, "line")) / (240 if rule == "auto" else 20),
            line_spacing_rule=rule,
        )
    ind = root.find(w("ind"))
    for a, k in [
        ("left", "left_indent_pt"),
        ("right", "right_indent_pt"),
        ("firstLine", "first_line_indent_pt"),
        ("hanging", "hanging_indent_pt"),
    ]:
        if attr(ind, a) is not None:
            out[k] = twips_to_pt(attr(ind, a))
    if attr(root.find(w("outlineLvl"))) is not None:
        out["outline_level"] = int(attr(root.find(w("outlineLvl"))))
    tabs = root.find(w("tabs"))
    if tabs is not None:
        out["tabs"] = [
            {
                "position_pt": twips_to_pt(attr(t, "pos")),
                "alignment": attr(t),
                "leader": attr(t, "leader"),
            }
            for t in tabs
        ]
    return out


class StyleResolver:
    def __init__(self, package):
        self.theme = {}
        self.catalog = {}
        self.elements = {}
        theme = package.xml("word/theme/theme1.xml")
        if theme is not None:
            for kind in ("major", "minor"):
                for script, suffix in [
                    ("latin", "Ascii"),
                    ("latin", "HAnsi"),
                    ("ea", "EastAsia"),
                    ("cs", "Bidi"),
                ]:
                    e = theme.find(".//a:" + kind + "Font/a:" + script, NS)
                    if e is not None:
                        self.theme[kind + suffix] = e.get("typeface")
            colors = theme.find(".//a:clrScheme", NS)
            if colors is not None:
                for c in colors:
                    if len(c):
                        self.theme[c.tag.split("}")[-1]] = c[0].get("lastClr") or c[
                            0
                        ].get("val")
            for key, value in [
                ("text1", "dk1"),
                ("text2", "dk2"),
                ("background1", "lt1"),
                ("background2", "lt2"),
            ]:
                self.theme[key] = self.theme.get(value)
        root = package.xml("word/styles.xml")
        self.default_run = (
            text_properties(
                root.find("w:docDefaults/w:rPrDefault/w:rPr", NS), self.theme
            )
            if root is not None
            else {}
        )
        self.default_paragraph = (
            paragraph_properties(root.find("w:docDefaults/w:pPrDefault/w:pPr", NS))
            if root is not None
            else {}
        )
        if root is not None:
            for e in root.findall(w("style")):
                sid = attr(e, "styleId")
                self.elements[sid] = e
                self.catalog[sid] = {
                    "name": attr(e.find(w("name"))),
                    "based_on": attr(e.find(w("basedOn"))),
                    "next": attr(e.find(w("next"))),
                    "link": attr(e.find(w("link"))),
                    "type": attr(e, "type"),
                    "paragraph": paragraph_properties(e.find(w("pPr"))),
                    "run": text_properties(e.find(w("rPr")), self.theme),
                }

    def chain(self, sid, seen=None):
        seen = set() if seen is None else seen
        if sid in seen or sid not in self.catalog:
            return []
        seen.add(sid)
        entry = self.catalog[sid]
        return self.chain(entry["based_on"], seen) + [entry]

    def resolve_paragraph(self, sid, direct):
        out = dict(self.default_paragraph)
        for entry in self.chain(sid or "Normal"):
            out.update(entry["paragraph"])
        out.update(direct)
        return out

    def resolve_run(self, psid, rsid, direct):
        out = dict(self.default_run)
        for entry in self.chain(psid or "Normal") + self.chain(rsid):
            out.update(entry["run"])
        out.update(direct)
        return out

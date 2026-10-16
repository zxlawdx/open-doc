"""Resolve numbering definitions and start overrides by level."""

from app.importers.docx.namespaces import w, attr


def numbering_catalog(package):
    root = package.xml("word/numbering.xml")
    abstracts = {}
    out = {}
    if root is None:
        return out
    for e in root.findall(w("abstractNum")):
        abstracts[attr(e, "abstractNumId")] = {
            attr(l, "ilvl"): {
                "format": attr(l.find(w("numFmt"))),
                "text_pattern": attr(l.find(w("lvlText"))),
                "start": int(attr(l.find(w("start")), default="1")),
                "suffix": attr(l.find(w("suff"))),
            }
            for l in e.findall(w("lvl"))
        }
    for e in root.findall(w("num")):
        aid = attr(e.find(w("abstractNumId")))
        levels = {k: dict(v) for k, v in abstracts.get(aid, {}).items()}
        for override in e.findall(w("lvlOverride")):
            start = attr(override.find(w("startOverride")))
            if start:
                levels.setdefault(attr(override, "ilvl"), {})["start"] = int(start)
        out[attr(e, "numId")] = {"abstract_num_id": aid, "levels": levels}
    return out

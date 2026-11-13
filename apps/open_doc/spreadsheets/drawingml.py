"""Native DrawingML worksheet shapes omitted by openpyxl's chart/image writer."""

from __future__ import annotations

import posixpath
import shutil
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from defusedxml.ElementTree import fromstring
from lxml import etree as ET

S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
D = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P = "http://schemas.openxmlformats.org/package/2006/relationships"
C = "http://schemas.openxmlformats.org/package/2006/content-types"
X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
XM = "http://schemas.microsoft.com/office/excel/2006/main"
PRESETS = {
    "rect": "rect",
    "ellipse": "ellipse",
    "triangle": "triangle",
    "diamond": "diamond",
    "line": "line",
    "arrow": "rightArrow",
    "text": "rect",
}


def element(parent, namespace, tag, **attributes):
    return ET.SubElement(
        parent, "{" + namespace + "}" + tag, {k: str(v) for k, v in attributes.items()}
    )


def part_path(base, target):
    path = (
        target.lstrip("/")
        if target.startswith("/")
        else posixpath.normpath(posixpath.join(posixpath.dirname(base), target))
    )
    if not path.startswith("xl/") or ".." in path.split("/"):
        raise ValueError("Referência DrawingML fora da pasta XLSX.")
    return path


def sheet_parts(archive):
    relationships = fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    paths = {
        r.get("Id"): part_path("xl/workbook.xml", r.get("Target"))
        for r in relationships
        if r.get("Type", "").endswith("/worksheet")
        and r.get("TargetMode") != "External"
    }
    workbook = fromstring(archive.read("xl/workbook.xml"))
    return [
        paths[node.get("{" + R + "}id")]
        for node in workbook.findall("{" + S + "}sheets/{" + S + "}sheet")
    ]


def drawing_part(archive, sheet_path, sheet):
    node = sheet.find("{" + S + "}drawing")
    if node is None:
        return None
    rel_path = posixpath.join(
        posixpath.dirname(sheet_path), "_rels", posixpath.basename(sheet_path) + ".rels"
    )
    rels = fromstring(archive.read(rel_path))
    for rel in rels:
        if (
            rel.get("Id") == node.get("{" + R + "}id")
            and rel.get("TargetMode") != "External"
        ):
            return part_path(sheet_path, rel.get("Target"))
    return None


def write_shapes(path, sheets):
    if not any(
        any(obj["type"] == "shape" for obj in sheet.get("objects", []))
        or any("sparkline" in tool for tool in sheet.get("cell_tools", {}).values())
        for sheet in sheets
    ):
        return
    path = Path(path)
    updates = {}
    with ZipFile(path) as archive:
        parts = sheet_parts(archive)
        content_types = ET.fromstring(archive.read("[Content_Types].xml"))
        for source, sheet_path in zip(sheets, parts):
            shapes = [
                obj for obj in source.get("objects", []) if obj["type"] == "shape"
            ]
            sheet = ET.fromstring(archive.read(sheet_path))
            spark = [
                (key, tool["sparkline"])
                for key, tool in source.get("cell_tools", {}).items()
                if "sparkline" in tool
            ]
            if spark:
                from openpyxl.utils.cell import get_column_letter

                ext_list = sheet.find("{" + S + "}extLst")
                if ext_list is None:
                    ext_list = element(sheet, S, "extLst")
                ext = element(
                    ext_list, S, "ext", uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}"
                )
                groups = element(ext, X14, "sparklineGroups")
                for key, config in spark:
                    group = element(
                        groups,
                        X14,
                        "sparklineGroup",
                        displayEmptyCellsAs="gap",
                        type={"line": "line", "column": "column", "winloss": "stacked"}[
                            config["kind"]
                        ],
                    )
                    element(group, X14, "colorSeries", rgb="FF1A73E8")
                    element(group, X14, "colorNegative", rgb="FFDB4437")
                    entry = element(element(group, X14, "sparklines"), X14, "sparkline")
                    r0, c0, r1, c1 = config["range"]
                    title = "'" + source["name"].replace("'", "''") + "'"
                    element(entry, XM, "f").text = (
                        f"{title}!{get_column_letter(c0+1)}{r0+1}:{get_column_letter(c1+1)}{r1+1}"
                    )
                    row, col = map(int, key.split(","))
                    element(entry, XM, "sqref").text = (
                        f"{get_column_letter(col+1)}{row+1}"
                    )
                updates[sheet_path] = ET.tostring(sheet)
            if not shapes:
                continue
            drawing_path = drawing_part(archive, sheet_path, sheet)
            if drawing_path:
                drawing = ET.fromstring(archive.read(drawing_path))
            else:
                index = 1
                while (
                    f"xl/drawings/drawing{index}.xml" in archive.namelist()
                    or f"xl/drawings/drawing{index}.xml" in updates
                ):
                    index += 1
                drawing_path = f"xl/drawings/drawing{index}.xml"
                drawing = ET.Element("{" + D + "}wsDr", nsmap={None: D, "a": A})
                rel_path = posixpath.join(
                    posixpath.dirname(sheet_path),
                    "_rels",
                    posixpath.basename(sheet_path) + ".rels",
                )
                rels = (
                    ET.fromstring(archive.read(rel_path))
                    if rel_path in archive.namelist()
                    else ET.Element("{" + P + "}Relationships", nsmap={None: P})
                )
                rid = "rIdOpenDocDrawing"
                while any(node.get("Id") == rid for node in rels):
                    rid += "x"
                element(
                    rels,
                    P,
                    "Relationship",
                    Id=rid,
                    Type=R + "/drawing",
                    Target="/" + drawing_path,
                )
                element(sheet, S, "drawing", **{"{" + R + "}id": rid})
                created = sheet.find("{" + S + "}drawing")
                following = {
                    "legacyDrawing",
                    "legacyDrawingHF",
                    "picture",
                    "oleObjects",
                    "controls",
                    "webPublishItems",
                    "tableParts",
                    "extLst",
                }
                for child in list(sheet):
                    if ET.QName(child).localname in following:
                        sheet.remove(created)
                        sheet.insert(list(sheet).index(child), created)
                        break
                updates[rel_path] = ET.tostring(rels)
                updates[sheet_path] = ET.tostring(sheet)
                element(
                    content_types,
                    C,
                    "Override",
                    PartName="/" + drawing_path,
                    ContentType="application/vnd.openxmlformats-officedocument.drawing+xml",
                )
            next_id = (
                max(
                    (
                        int(n.get("id", 0))
                        for n in drawing.findall(".//{" + D + "}cNvPr")
                    ),
                    default=0,
                )
                + 1
            )
            for obj in shapes:
                anchor = element(drawing, D, "oneCellAnchor")
                start = element(anchor, D, "from")
                col, x = divmod(obj["x"], 112)
                row, y = divmod(obj["y"], 28)
                for key, value in (
                    ("col", int(col)),
                    ("colOff", round(x * 9525)),
                    ("row", int(row)),
                    ("rowOff", round(y * 9525)),
                ):
                    element(start, D, key).text = str(value)
                element(
                    anchor,
                    D,
                    "ext",
                    cx=round(obj["width"] * 9525),
                    cy=round(obj["height"] * 9525),
                )
                shape = element(anchor, D, "sp")
                nv = element(shape, D, "nvSpPr")
                element(nv, D, "cNvPr", id=next_id, name=obj["name"])
                element(
                    nv, D, "cNvSpPr", txBox="1" if obj["shape_kind"] == "text" else "0"
                )
                next_id += 1
                props = element(shape, D, "spPr")
                transform = element(props, A, "xfrm")
                element(transform, A, "off", x=0, y=0)
                element(
                    transform,
                    A,
                    "ext",
                    cx=round(obj["width"] * 9525),
                    cy=round(obj["height"] * 9525),
                )
                geometry = element(
                    props, A, "prstGeom", prst=PRESETS[obj["shape_kind"]]
                )
                element(geometry, A, "avLst")
                if obj["shape_kind"] == "text":
                    element(props, A, "noFill")
                else:
                    element(
                        element(props, A, "solidFill"),
                        A,
                        "srgbClr",
                        val=obj["fill"][1:],
                    )
                line = element(props, A, "ln", w=12700)
                if obj["shape_kind"] == "text":
                    element(line, A, "noFill")
                else:
                    element(
                        element(line, A, "solidFill"),
                        A,
                        "srgbClr",
                        val=obj["color"][1:],
                    )
                body = element(shape, D, "txBody")
                element(body, A, "bodyPr", wrap="square", anchor="ctr")
                element(body, A, "lstStyle")
                for text in obj["text"].split("\n"):
                    paragraph = element(body, A, "p")
                    element(paragraph, A, "pPr", algn="ctr")
                    run = element(paragraph, A, "r")
                    font = element(run, A, "rPr", sz=1200, lang="pt-BR")
                    element(
                        element(font, A, "solidFill"),
                        A,
                        "srgbClr",
                        val=obj["color"][1:],
                    )
                    element(run, A, "t").text = text
                element(anchor, D, "clientData")
            updates[drawing_path] = ET.tostring(drawing)
        updates["[Content_Types].xml"] = ET.tostring(content_types)
        with NamedTemporaryFile(
            dir=path.parent, suffix=".xlsx", delete=False
        ) as handle:
            temporary = Path(handle.name)
        try:
            with ZipFile(temporary, "w", ZIP_DEFLATED) as output:
                for info in archive.infolist():
                    if info.filename in updates:
                        continue
                    with archive.open(info) as original, output.open(
                        info, "w"
                    ) as destination:
                        shutil.copyfileobj(original, destination, 1024 * 1024)
                for name, payload in updates.items():
                    output.writestr(name, payload)
            # Windows cannot replace a ZIP while its input handle is open.
            archive.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def read_shapes(path, sheets):
    with ZipFile(path) as archive:
        for target, sheet_path in zip(sheets, sheet_parts(archive)):
            sheet = fromstring(archive.read(sheet_path))
            from openpyxl.utils.cell import range_boundaries

            for group in sheet.findall(".//{" + X14 + "}sparklineGroup"):
                for entry in group.findall(
                    "{" + X14 + "}sparklines/{" + X14 + "}sparkline"
                ):
                    formula = entry.findtext("{" + XM + "}f", "")
                    reference = entry.findtext("{" + XM + "}sqref", "")
                    name, _, area = formula.rpartition("!")
                    name = name.strip("'").replace("''", "'")
                    if name != target["name"]:
                        raise ValueError(
                            "Minigráfico com fonte externa à aba ainda incompatível."
                        )
                    left, top, right, bottom = range_boundaries(area)
                    col, row, _, _ = range_boundaries(reference)
                    kind = {
                        "line": "line",
                        "column": "column",
                        "stacked": "winloss",
                    }.get(group.get("type", "line"))
                    target.setdefault("cell_tools", {}).setdefault(
                        f"{row-1},{col-1}", {}
                    )["sparkline"] = {
                        "kind": kind,
                        "range": [top - 1, left - 1, bottom - 1, right - 1],
                    }
            part = drawing_part(archive, sheet_path, sheet)
            if not part:
                continue
            drawing = fromstring(archive.read(part))
            for anchor in drawing:
                shape = anchor.find("{" + D + "}sp")
                if shape is None:
                    continue
                start = anchor.find("{" + D + "}from")
                extent = anchor.find("{" + D + "}ext")
                if start is None or extent is None:
                    raise ValueError(
                        "A forma importada usa uma ancoragem ainda incompatível."
                    )
                meta = shape.find("{" + D + "}nvSpPr/{" + D + "}cNvPr")
                special = shape.find("{" + D + "}nvSpPr/{" + D + "}cNvSpPr")
                geometry = shape.find("{" + D + "}spPr/{" + A + "}prstGeom")
                preset = geometry.get("prst") if geometry is not None else None
                kind = next(
                    (
                        key
                        for key, value in PRESETS.items()
                        if key != "text" and value == preset
                    ),
                    None,
                )
                if special is not None and special.get("txBox") == "1":
                    kind = "text"
                if kind is None:
                    raise ValueError(
                        "O arquivo contém uma forma ainda incompatível com a edição."
                    )

                def value(name):
                    return int(start.findtext("{" + D + "}" + name, "0"))

                def color(field, default):
                    node = shape.find(
                        "{" + D + "}spPr/{" + A + "}" + field + "/{" + A + "}srgbClr"
                    )
                    return "#" + node.get("val") if node is not None else default

                texts = [
                    "".join(p.itertext())
                    for p in shape.findall("{" + D + "}txBody/{" + A + "}p")
                ]
                ink = shape.find(
                    "{"
                    + D
                    + "}spPr/{"
                    + A
                    + "}ln/{"
                    + A
                    + "}solidFill/{"
                    + A
                    + "}srgbClr"
                )
                if ink is None:
                    ink = shape.find(
                        ".//{" + A + "}rPr/{" + A + "}solidFill/{" + A + "}srgbClr"
                    )
                obj = {
                    "id": uuid4().hex,
                    "type": "shape",
                    "name": meta.get("name", "Forma") if meta is not None else "Forma",
                    "shape_kind": kind,
                    "text": "\n".join(texts),
                    "fill": color("solidFill", "#E8F0FE"),
                    "color": "#" + ink.get("val") if ink is not None else "#174EA6",
                    "x": value("col") * 112 + value("colOff") / 9525,
                    "y": value("row") * 28 + value("rowOff") / 9525,
                    "width": int(extent.get("cx")) / 9525,
                    "height": int(extent.get("cy")) / 9525,
                }
                target.setdefault("objects", []).append(obj)

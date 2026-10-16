"""OOXML model importer with opaque XML and immutable source package snapshot."""

import hashlib
import io
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from lxml import etree
from PIL import Image
from apps.open_doc.document_model.schema import RichDocument
from apps.open_doc.document_model.validate import (
    validate_rich_document,
    MAX_OPAQUE_BYTES,
)
from apps.open_doc.parsers.docx.package import DocxPackage
from apps.open_doc.parsers.docx.namespaces import NS, R, w, attr, twips_to_pt, emu_to_pt
from apps.open_doc.parsers.docx.relationships import relationships
from apps.open_doc.parsers.docx.styles import (
    StyleResolver,
    paragraph_properties,
    text_properties,
)
from apps.open_doc.parsers.docx.numbering import numbering_catalog


def node(kind, **values):
    return {"id": str(uuid4()), "type": kind, **values}


def xml(e):
    return etree.tostring(e, encoding="unicode")


def borders(parent, tag):
    root = parent.find(w(tag)) if parent is not None else None
    return (
        {
            c.tag.split("}")[-1]: {
                "style": attr(c),
                "color": attr(c, "color"),
                "size_pt": int(attr(c, "sz", "0")) / 8,
                "space_pt": int(attr(c, "space", "0")),
            }
            for c in root
        }
        if root is not None
        else {}
    )


class DocxImporter:
    def import_file(self, source, *, document_id, package_directory):
        self.package = DocxPackage.open(source)
        self.directory = Path(package_directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.styles = StyleResolver(self.package)
        self.numbering = numbering_catalog(self.package)
        self.model = RichDocument().to_dict()
        self.warnings = [
            "DEGRADED_WITH_WARNING: layout aproximado; paginação, campos e seções múltiplas não reproduzem integralmente o Word."
        ]
        self.model.update(
            styles=self.styles.catalog,
            numbering=self.numbering,
            preserved_parts=sorted(self.package.parts),
        )
        body = self.package.xml("word/document.xml").find(w("body"))
        if body is None:
            raise ValueError("DOCX sem corpo.")
        self.model["blocks"] = self.blocks(body, "word/document.xml")
        self.model["sections"] = [self.section(e) for e in body.iter(w("sectPr"))]
        section_index = 0
        for block in self.model["blocks"]:
            raw = block.get("raw_xml", "")
            if block.get("type") == "paragraph" and "sectPr" in raw:
                block["section_end_id"] = self.model["sections"][section_index]["id"]
                section_index += 1
        for kind in ("headers", "footers", "footnotes", "endnotes", "comments"):
            prefix = {"headers": "header", "footers": "footer"}.get(kind, kind)
            for part in self.package.parts:
                if re.fullmatch("word/" + prefix + r"\d*\.xml", part):
                    root = self.package.xml(part)
                    if kind in {"headers", "footers"}:
                        self.model[kind][part] = self.blocks(root, part)
                    else:
                        for e in root:
                            self.model[kind][str(attr(e, "id"))] = self.blocks(e, part)
        fonts = self.package.xml("word/fontTable.xml")
        self.model["metadata"] = {
            "document_id": document_id,
            "source_sha256": hashlib.sha256(Path(source).read_bytes()).hexdigest(),
            "warnings": self.warnings,
            "fidelity": "DEGRADED_WITH_WARNING",
            "fonts": [attr(f, "name") for f in fonts] if fonts is not None else [],
        }
        validate_rich_document(self.model)
        shutil.copyfile(source, self.directory / "original.docx")
        (self.directory / "manifest.json").write_text(
            json.dumps(
                {
                    "format": "docx",
                    "source_sha256": self.model["metadata"]["source_sha256"],
                    "imported_at": datetime.now(timezone.utc).isoformat(),
                    "model_version": self.model["version"],
                    "preserve_unknown_parts": True,
                }
            ),
            encoding="utf-8",
        )
        return self.model

    def opaque(self, e, part, position="inline"):
        raw = xml(e)
        if len(raw.encode()) > MAX_OPAQUE_BYTES:
            raise ValueError("Elemento OOXML muito grande para preservação segura.")
        self.warnings.append("PRESERVED_OPAQUE: " + e.tag.split("}")[-1])
        return node(
            "opaque-ooxml",
            xml=raw,
            part=part,
            position=position,
            display="".join(e.itertext())[:200],
        )

    def blocks(self, parent, part):
        out = []
        for e in parent:
            if e.tag == w("p"):
                out.append(self.paragraph(e, part))
            elif e.tag == w("tbl"):
                out.append(self.table(e, part))
            elif e.tag not in {
                w(t) for t in ("sectPr", "tcPr", "tblPr", "tblGrid", "trPr")
            }:
                out.append(self.opaque(e, part, "block"))
        return out

    def paragraph(self, e, part):
        direct = paragraph_properties(e.find(w("pPr")))
        sid = direct.get("style_id")
        style = self.styles.resolve_paragraph(sid, direct)
        out = node("paragraph", style=style, children=[], raw_xml=xml(e))
        num = e.find("w:pPr/w:numPr", NS)
        if num is None:
            for entry in reversed(self.styles.chain(sid)):
                candidate = self.styles.elements.get(
                    next((k for k, v in self.styles.catalog.items() if v is entry), "")
                )
                if candidate is not None:
                    num = candidate.find("w:pPr/w:numPr", NS)
                    if num is not None:
                        break
        if num is not None:
            nid = attr(num.find(w("numId")))
            level = int(attr(num.find(w("ilvl")), default="0"))
            spec = self.numbering.get(nid, {})
            out["list_info"] = {
                "num_id": nid,
                "abstract_num_id": spec.get("abstract_num_id"),
                "level": level,
                **spec.get("levels", {}).get(str(level), {}),
            }
        children = list(e)
        cursor = 0
        while cursor < len(children):
            child = children[cursor]
            cursor += 1
            if child.tag == w("pPr"):
                continue
            if (
                child.tag == w("r")
                and child.find("w:fldChar[@w:fldCharType='begin']", NS) is not None
            ):
                group = [child]
                depth = 1
                while cursor < len(children) and depth:
                    entry = children[cursor]
                    cursor += 1
                    group.append(entry)
                    depth += len(
                        entry.findall("w:fldChar[@w:fldCharType='begin']", NS)
                    ) - len(entry.findall("w:fldChar[@w:fldCharType='end']", NS))
                out["children"].append(
                    node(
                        "field",
                        instruction="".join(
                            t.text or "" for r in group for t in r.iter(w("instrText"))
                        ),
                        display="".join(
                            t.text or "" for r in group for t in r.iter(w("t"))
                        ),
                        xml_parts=[xml(r) for r in group],
                    )
                )
                self.warnings.append("PRESERVED_OPAQUE: campo complexo não recalculado")
                continue
            if child.tag == w("r"):
                out["children"].extend(self.run(child, part, sid))
            elif child.tag == w("hyperlink"):
                rel = relationships(self.package, part).get(
                    child.get("{" + R + "}id"), {}
                )
                href = (
                    rel.get("target")
                    if rel.get("external")
                    else "#" + attr(child, "anchor", "")
                )
                if not href or not re.match(r"^(https?://|mailto:|#)", href, re.I):
                    out["children"].append(self.opaque(child, part))
                    continue
                runs = []
                for run in child.findall(w("r")):
                    runs.extend(self.run(run, part, sid))
                out["children"].append(
                    node("hyperlink", href=href, children=runs, raw_xml=xml(child))
                )
            elif child.tag == w("fldSimple"):
                out["children"].append(
                    node(
                        "field",
                        instruction=attr(child, "instr", ""),
                        display="".join(child.itertext()),
                        xml=xml(child),
                    )
                )
                self.warnings.append("PRESERVED_OPAQUE: campo não recalculado")
            else:
                out["children"].append(self.opaque(child, part))
        return out

    def run(self, e, part, sid):
        prop = e.find(w("rPr"))
        rsid = attr(prop.find(w("rStyle"))) if prop is not None else None
        style = self.styles.resolve_run(
            sid, rsid, text_properties(prop, self.styles.theme)
        )
        out = []
        for c in e:
            if c.tag == w("rPr"):
                continue
            if c.tag == w("t"):
                out.append(
                    node(
                        "text",
                        text=c.text or "",
                        style=style,
                        raw_properties=xml(prop) if prop is not None else None,
                    )
                )
            elif c.tag in {w("br"), w("cr")}:
                out.append(node("break", break_type=attr(c, "type", "line")))
            elif c.tag == w("tab"):
                out.append(node("tab"))
            elif c.tag in {w("footnoteReference"), w("endnoteReference")}:
                out.append(
                    node(
                        "note-reference",
                        note_kind=(
                            "footnotes"
                            if c.tag == w("footnoteReference")
                            else "endnotes"
                        ),
                        note_id=attr(c, "id"),
                    )
                )
            elif c.tag == w("drawing"):
                blip = c.find(".//a:blip", NS)
                rid = blip.get("{" + R + "}embed") if blip is not None else None
                rel = relationships(self.package, part).get(rid, {})
                if rel.get("external") or rel.get("target") not in self.package.parts:
                    out.append(self.opaque(c, part))
                    continue
                data = self.package.parts[rel["target"]]
                mid = hashlib.sha256(data).hexdigest()
                try:
                    with Image.open(io.BytesIO(data)) as image:
                        if (
                            image.width * image.height > 40000000
                            or image.format not in {"PNG", "JPEG", "GIF", "WEBP"}
                        ):
                            raise ValueError("Imagem não suportada.")
                        image.verify()
                except Exception:
                    out.append(self.opaque(c, part))
                    continue
                media = self.directory / "media"
                media.mkdir(exist_ok=True)
                (media / mid).write_bytes(data)
                self.model["media"][mid] = {"part": rel["target"], "size": len(data)}
                extent = c.find(".//wp:extent", NS)
                desc = c.find(".//wp:docPr", NS)
                floating = c.find(".//wp:anchor", NS) is not None
                out.append(
                    node(
                        "image",
                        media_id=mid,
                        width_pt=(
                            emu_to_pt(extent.get("cx")) if extent is not None else None
                        ),
                        height_pt=(
                            emu_to_pt(extent.get("cy")) if extent is not None else None
                        ),
                        alt_text=desc.get("descr", "") if desc is not None else "",
                        placement="floating" if floating else "inline",
                        xml=xml(c),
                    )
                )
                if floating:
                    self.warnings.append(
                        "DEGRADED_WITH_WARNING: imagem flutuante aproximada inline"
                    )
            else:
                out.append(self.opaque(c, part))
        return out

    def table(self, e, part):
        prop = e.find(w("tblPr"))
        out = node(
            "table",
            rows=[],
            raw_xml=xml(e),
            column_widths_pt=[
                twips_to_pt(attr(c, "w")) for c in e.findall("w:tblGrid/w:gridCol", NS)
            ],
            borders=borders(prop, "tblBorders"),
        )
        if prop is not None:
            out.update(
                style_id=attr(prop.find(w("tblStyle"))),
                layout=attr(prop.find(w("tblLayout")), "type"),
                alignment=attr(prop.find(w("jc"))),
            )
        active = {}
        for row in e.findall(w("tr")):
            rp = row.find(w("trPr"))
            result = {
                "id": str(uuid4()),
                "cells": [],
                "raw_properties": xml(rp) if rp is not None else None,
            }
            if rp is not None:
                result.update(
                    height_pt=twips_to_pt(attr(rp.find(w("trHeight")))),
                    cant_split=rp.find(w("cantSplit")) is not None,
                    is_header=rp.find(w("tblHeader")) is not None,
                )
            column = 0
            for cell in row.findall(w("tc")):
                cp = cell.find(w("tcPr"))
                span = (
                    int(attr(cp.find(w("gridSpan")), default="1"))
                    if cp is not None
                    else 1
                )
                vm = cp.find(w("vMerge")) if cp is not None else None
                cont = vm is not None and attr(vm, default="continue") != "restart"
                item = {
                    "id": str(uuid4()),
                    "blocks": self.blocks(cell, part),
                    "col_span": span,
                    "row_span": 1,
                    "merge_continue": cont,
                    "raw_properties": xml(cp) if cp is not None else None,
                    "borders": borders(cp, "tcBorders"),
                }
                if cp is not None:
                    item.update(
                        shading=attr(cp.find(w("shd")), "fill"),
                        vertical_align=attr(cp.find(w("vAlign"))),
                        width_pt=(
                            twips_to_pt(attr(cp.find(w("tcW")), "w"))
                            if attr(cp.find(w("tcW")), "type", "dxa") == "dxa"
                            else None
                        ),
                    )
                if cont and column in active:
                    active[column]["row_span"] += 1
                elif vm is not None:
                    active[column] = item
                else:
                    active.pop(column, None)
                result["cells"].append(item)
                column += span
            out["rows"].append(result)
        return out

    def section(self, e):
        size = e.find(w("pgSz"))
        mar = e.find(w("pgMar"))
        out = {
            "id": str(uuid4()),
            "raw_xml": xml(e),
            "page_width_pt": twips_to_pt(attr(size, "w", "11906")),
            "page_height_pt": twips_to_pt(attr(size, "h", "16838")),
            "orientation": attr(size, "orient", "portrait"),
            "columns": int(attr(e.find(w("cols")), "num", "1")),
        }
        for side in ("top", "right", "bottom", "left"):
            out["margin_" + side + "_pt"] = twips_to_pt(attr(mar, side, "1440"))
        out.update(
            header_distance_pt=twips_to_pt(attr(mar, "header")),
            footer_distance_pt=twips_to_pt(attr(mar, "footer")),
            header_ids=[
                c.get("{" + R + "}id") for c in e.findall(w("headerReference"))
            ],
            footer_ids=[
                c.get("{" + R + "}id") for c in e.findall(w("footerReference"))
            ],
        )
        return out

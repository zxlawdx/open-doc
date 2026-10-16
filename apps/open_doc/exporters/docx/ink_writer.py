"""Add our own page-relative DrawingML without re-saving the source package."""

from hashlib import sha256
from io import BytesIO
from lxml import etree
from ...ink.raster import render_layer
from ...parsers.docx.namespaces import w

NS = {
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def apply_ink(writer, body, model, nodes):
    for layer in model.get("ink_layers", []):
        if not layer.get("strokes"):
            continue
        width, height = layer.get("width_pt", 595.28), layer.get("height_pt", 841.89)
        image = render_layer(
            layer["strokes"],
            width=min(5000, round(width * 2)),
            height=min(5000, round(height * 2)),
        )
        stream = BytesIO()
        image.save(stream, format="PNG")
        data = stream.getvalue()
        name = "opendoc-ink-" + sha256(data).hexdigest() + ".png"
        writer.parts["word/media/" + name] = data
        rid = writer.relationship("media/" + name, "image", False)
        ct = etree.fromstring(writer.parts["[Content_Types].xml"])
        if not any(e.get("Extension") == "png" for e in ct):
            etree.SubElement(
                ct,
                "{http://schemas.openxmlformats.org/package/2006/content-types}Default",
                Extension="png",
                ContentType="image/png",
            )
        writer.parts["[Content_Types].xml"] = etree.tostring(
            ct, encoding="UTF-8", xml_declaration=True
        )
        anchor_node = nodes.get(layer.get("anchor_block_id"))
        if anchor_node is None:
            anchor_node = next(iter(body.iter(w("p"))), None)
        if anchor_node is None:
            anchor_node = etree.SubElement(body, w("p"))
        if anchor_node.tag != w("p"):
            anchor_node = next(iter(anchor_node.iter(w("p"))), anchor_node)
        run = etree.SubElement(anchor_node, w("r"))
        drawing = etree.SubElement(run, w("drawing"))

        def add(parent, prefix, tag, **attrs):
            return etree.SubElement(
                parent,
                "{" + NS[prefix] + "}" + tag,
                **{k: str(v) for k, v in attrs.items()}
            )

        cx, cy = round(width * 12700), round(height * 12700)
        anchor = add(
            drawing,
            "wp",
            "anchor",
            distT=0,
            distB=0,
            distL=0,
            distR=0,
            simplePos=0,
            relativeHeight=251658240,
            behindDoc=0,
            locked=0,
            layoutInCell=1,
            allowOverlap=1,
        )
        add(anchor, "wp", "simplePos", x=0, y=0)
        for axis in ["H", "V"]:
            position = add(anchor, "wp", "position" + axis, relativeFrom="page")
            add(position, "wp", "posOffset").text = "0"
        add(anchor, "wp", "extent", cx=cx, cy=cy)
        add(anchor, "wp", "wrapNone")
        docid = 1 + max(
            [0] + [int(e.get("id", "0")) for e in body.iter("{" + NS["wp"] + "}docPr")]
        )
        add(
            anchor,
            "wp",
            "docPr",
            id=docid,
            name="Open Doc Ink " + str(layer["surface_index"]),
        )
        graphic = add(anchor, "a", "graphic")
        gd = add(graphic, "a", "graphicData", uri=NS["pic"])
        pic = add(gd, "pic", "pic")
        nv = add(pic, "pic", "nvPicPr")
        add(nv, "pic", "cNvPr", id=0, name=name)
        add(nv, "pic", "cNvPicPr")
        fill = add(pic, "pic", "blipFill")
        blip = add(fill, "a", "blip")
        blip.set("{" + NS["r"] + "}embed", rid)
        stretch = add(fill, "a", "stretch")
        add(stretch, "a", "fillRect")
        shape = add(pic, "pic", "spPr")
        transform = add(shape, "a", "xfrm")
        add(transform, "a", "off", x=0, y=0)
        add(transform, "a", "ext", cx=cx, cy=cy)
        geom = add(shape, "a", "prstGeom", prst="rect")
        add(geom, "a", "avLst")

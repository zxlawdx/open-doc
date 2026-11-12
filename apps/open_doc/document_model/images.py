"""Bounded local image assets and native DrawingML geometry."""

import base64
import binascii
import hashlib
import io
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError
from lxml import etree

MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
NS = {
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def prepare_image(data_url):
    if not isinstance(data_url, str) or len(data_url) > MAX_IMAGE_BYTES * 4 // 3 + 128:
        raise ValueError("A imagem deve ter no máximo 4 MB.")
    header, separator, encoded = data_url.partition(",")
    formats = {
        "data:image/png;base64": "PNG",
        "data:image/jpeg;base64": "JPEG",
        "data:image/webp;base64": "WEBP",
    }
    if not separator or header not in formats:
        raise ValueError("Escolha uma imagem PNG, JPEG ou WebP.")
    try:
        blob = base64.b64decode(encoded, validate=True)
        if not blob or len(blob) > MAX_IMAGE_BYTES:
            raise ValueError("A imagem deve ter no máximo 4 MB.")
        with Image.open(io.BytesIO(blob)) as picture:
            if (
                picture.format != formats[header]
                or picture.width * picture.height > MAX_IMAGE_PIXELS
                or max(picture.size) > 8000
            ):
                raise ValueError("Formato ou dimensões de imagem inválidos.")
            width, height = picture.size
            picture.verify()
        with Image.open(io.BytesIO(blob)) as picture:
            orientation = picture.getexif().get(274, 1)
        # Normalize WebP for native Word interoperability. No remote resources.
        if formats[header] == "WEBP" or orientation in range(2, 9):
            with Image.open(io.BytesIO(blob)) as picture:
                output = io.BytesIO()
                normalized = ImageOps.exif_transpose(picture)
                width, height = normalized.size
                if formats[header] == "JPEG":
                    normalized.convert("RGB").save(output, format="JPEG", quality=95)
                else:
                    normalized.convert("RGBA").save(output, format="PNG")
                blob = output.getvalue()
            if len(blob) > MAX_IMAGE_BYTES:
                raise ValueError("A imagem convertida ultrapassa 4 MB.")
        kind = "jpeg" if formats[header] == "JPEG" else "png"
        return blob, kind, width, height
    except (
        binascii.Error,
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
    ) as exc:
        raise ValueError("Arquivo de imagem inválido.") from exc


def store_image(directory, data_url, alt_text=""):
    if not isinstance(alt_text, str) or len(alt_text) > 1000:
        raise ValueError("Descrição da imagem inválida.")
    blob, kind, width, height = prepare_image(data_url)
    mid = hashlib.sha256(blob).hexdigest()
    folder = Path(directory) / "media"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / mid
    if not target.exists():
        temporary = folder / (mid + "." + uuid4().hex + ".tmp")
        try:
            temporary.write_bytes(blob)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    scale = min(1, 320 / (width * 0.75), 320 / (height * 0.75))
    return {
        "node": {
            "id": "image-" + uuid4().hex,
            "type": "image",
            "media_id": mid,
            "width_pt": width * 0.75 * scale,
            "height_pt": height * 0.75 * scale,
            "placement": "floating",
            "x_pt": 72,
            "y_pt": 72,
            "alt_text": alt_text,
            "geometry_edited": True,
        },
        "media": {"part": f"word/media/opendoc-{mid}.{kind}", "size": len(blob)},
        "url": f"data:image/{kind};base64," + base64.b64encode(blob).decode("ascii"),
    }


def write_image(writer, node):
    """Preserve imported DrawingML until edited; emit native page anchors on edits."""
    from apps.open_doc.parsers.docx.namespaces import w
    from apps.open_doc.parsers.docx.package import parse_xml

    if node.get("xml") and not node.get("geometry_edited"):
        return parse_xml(node["xml"].encode())
    mid = node["media_id"]
    if not writer.media_directory:
        raise ValueError("Pacote de mídia da imagem ausente.")
    blob = (writer.media_directory / mid).read_bytes()
    with Image.open(io.BytesIO(blob)) as picture:
        kind = {"PNG": "png", "JPEG": "jpeg", "GIF": "gif", "WEBP": "webp"}.get(
            picture.format
        )
        if not kind:
            raise ValueError("Imagem não suportada na exportação.")
    if kind == "webp":
        with Image.open(io.BytesIO(blob)) as picture:
            output = io.BytesIO()
            picture.convert("RGBA").save(output, format="PNG")
            blob = output.getvalue()
        kind = "png"
    name = f"opendoc-{mid}.{kind}"
    existing = writer.media_catalog.get(mid, {}).get("part", "")
    part = (
        existing
        if (existing.startswith("word/media/") and writer.parts.get(existing) == blob)
        else "word/media/" + name
    )
    writer.parts[part] = blob
    rid = writer.relationship(part.removeprefix("word/"), "image", False)
    ct = parse_xml(writer.parts["[Content_Types].xml"])
    if not any(e.get("Extension") == kind for e in ct):
        etree.SubElement(
            ct,
            "{http://schemas.openxmlformats.org/package/2006/content-types}Default",
            Extension=kind,
            ContentType="image/" + kind,
        )
        writer.parts["[Content_Types].xml"] = etree.tostring(
            ct, encoding="UTF-8", xml_declaration=True
        )

    def add(parent, prefix, tag, **attrs):
        return etree.SubElement(
            parent,
            "{" + NS[prefix] + "}" + tag,
            **{key: str(value) for key, value in attrs.items()},
        )

    drawing = etree.Element(w("drawing"))
    floating = node.get("placement") == "floating"
    box = add(
        drawing,
        "wp",
        "anchor" if floating else "inline",
        distT=0,
        distB=0,
        distL=0,
        distR=0,
    )
    if floating:
        box.attrib.update(
            {
                "simplePos": "0",
                "relativeHeight": "251658240",
                "behindDoc": "0",
                "locked": "0",
                "layoutInCell": "1",
                "allowOverlap": "1",
            }
        )
        add(box, "wp", "simplePos", x=0, y=0)
        for axis, coordinate in [("H", "x_pt"), ("V", "y_pt")]:
            position = add(box, "wp", "position" + axis, relativeFrom="page")
            add(position, "wp", "posOffset").text = str(
                round(node.get(coordinate, 0) * 12700)
            )
    cx, cy = (round(node.get(key, 72) * 12700) for key in ["width_pt", "height_pt"])
    add(box, "wp", "extent", cx=cx, cy=cy)
    if floating:
        add(box, "wp", "wrapNone")
    writer.image_sequence += 1
    add(
        box,
        "wp",
        "docPr",
        id=writer.image_sequence,
        name="Open Doc Image " + node["id"],
        descr=node.get("alt_text", ""),
    )
    if node.get("xml"):
        # Keep crop, rotation, effects and other picture properties from imports.
        raw = parse_xml(node["xml"].encode())
        graphic = raw.find(".//{" + NS["a"] + "}graphic")
    else:
        graphic = None
    if graphic is not None:
        box.append(graphic)
        for blip in graphic.iter("{" + NS["a"] + "}blip"):
            blip.set("{" + NS["r"] + "}embed", rid)
        for extent in graphic.iter("{" + NS["a"] + "}ext"):
            extent.set("cx", str(cx))
            extent.set("cy", str(cy))
    else:
        graphic = add(box, "a", "graphic")
        data = add(graphic, "a", "graphicData", uri=NS["pic"])
        pic = add(data, "pic", "pic")
        nv = add(pic, "pic", "nvPicPr")
        add(nv, "pic", "cNvPr", id=0, name=name)
        add(nv, "pic", "cNvPicPr")
        fill = add(pic, "pic", "blipFill")
        add(fill, "a", "blip").set("{" + NS["r"] + "}embed", rid)
        add(add(fill, "a", "stretch"), "a", "fillRect")
        shape = add(pic, "pic", "spPr")
        transform = add(shape, "a", "xfrm")
        add(transform, "a", "off", x=0, y=0)
        add(transform, "a", "ext", cx=cx, cy=cy)
        add(add(shape, "a", "prstGeom", prst="rect"), "a", "avLst")
    return drawing

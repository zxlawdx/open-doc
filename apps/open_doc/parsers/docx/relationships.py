"""Resolve internal OPC targets without fetching external relationships."""

import posixpath
from apps.open_doc.parsers.docx.namespaces import REL


def relationships(package, part="word/document.xml"):
    directory, filename = posixpath.split(part)
    root = package.xml(posixpath.join(directory, "_rels", filename + ".rels"))
    out = {}
    if root is not None:
        for e in root.findall("{" + REL + "}Relationship"):
            external = e.get("TargetMode") == "External"
            target = e.get("Target", "")
            resolved = (
                target
                if external
                else posixpath.normpath(posixpath.join(directory, target))
            )
            if not external and (
                resolved.startswith("../") or ":" in resolved or target.startswith("/")
            ):
                raise ValueError("Relationship inválido.")
            out[e.get("Id")] = {
                "target": resolved,
                "external": external,
                "type": e.get("Type", ""),
            }
    return out

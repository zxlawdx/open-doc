"""Clone native slide parts while keeping master/media relationships intact."""

from copy import deepcopy
import re

from pptx.opc.package import _Relationship
from pptx.opc.packuri import PackURI


class SourceCloner:
    def __init__(self, package):
        self.package = package
        self.names = {str(part.partname) for part in package.iter_parts()}

    def _name(self, original):
        template = re.sub(r"\d+(?=\.[^/.]+$)", "%d", str(original))
        if "%d" not in template:
            stem, extension = template.rsplit(".", 1)
            template = stem + "%d." + extension
        counter = 1
        while template % counter in self.names:
            counter += 1
        name = template % counter
        self.names.add(name)
        return PackURI(name)

    def part(self, original, cache=None):
        cache = {} if cache is None else cache
        if original in cache:
            return cache[original]
        copied = type(original).load(
            self._name(original.partname),
            original.content_type,
            self.package,
            original.blob,
        )
        cache[original] = copied
        for rel in original.rels.values():
            if rel.is_external:
                target, mode = rel.target_ref, "External"
            else:
                target, mode = rel.target_part, "Internal"
                kind = rel.reltype.rsplit("/", 1)[-1]
                # Layouts, masters and media are shared immutable resources.
                # Charts/workbooks/notes are copied so editing a duplicate
                # cannot mutate the original slide's data or notes.
                if kind not in {
                    "slideLayout",
                    "slideMaster",
                    "notesMaster",
                    "theme",
                    "image",
                    "font",
                    "video",
                    "audio",
                }:
                    target = self.part(target, cache)
            copied.rels._rels[rel.rId] = _Relationship(
                copied.partname.baseURI,
                rel.rId,
                rel.reltype,
                mode,
                target,
            )
        return copied

    def shape(self, shape, destination):
        element = deepcopy(shape._element)
        from pptx.oxml.ns import qn

        next_id = destination.shapes._next_shape_id
        for node in element.iter(qn("p:cNvPr")):
            node.set("id", str(next_id))
            next_id += 1
        cache = {}
        for node in element.iter():
            for name, value in list(node.attrib.items()):
                if not name.startswith(
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
                ):
                    continue
                rel = shape.part.rels.get(value)
                if rel is None:
                    continue
                if rel.is_external:
                    target = destination.part.relate_to(
                        rel.target_ref, rel.reltype, is_external=True
                    )
                else:
                    part = rel.target_part
                    if rel.reltype.rsplit("/", 1)[-1] not in {
                        "image",
                        "video",
                        "audio",
                        "font",
                    }:
                        part = self.part(part, cache)
                    target = destination.part.relate_to(part, rel.reltype)
                node.set(name, target)
        destination.shapes._spTree.insert_element_before(element, "p:extLst")
        return destination.shapes._shape_factory(element)

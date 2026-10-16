"""Bounded OPC ZIP/XML reader. Never extract or resolve network/DTD/entities."""

from pathlib import Path, PurePosixPath
from zipfile import ZipFile, BadZipFile
from lxml import etree

MAX_DOCX_BYTES = 100 * 1024 * 1024
MAX_XML_PART_BYTES = 16 * 1024 * 1024
MAX_MEDIA_BYTES = 32 * 1024 * 1024
MAX_EXPANDED_BYTES = 200 * 1024 * 1024
MAX_ENTRY_COUNT = 5000


def parse_xml(data):
    try:
        root = etree.fromstring(
            data,
            parser=etree.XMLParser(
                resolve_entities=False, no_network=True, recover=False, huge_tree=False
            ),
        )
        if root.getroottree().docinfo.doctype:
            raise ValueError("DTD não permitida.")
        return root
    except etree.XMLSyntaxError as exc:
        raise ValueError("XML DOCX inválido.") from exc


class DocxPackage:
    def __init__(self, path, parts):
        self.path = Path(path)
        self.parts = parts
        self._xml_cache = {}

    @classmethod
    def open(cls, path, required_parts=None):
        path = Path(path)
        if path.stat().st_size > MAX_DOCX_BYTES:
            raise ValueError("DOCX maior que 100 MB.")
        parts = {}
        try:
            with ZipFile(path) as z:
                infos = z.infolist()
                if (
                    len(infos) > MAX_ENTRY_COUNT
                    or sum(i.file_size for i in infos) > MAX_EXPANDED_BYTES
                ):
                    raise ValueError("Pacote expandido muito grande.")
                for info in infos:
                    name = info.filename
                    if (
                        "\\" in name
                        or name.startswith("/")
                        or ".." in PurePosixPath(name).parts
                        or ":" in name
                        or name in parts
                    ):
                        raise ValueError("Caminho DOCX inválido/duplicado.")
                    limit = (
                        MAX_XML_PART_BYTES
                        if name.endswith((".xml", ".rels"))
                        else MAX_MEDIA_BYTES
                    )
                    if info.file_size > limit or info.flag_bits & 1:
                        raise ValueError("Parte muito grande ou criptografada.")
                    parts[name] = z.read(info)
        except (BadZipFile, RuntimeError) as exc:
            raise ValueError("DOCX inválido.") from exc
        if not (
            required_parts
            or {"word/document.xml", "[Content_Types].xml", "_rels/.rels"}
        ).issubset(parts):
            raise ValueError("Pacote DOCX incompleto.")
        result = cls(path, parts)
        for name in parts:
            if name.endswith((".xml", ".rels")):
                result.xml(name)
        return result

    def xml(self, name):
        if name not in self.parts:
            return None
        if name not in self._xml_cache:
            self._xml_cache[name] = parse_xml(self.parts[name])
        return self._xml_cache[name]

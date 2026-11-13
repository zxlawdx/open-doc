"""OpenDocument conversion with an isolated LibreOffice profile and atomic output.

The original is never rewritten. This is a conversion adapter, not a claim of
native lossless ODF support. LibreOffice remains an optional system dependency.
"""

import os
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile

from defusedxml import ElementTree as ET
from defusedxml.common import DefusedXmlException

MIME = {
    "odt": "application/vnd.oasis.opendocument.text",
    "odp": "application/vnd.oasis.opendocument.presentation",
}
FILTERS = {
    "docx": "docx:Office Open XML Text",
    "pptx": "pptx:Impress MS PowerPoint 2007 XML",
    "odt": "odt:writer8",
    "odp": "odp:impress8",
}
XLINK = "{http://www.w3.org/1999/xlink}href"


def executable():
    from apps.open_doc.readers.pptx.preview import libreoffice_executable

    configured = os.environ.get("OPEN_DOC_LIBREOFFICE")
    return shutil.which(configured) if configured else libreoffice_executable()


def inspect_package(path):
    path = Path(path)
    if (
        path.suffix.lower()[1:] not in MIME
        or path.is_symlink()
        or not path.is_file()
        or path.stat().st_size > 64 * 1024 * 1024
    ):
        raise ValueError("Arquivo OpenDocument inválido ou acima de 64 MB.")
    try:
        with ZipFile(path) as z:
            members = z.infolist()
            if (
                len(members) > 10000
                or sum(x.file_size for x in members) > 256 * 1024 * 1024
                or any(
                    x.filename.startswith("/") or ".." in Path(x.filename).parts
                    for x in members
                )
            ):
                raise ValueError(
                    "Pacote OpenDocument excede os limites ou contém caminhos inválidos."
                )
            if z.read("mimetype").decode() != MIME[path.suffix.lower()[1:]]:
                raise ValueError("A extensão não corresponde ao tipo OpenDocument.")
            for name in ("content.xml", "META-INF/manifest.xml", "styles.xml"):
                if name == "styles.xml" and name not in z.namelist():
                    continue
                tree = ET.fromstring(z.read(name))
                for node in tree.iter():
                    tag = node.tag.rsplit("}", 1)[-1]
                    if tag == "encryption-data":
                        raise ValueError(
                            "Documento protegido por senha; abra uma cópia desbloqueada."
                        )
                    if tag in {"image", "object", "object-ole", "script"}:
                        href = node.get(XLINK, "")
                        if href and (
                            ":" in href
                            or href.startswith(("/", "\\"))
                            or ".." in Path(href).parts
                        ):
                            raise ValueError(
                                "Recursos externos do OpenDocument precisam ser incorporados ao arquivo."
                            )
    except (
        BadZipFile,
        KeyError,
        UnicodeError,
        ET.ParseError,
        DefusedXmlException,
    ) as error:
        raise ValueError("Pacote OpenDocument inválido.") from error


def convert(source, destination, target):
    source = Path(source)
    destination = Path(destination)
    if source.is_symlink() or destination.is_symlink():
        raise ValueError("Escolha arquivos regulares, sem links simbólicos.")
    source = source.resolve()
    if target not in FILTERS or source.suffix.lower()[1:] not in FILTERS:
        raise ValueError("Conversão de formato inválida.")
    if source == destination.resolve():
        raise ValueError("Escolha um destino diferente do original.")
    if source.suffix.lower()[1:] in MIME:
        inspect_package(source)
    program = executable()
    if not program:
        raise ValueError(
            "Instale LibreOffice para importar/exportar ODT e ODP. O original permanece intacto."
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".opendoc-odf-", dir=destination.parent) as tmp:
        root = Path(tmp)
        profile = root / "profile"
        (profile / "user").mkdir(parents=True)
        (profile / "user/registrymodifications.xcu").write_text(
            '<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>'
        )
        try:
            subprocess.run(
                [
                    program,
                    "-env:UserInstallation=" + profile.as_uri(),
                    "--headless",
                    "--nologo",
                    "--nodefault",
                    "--norestore",
                    "--nofirststartwizard",
                    "--convert-to",
                    FILTERS[target],
                    "--outdir",
                    str(root),
                    str(source),
                ],
                check=True,
                timeout=120,
                capture_output=True,
            )
            result = root / (source.stem + "." + target)
            if not result.is_file() or not result.stat().st_size:
                raise ValueError("LibreOffice não gerou o arquivo convertido.")
            if target in MIME:
                inspect_package(result)
            else:
                with ZipFile(result) as z:
                    required = (
                        "word/document.xml"
                        if target == "docx"
                        else "ppt/presentation.xml"
                    )
                    if required not in z.namelist():
                        raise ValueError(
                            "O resultado da conversão não contém um documento válido."
                        )
            os.replace(result, destination)
        except (subprocess.SubprocessError, OSError, BadZipFile) as error:
            raise ValueError(
                "A conversão não foi concluída. O original e o destino anterior foram preservados."
            ) from error
    return {
        "path": str(destination),
        "name": destination.name,
        "lossy": True,
        "warnings": [
            "Conversão OpenDocument: revise layout, fontes e recursos avançados."
        ],
    }

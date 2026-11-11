#!/usr/bin/env python3
"""Build a Debian installer from a Vela-frozen Open Doc Linux bundle."""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

DEPENDENCIES = (
    "libc6 (>= 2.35), libx11-6, libx11-xcb1, libxext6, libxrender1, "
    "libxtst6, libxkbcommon-x11-0, libxcb-xinerama0, libxcb-cursor0, libxcb-shape0, libxcb-randr0, libxcb-xfixes0, libxcb-sync1, libxcb-shm0, libxcb-xkb1, libxcb-render0, libx11-xcb1, libxcb-icccm4, libxcb-keysyms1, libxcb-image0, libxcb-render-util0, "
    "libegl1, libgl1, libnss3, libasound2, libfontconfig1, xdg-utils"
)

DESKTOP_ENTRY = """[Desktop Entry]
Type=Application
Name=Open Doc
Comment=Editor de documentos, PDFs, planilhas e apresentacoes
Exec=open-doc %F
Icon=open-doc
Terminal=false
Categories=Office;WordProcessor;
MimeType=application/pdf;application/vnd.openxmlformats-officedocument.wordprocessingml.document;application/vnd.openxmlformats-officedocument.presentationml.presentation;
"""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_deb(version: str, root: Path) -> Path:
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise ValueError("A versao deve usar MAJOR.MINOR.PATCH.")

    bundle = root / "dist" / "Open-Doc"
    binary = bundle / "Open-Doc"
    icon = root / "build" / "open-doc.png"
    license_file = root / "LICENSE"
    if not binary.is_file() or not icon.is_file() or not license_file.is_file():
        raise FileNotFoundError(
            "Binario Vela, icone ou LICENSE ausente antes de gerar DEB."
        )

    release = root / "dist" / "release"
    release.mkdir(parents=True, exist_ok=True)
    output = release / f"Open-Doc-{version}-Linux-amd64.deb"

    with tempfile.TemporaryDirectory(prefix="open-doc-deb-") as temp_dir:
        stage = Path(temp_dir)
        target = stage / "opt" / "open-doc" / "Open-Doc"
        shutil.copytree(bundle, target, symlinks=True)

        bin_dir = stage / "usr" / "bin"
        bin_dir.mkdir(parents=True)
        launcher = bin_dir / "open-doc"
        launcher.write_text(
            '#!/bin/sh\nexec /opt/open-doc/Open-Doc/Open-Doc "$@"\n',
            encoding="utf-8",
        )
        launcher.chmod(0o755)

        app_dir = stage / "usr" / "share" / "applications"
        app_dir.mkdir(parents=True)
        (app_dir / "open-doc.desktop").write_text(DESKTOP_ENTRY, encoding="utf-8")

        icon_dir = stage / "usr" / "share" / "icons" / "hicolor" / "256x256" / "apps"
        icon_dir.mkdir(parents=True)
        shutil.copy2(icon, icon_dir / "open-doc.png")

        doc_dir = stage / "usr" / "share" / "doc" / "open-doc"
        doc_dir.mkdir(parents=True)
        shutil.copy2(license_file, doc_dir / "copyright")

        metadata_dir = stage / "DEBIAN"
        metadata_dir.mkdir()
        installed_size = subprocess.check_output(
            ["du", "-sk", str(stage / "opt" / "open-doc")], text=True
        ).split()[0]
        control = (
            "Package: open-doc\n"
            f"Version: {version}\n"
            "Section: editors\n"
            "Priority: optional\n"
            "Architecture: amd64\n"
            f"Installed-Size: {installed_size}\n"
            "Maintainer: Open Doc Contributors <noreply@github.com>\n"
            f"Depends: {DEPENDENCIES}\n"
            "Description: Open Doc - editor desktop livre\n"
            " Editor de documentos, PDFs, planilhas e apresentacoes com Vela.\n"
        )
        (metadata_dir / "control").write_text(control, encoding="utf-8")
        subprocess.run(
            ["dpkg-deb", "--build", "--root-owner-group", str(stage), str(output)],
            check=True,
        )

    (release / (output.name + ".sha256")).write_text(
        f"{sha256(output)}  {output.name}\n", encoding="ascii"
    )
    print(f"Pacote Debian gerado: {output}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    arguments = parser.parse_args()
    build_deb(arguments.version, Path(__file__).resolve().parents[1])

"""Register Open Doc as an optional handler for standard document types."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

FILE_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
APP_NAME = "Open Doc"
CAPABILITIES = r"Software\OpenDoc\Capabilities"


def installed_executable() -> Path | None:
    """Only offer associations when the handler points to a Vela installation."""
    if not getattr(sys, "frozen", False):
        return None
    executable = Path(sys.executable).resolve()
    if sys.platform == "win32":
        local_data = Path(
            os.environ.get("LOCALAPPDATA") or Path.home() / "AppData/Local"
        )
        roots = (local_data / "Programs/Vela",)
    elif sys.platform.startswith("linux"):
        roots = (_linux_data_home() / "vela-apps", Path("/opt/vela"))
    else:
        return None
    return (
        executable
        if executable.is_file()
        and any(executable.parent.parent == root.resolve() for root in roots)
        else None
    )


def _linux_data_home() -> Path:
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")


def _linux_desktop_path(executable: Path) -> Path:
    manifest = json.loads(
        (executable.parent / ".vela-app.json").read_text(encoding="utf-8")
    )
    slug = manifest["slug"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", slug):
        raise ValueError("Identificador da instalação inválido.")
    if manifest["executable"] != executable.name:
        raise ValueError("Executável da instalação inválido.")
    return _linux_data_home() / "applications" / (slug + ".desktop")


def _desktop_entry(executable: Path) -> str:
    path = str(executable)
    if any(char in path for char in "\n\r\t"):
        raise ValueError("Caminho da instalação incompatível com o menu do sistema.")
    # Exec applies desktop-entry escaping before unquoting the command token.
    escaped = path.replace("%", "%%")
    escaped = re.sub(r'([\\"$`])', r"\\\1", escaped).replace("\\", "\\\\")
    return (
        "[Desktop Entry]\nType=Application\n"
        f'Name={APP_NAME}\nExec="{escaped}" %f\n'
        "Terminal=false\nCategories=Office;\nIcon=applications-office\n"
        f"MimeType={';'.join(FILE_TYPES.values())};\n"
    )


def _windows_registration(executable: Path):
    classes = r"Software\Classes"
    application = classes + f"\\Applications\\{executable.name}"
    command = f'"{executable}" "%1"'
    yield r"Software\RegisteredApplications", APP_NAME, CAPABILITIES
    yield CAPABILITIES, "ApplicationName", APP_NAME
    yield CAPABILITIES, "ApplicationDescription", "Editor de PDF, DOCX e PPTX"
    yield application, "FriendlyAppName", APP_NAME
    yield application + r"\shell\open\command", "", command
    for extension in FILE_TYPES:
        yield application + r"\SupportedTypes", extension, ""
        progid = f"OpenDoc.{extension[1:].upper()}"
        yield CAPABILITIES + r"\FileAssociations", extension, progid
        yield classes + f"\\{extension}\\OpenWithProgids", progid, ""
        yield classes + f"\\{progid}", "", f"Documento {extension[1:].upper()}"
        yield classes + f"\\{progid}\\shell\\open\\command", "", command


def register(executable: Path) -> None:
    """Advertise supported formats without choosing any default."""
    if sys.platform == "win32":
        import ctypes
        import winreg

        for key, name, value in _windows_registration(executable):
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key) as handle:
                winreg.SetValueEx(handle, name, 0, winreg.REG_SZ, value)
        ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)
    elif sys.platform.startswith("linux"):
        desktop = _linux_desktop_path(executable)
        entry = _desktop_entry(executable)
        if desktop.is_file() and desktop.read_text(encoding="utf-8") == entry:
            return
        desktop.parent.mkdir(parents=True, exist_ok=True)
        desktop.write_text(entry, encoding="utf-8")
        tool = shutil.which("update-desktop-database")
        if tool:
            subprocess.run([tool, str(desktop.parent)], check=False, timeout=5)


def set_linux_default(executable: Path, extension: str) -> None:
    if not sys.platform.startswith("linux") or extension not in FILE_TYPES:
        raise ValueError("Formato não disponível para esta ação.")
    tool = shutil.which("xdg-mime")
    if not tool:
        raise ValueError(
            "Instale o pacote xdg-utils ou use Abrir com no gerenciador de arquivos."
        )
    desktop = _linux_desktop_path(executable)
    mime = FILE_TYPES[extension]
    subprocess.run([tool, "default", desktop.name, mime], check=True, timeout=10)
    selected = subprocess.check_output(
        [tool, "query", "default", mime], text=True, timeout=10
    ).strip()
    if selected != desktop.name:
        raise ValueError(
            "O sistema não confirmou a mudança. Use Abrir com no gerenciador de arquivos."
        )

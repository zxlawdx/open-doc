"""
Módulo: test_foundation.py.
Responsabilidade: verificar persistência, importação e integração HTTP Vela.
Autor: Vela Writer Contributors
Criado em: 2026
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen

import pytest
from webtest import TestApp

from app.config import DATA_DIRECTORIES, Config
from app.file_organizer import FileOrganizer
from app.router import create_routes

HTTP_OK = 200
HTTP_BAD_REQUEST = 400
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404


def test_workspace_and_settings(tmp_path: Path) -> None:
    """Cria diretórios e preserva preferências entre instâncias."""
    config = Config(tmp_path)
    assert all((tmp_path / folder).is_dir() for folder in DATA_DIRECTORIES)
    config.save_settings({"sidebar_collapsed": True})
    assert Config(tmp_path).load_settings() == {"sidebar_collapsed": True}
    with pytest.raises(ValueError):
        config.save_settings({"sidebar_collapsed": "yes"})
    assert config.load_settings()["sidebar_collapsed"] is True


def test_corrupt_config_is_preserved(tmp_path: Path) -> None:
    """Não destrói JSON corrompido silenciosamente."""
    config = Config(tmp_path)
    config.settings_path.write_text("{broken", encoding="utf-8")
    with pytest.raises(ValueError):
        config.load_settings()
    assert config.settings_path.read_text(encoding="utf-8") == "{broken"


@pytest.mark.parametrize("extension", [".pdf", ".docx", ".pptx", ".md", ".txt"])
def test_import_and_collision(tmp_path: Path, extension: str) -> None:
    """Importa formatos suportados e reserva nomes sem perda de dados."""
    config = Config(tmp_path / "workspace")
    organizer = FileOrganizer(config)
    source = tmp_path / ("document" + extension)
    if extension in {".docx", ".pptx"}:
        part = "word/document.xml" if extension == ".docx" else "ppt/presentation.xml"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr(part, "<xml/>")
    elif extension == ".pdf":
        source.write_bytes(b"%PDF-1.7\n")
    else:
        source.write_text("Olá mundo", encoding="utf-8")
    original = source.read_bytes()
    first = organizer.organize(source)
    second = organizer.organize(source)
    assert first != second
    assert first.read_bytes() == second.read_bytes() == original
    assert source.exists()
    third = organizer.organize(source, move=True)
    assert third.exists() and not source.exists()
    assert len(organizer.list_files()) == 3


@pytest.mark.parametrize("name", ["bad.pdf", "bad.docx", "bad.pptx", "bad.exe"])
def test_invalid_documents(tmp_path: Path, name: str) -> None:
    """Rejeita extensão desconhecida e assinaturas incompatíveis."""
    organizer = FileOrganizer(Config(tmp_path / "workspace"))
    source = tmp_path / name
    source.write_bytes(b"invalid")
    with pytest.raises(ValueError):
        organizer.organize(source)
    assert organizer.list_files() == []


def test_symlink_rejected(tmp_path: Path) -> None:
    """Não segue links simbólicos no importador."""
    source = tmp_path / "original.md"
    source.write_text("nota", encoding="utf-8")
    link = tmp_path / "link.md"
    link.symlink_to(source)
    with pytest.raises(ValueError):
        FileOrganizer(Config(tmp_path / "workspace")).organize(link)


def test_http_routes_and_csrf(tmp_path: Path) -> None:
    """Verifica templates, assets, persistência e rejeição de POST sem token."""
    application = TestApp(create_routes(Config(tmp_path)))
    page = application.get("/")
    assert "Dê espaço às" in page.text
    assert "{{" not in page.text
    assert "default-src 'self'" in page.headers["Content-Security-Policy"]
    application.get("/static/css/main.css", status=HTTP_OK)
    application.get("/static/fonts/Inter.woff2", status=HTTP_OK)
    application.get("/static/../../app/config.py", status=HTTP_FORBIDDEN)
    application.post_json(
        "/writer/settings", {"sidebar_collapsed": True}, status=HTTP_FORBIDDEN
    )
    token = re.search('name="writer-token" content="([^"]+)"', page.text).group(1)
    headers = {"X-Writer-Token": token}
    application.post_json(
        "/writer/settings", {"sidebar_collapsed": True}, headers=headers
    )
    assert application.get("/writer/settings").json["sidebar_collapsed"] is True
    application.post_json(
        "/writer/settings",
        {"unknown": True},
        headers=headers,
        status=HTTP_BAD_REQUEST,
    )
    assert application.get("/writer/files").json == {"files": []}


def test_vela_server_mount() -> None:
    """Serve a interface pelo servidor real do Vela, sem abrir janela."""
    from vela.core.api_router import ApiRouter
    from vela.core.api_server import ApiServer

    with TemporaryDirectory() as directory:
        server = ApiServer(ApiRouter(), host="127.0.0.1", port=0, docs_enabled=False)
        server.app.mount("/", create_routes(Config(Path(directory))))
        server.start()
        server.wait_until_ready()
        base = f"http://127.0.0.1:{server.port}"
        with urlopen(base + "/", timeout=5) as response:
            assert "Vela Writer" in response.read().decode()
        with urlopen(base + "/writer/files", timeout=5) as response:
            assert json.load(response) == {"files": []}

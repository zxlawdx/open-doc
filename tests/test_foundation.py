"""
Módulo: test_foundation.py.
Responsabilidade: verificar persistência, importação e integração HTTP Vela.
Autor: Open Doc Contributors
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
from config.wsgi import create_app

HTTP_OK = 200
HTTP_BAD_REQUEST = 400
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404


def test_workspace_and_settings(tmp_path: Path) -> None:
    """Cria diretórios e preserva preferências entre instâncias."""
    config = Config(tmp_path)
    assert all((tmp_path / folder).is_dir() for folder in DATA_DIRECTORIES)
    config.save_settings({"sidebar_collapsed": True})
    assert Config(tmp_path).load_settings()["sidebar_collapsed"] is True
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


def test_vela_application_lifecycle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Executa VelaApp.run com janela substituída e servidor HTTP real."""
    from vela.core.app import VelaApp
    from vela.core.bridge import BaseBridge
    import vela.core.app as runtime
    from app.runtime import services

    captured = {}

    class Window:
        """Captura parâmetros entregues à janela pelo VelaApp."""

        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

        def run(self) -> None:
            """Substitui apenas a janela gráfica no teste."""
            captured["ran"] = True

    monkeypatch.chdir(Path(__file__).resolve().parents[1])
    monkeypatch.setattr(runtime, "DesktopWindow", Window)
    application = create_app(Config(tmp_path))
    assert isinstance(application, VelaApp)
    assert isinstance(application.bridge, BaseBridge)
    application.run()
    assert captured["ran"] is True
    assert captured["shell_mode"] == "http"
    assert captured["entry_route"] == "/"
    result = application.bridge.navigate("/")
    assert result["layout"] == "blank"
    assert "data-source" in result["html"]
    assert "{{" not in result["html"]
    assert "/__vela__/static/open_doc/js/app.js" in result["html"]

    base = f"http://127.0.0.1:{application.api_server.port}"
    with urlopen(base + "/__vela__/shell", timeout=5) as response:
        shell = response.read().decode()
        assert "cdn.tailwindcss.com" not in shell
        assert "fonts.googleapis.com" not in shell
    with urlopen(
        base + "/__vela__/static/open_doc/js/editor.js", timeout=5
    ) as response:
        assert response.status == HTTP_OK

    client = TestApp(application.api_server.app)
    client.post_json(
        "/api/open_doc/document/new", {"title": "Negado"}, status=HTTP_FORBIDDEN
    )
    headers = {"X-Open-Doc-Token": services().token}
    note = client.post_json(
        "/api/open_doc/document/new", {"title": "Minha nota"}, headers=headers
    ).json
    note["markdown"] = "# Olá\n\nTexto **forte**."
    saved = client.post_json("/api/open_doc/document/save", note, headers=headers).json
    assert saved["revision"] == note["revision"] + 1
    client.post_json("/api/open_doc/document/save", note, headers=headers, status=409)
    client.post_json(
        "/api/open_doc/document/open",
        {"path": "../outside.md"},
        headers=headers,
        status=HTTP_BAD_REQUEST,
    )
    client.post_json(
        "/api/open_doc/settings",
        {"settings": {"sidebar_collapsed": True}},
        headers=headers,
    )
    assert services().config.load_settings()["sidebar_collapsed"] is True
    for extension in ("pdf", "docx", "md"):
        exported = client.post_json(
            "/api/open_doc/document/export",
            {"id": saved["id"], "revision": saved["revision"], "format": extension},
            headers=headers,
        ).json
        assert Path(exported["path"]).is_relative_to(tmp_path / "exports")
        assert Path(exported["path"]).stat().st_size > 0

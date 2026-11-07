import json
import sys
from pathlib import Path

import pytest

from apps.open_doc.services import file_associations as associations


def test_windows_registration_targets_current_user_open_with(tmp_path):
    executable = tmp_path / "Pasta com espaços" / "Open-Doc.exe"
    entries = {
        (key, name): value
        for key, name, value in associations._windows_registration(executable)
    }

    assert (
        entries[(r"Software\RegisteredApplications", "Open Doc")]
        == associations.CAPABILITIES
    )
    for extension in (".pdf", ".docx", ".pptx"):
        progid = entries[(associations.CAPABILITIES + r"\FileAssociations", extension)]
        assert entries[(rf"Software\Classes\{extension}\OpenWithProgids", progid)] == ""
        assert (
            entries[(rf"Software\Classes\{progid}\shell\open\command", "")]
            == f'"{executable}" "%1"'
        )
        assert (rf"Software\Classes\{extension}", "") not in entries
    assert not any("UserChoice" in key for key, _ in entries)


def test_linux_registers_existing_mime_types_and_changes_only_selected_default(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    executable = tmp_path / "vela-apps" / "Open-Doc" / "Open Doc"
    executable.parent.mkdir(parents=True)
    executable.touch()
    (executable.parent / ".vela-app.json").write_text(
        json.dumps({"slug": "Open-Doc", "executable": executable.name}),
        encoding="utf-8",
    )
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(executable))
    monkeypatch.setattr(associations.shutil, "which", lambda name: name)
    calls = []
    monkeypatch.setattr(
        associations.subprocess, "run", lambda args, **_: calls.append(args)
    )
    monkeypatch.setattr(
        associations.subprocess, "check_output", lambda *_, **__: "Open-Doc.desktop\n"
    )

    assert associations.installed_executable() == executable
    associations.register(executable)
    associations.register(executable)
    desktop = tmp_path / "applications" / "Open-Doc.desktop"
    entry = desktop.read_text(encoding="utf-8")
    # The Linux registration is also simulated on Windows, where tmp_path
    # contains backslashes. Exec quoting and desktop-entry escaping each
    # require another level of escaping.
    escaped_path = str(executable).replace("\\", "\\" * 4)
    assert f'Exec="{escaped_path}" %f' in entry.splitlines()
    assert "MimeType=" + ";".join(associations.FILE_TYPES.values()) + ";" in entry
    assert calls == [["update-desktop-database", str(desktop.parent)]]
    associations.set_linux_default(executable, ".pdf")
    assert calls[-1] == ["xdg-mime", "default", desktop.name, "application/pdf"]
    with pytest.raises(ValueError):
        associations.set_linux_default(executable, ".exe")


@pytest.mark.parametrize("extension", [".pdf", ".docx", ".pptx"])
def test_startup_opens_associated_document_preserving_original(tmp_path, extension):
    from docx import Document
    from fpdf import FPDF
    from pptx import Presentation

    from apps.open_doc.application.context import get_context
    from apps.open_doc.services.preferences_service import Config
    from config.wsgi import create_app

    original = tmp_path / ("Arquivo com espaços e acentos" + extension)
    if extension == ".pdf":
        document = FPDF()
        document.add_page()
        document.output(original)
    elif extension == ".docx":
        Document().save(original)
    else:
        presentation = Presentation()
        presentation.slides.add_slide(presentation.slide_layouts[6])
        presentation.save(original)
    before = original.read_bytes()

    create_app(Config(tmp_path / "workspace"), startup_path=original)
    bootstrap = get_context().documents.bootstrap()
    assert bootstrap["document"]["source_kind"] == extension[1:]
    assert bootstrap["document"]["title"] == original.stem
    assert bootstrap["startup_error"] is None
    assert original.read_bytes() == before


def test_invalid_startup_file_keeps_workspace_available(tmp_path):
    from apps.open_doc.application.context import get_context
    from apps.open_doc.services.preferences_service import Config
    from config.wsgi import create_app

    create_app(Config(tmp_path / "workspace"), startup_path=tmp_path / "missing.pdf")
    bootstrap = get_context().documents.bootstrap()
    assert bootstrap["document"]["id"]
    assert "Não foi possível abrir" in bootstrap["startup_error"]


def test_packaged_entrypoint_uses_document_argument(monkeypatch, tmp_path):
    from types import SimpleNamespace

    from config import wsgi

    executable = tmp_path / "Open-Doc"
    document = tmp_path / "Currículo com espaços.docx"
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "argv", [str(executable), str(document)])
    monkeypatch.setattr(associations, "installed_executable", lambda: executable)
    events = []
    monkeypatch.setattr(associations, "register", lambda path: events.append(path))

    def create_app(*, startup_path):
        events.append(startup_path)
        return SimpleNamespace(run=lambda: events.append("started"))

    monkeypatch.setattr(wsgi, "create_app", create_app)
    wsgi.run()
    assert events == [executable, document, "started"]

"""Native Open/Import dialogs should start in the user's OS Documents folder."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import webview

from config import bridge as bridge_module
from config.bridge import OpenDocBridge, default_import_directory


def test_documents_directory_fallback(tmp_path):
    assert default_import_directory(tmp_path, "linux") == str(tmp_path)
    documents = tmp_path / "Documents"
    documents.mkdir()
    assert default_import_directory(tmp_path, "linux") == str(documents)


def test_linux_xdg_documents_directory(tmp_path):
    documents = tmp_path / "Meus Documentos"
    documents.mkdir()
    config = tmp_path / ".config"
    config.mkdir()
    (config / "user-dirs.dirs").write_text(
        'XDG_DOCUMENTS_DIR="$HOME/Meus Documentos"\n', encoding="utf-8"
    )
    assert default_import_directory(tmp_path, "linux") == str(documents)


def test_windows_documents_redirection(tmp_path, monkeypatch):
    from contextlib import nullcontext

    redirected = tmp_path / "OneDrive" / "Documentos"
    redirected.mkdir(parents=True)
    fake_winreg = SimpleNamespace(
        HKEY_CURRENT_USER=object(),
        OpenKey=lambda *_args: nullcontext(object()),
        QueryValueEx=lambda *_args: (str(redirected), 2),
    )
    monkeypatch.setitem(sys.modules, "winreg", fake_winreg)
    assert default_import_directory(tmp_path, "win32") == str(redirected)


@pytest.mark.parametrize(
    ("method", "args"),
    [
        ("import_document", ()),
        ("import_dataset", ("dataset", "utf-8", ",")),
        ("import_workbook", ()),
        ("append_workbook_csv", ([], 0)),
        ("import_font", ()),
    ],
)
def test_all_import_dialogs_use_documents_and_cancel_safely(
    method, args, monkeypatch, tmp_path
):
    documents = tmp_path / "Documents"
    documents.mkdir()
    monkeypatch.setattr(
        bridge_module, "default_import_directory", lambda: str(documents)
    )
    bridge = OpenDocBridge()
    bridge._window = Mock()
    bridge._window.create_file_dialog.return_value = None

    result = getattr(bridge, method)(*args)

    assert result == {"cancelled": True}
    call = bridge._window.create_file_dialog.call_args
    assert call.args[0] == webview.FileDialog.OPEN
    assert call.kwargs["directory"] == str(documents)

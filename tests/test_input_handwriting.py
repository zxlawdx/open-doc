"""Unavailable backend/language diagnostics never imply recognition success."""

import asyncio
import json
import pytest
from apps.open_doc.ink.handwriting import HandwritingService
from apps.open_doc.ink.windows_ink import WindowsInkBackend
from apps.open_doc.ink.paddle_ocr import PaddleOcrBackend


def test_handwriting_capabilities_optional():
    class Missing:
        name = "optional-engine"
        available = False

    capabilities = HandwritingService([Missing()]).capabilities()
    assert capabilities[0]["available"] is False
    assert capabilities[0]["reason"]


def test_windows_ink_diagnostics(monkeypatch):
    import apps.open_doc.ink.windows_ink as module

    monkeypatch.setattr(module.sys, "platform", "linux")
    result = WindowsInkBackend().diagnostics()
    assert not result["available"] and not result["pywinrt_installed"]
    assert result["recognizers"] == [] and "Windows" in result["reason"]


def test_paddleocr_diagnostics_distinguishes_missing_package(monkeypatch, tmp_path):
    from apps.open_doc.services.preferences_service import Config
    import apps.open_doc.ink.paddle_ocr as module

    backend = PaddleOcrBackend(Config(tmp_path))
    monkeypatch.setattr(module.importlib.util, "find_spec", lambda name: None)
    result = backend.diagnostics()
    assert result["available"] is False
    assert result["package_installed"] is False
    assert "não instalado" in result["reason"]


def test_paddleocr_diagnostics_distinguishes_missing_models(monkeypatch, tmp_path):
    from apps.open_doc.services.preferences_service import Config
    import apps.open_doc.ink.paddle_ocr as module

    backend = PaddleOcrBackend(Config(tmp_path))
    backend.directory.mkdir(parents=True)
    backend.settings.write_text(
        json.dumps({"det_model_dir": "det", "rec_model_dir": "rec"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(module.importlib.util, "find_spec", lambda name: object())
    result = backend.diagnostics()
    assert result["available"] is False
    assert result["settings_present"] is True
    assert result["models_present"] is False
    assert "modelos locais" in result["reason"]


def test_handwriting_missing_backend_message():
    with pytest.raises(RuntimeError, match="local não instalado.*tinta foi mantida"):
        asyncio.run(HandwritingService([]).recognize([], language="pt-BR"))


def test_handwriting_language_diagnostic_is_specific():
    class MissingPortuguese:
        name = "windows-ink"
        available = False

        def diagnostics(self):
            return {
                "backend": self.name,
                "available": False,
                "recognizers": ["English"],
                "reason": "Instale o recurso de escrita Português no Windows.",
            }

    with pytest.raises(RuntimeError, match="Português"):
        asyncio.run(
            HandwritingService([MissingPortuguese()]).recognize([], language="pt-BR")
        )


def test_save_generation_does_not_replace_newer_state(tmp_path):
    from apps.open_doc.services.document_service import Editor, RevisionConflict
    from apps.open_doc.services.preferences_service import Config

    editor = Editor(Config(tmp_path))
    note = editor.create("input", "A")
    editor.save(note["id"], note["title"], "AB", note["revision"])
    with pytest.raises(RevisionConflict):
        editor.save(note["id"], note["title"], "A", note["revision"])
    assert editor.get(note["id"])["markdown"] == "AB"

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from shared.services.document_application import DocumentApplication


class FakeOrganizer:
    def __init__(self, imported_target: Path | None = None) -> None:
        self.imported_target = imported_target
        self.organize_calls: list[Path] = []

    def organize(self, path: Path) -> Path:
        self.organize_calls.append(path)
        if self.imported_target is None:
            raise AssertionError("workspace open must not organize/copy an existing file")
        return self.imported_target


class FakeFixedDocuments:
    def __init__(self) -> None:
        self.activated: list[str] = []

    def exists(self, _identifier: str) -> bool:
        return False

    def activate(self, kind: str) -> None:
        self.activated.append(kind)

    def import_pdf(self, path: Path):
        return {"kind": "pdf", "path": path}

    def import_pptx(self, path: Path):
        return {"kind": "pptx", "path": path}


class FakeEditor:
    def import_note(self, path: Path):
        return {"title": path.stem, "path": path}

    def import_docx(self, path: Path):
        return {"title": path.stem, "path": path}


def _context(root: Path, organizer: FakeOrganizer):
    return SimpleNamespace(
        config=SimpleNamespace(root=root),
        organizer=organizer,
        fixed_documents=FakeFixedDocuments(),
        editor=FakeEditor(),
    )


def test_open_workspace_file_does_not_copy_it_again(tmp_path):
    notes = tmp_path / "notes"
    notes.mkdir(parents=True)
    source = notes / "import-md.md"
    source.write_text("# 🐧", encoding="utf-8")
    organizer = FakeOrganizer()
    context = _context(tmp_path, organizer)

    result = DocumentApplication(context).open({"path": "notes/import-md.md"})

    assert result == {"title": "import-md", "path": source.resolve()}
    assert organizer.organize_calls == []
    assert context.fixed_documents.activated == ["rich"]


def test_external_import_organizes_file_before_opening(tmp_path):
    notes = tmp_path / "notes"
    notes.mkdir(parents=True)
    managed = notes / "external.md"
    managed.write_text("# imported", encoding="utf-8")
    external = tmp_path.parent / "external-source.md"
    organizer = FakeOrganizer(managed)
    context = _context(tmp_path, organizer)

    result = DocumentApplication(context).import_path(external)

    assert organizer.organize_calls == [external]
    assert result["name"] == "external.md"
    assert result["document"] == {"title": "external", "path": managed}
    assert result["opened"] is True
    assert result["view"] == "rich"


def test_rich_save_ack_does_not_echo_pen_payload_and_open_returns_one_model(tmp_path):
    from apps.documents.services.document_service import Editor
    from shared.services.preferences_service import Config
    from shared.contracts.document_model.schema import RichDocument

    editor = Editor(Config(tmp_path))
    model = RichDocument().to_dict()
    note = editor.create_rich_copy("Caderno", model)
    context = _context(tmp_path, FakeOrganizer())
    context.editor = editor
    result = DocumentApplication(context).save({
        "id": note["id"], "title": "Caderno", "revision": note["revision"],
        "content_format": "opendoc-rich-v1", "content": model,
    })
    assert result["revision"] == note["revision"] + 1
    assert "content_json" not in result
    reopened = editor.get(note["id"])
    assert reopened["content"] == model
    assert "content_json" not in reopened
    editor.stash_recovery(note["id"], "Rascunho", "", result["revision"], model, "opendoc-rich-v1")
    # Identical content is intentionally not retained as a recovery draft.
    model["blocks"] = [{"id": "p", "type": "paragraph", "children": [
        {"id": "r", "type": "text", "text": "Novo cálculo"}
    ]}]
    editor.stash_recovery(note["id"], "Rascunho", "", result["revision"], model, "opendoc-rich-v1")
    recovered = editor.get(note["id"])["recovery"]
    assert recovered["content"] == model
    assert "content_json" not in recovered

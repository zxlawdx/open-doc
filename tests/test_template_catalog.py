from docx import Document
from pptx import Presentation
from pypdf import PdfReader
from webtest import TestApp

from apps.open_doc.application.context import get_context
from apps.open_doc.services.preferences_service import Config
from config.wsgi import create_app


def test_template_library_creates_independent_native_copies(tmp_path, monkeypatch):
    import vela.core.app as runtime

    class Window:
        def __init__(self, **kwargs):
            pass

        def run(self):
            pass

    monkeypatch.setattr(runtime, "DesktopWindow", Window)
    app = create_app(Config(tmp_path / "workspace"), start_in_library=True)
    app.run()
    context = get_context()
    client = TestApp(app.api_server.app)
    headers = {"X-Open-Doc-Token": context.token}
    endpoint = "/api/open_doc/document/template"

    assert context.documents.bootstrap()["start_in_library"] is True
    all_templates = client.get("/api/open_doc/files").json["templates"]
    catalog = [template for template in all_templates if template["format"] != "xlsx"]
    assert {template["format"] for template in catalog} == {"docx", "pptx", "pdf"}
    client.post_json(endpoint, {"id": "field-report"}, status=403)
    client.post_json(endpoint, {"id": "../../file"}, headers=headers, status=400)

    created = set()
    for template in catalog:
        data = {"id": template["id"]}
        first = client.post_json(endpoint, data, headers=headers).json
        second = client.post_json(endpoint, data, headers=headers).json
        assert first["id"] != second["id"]
        created.update((first["id"], second["id"]))
        assert first["title"] == second["title"] == template["title"]
        identifier, revision = first["id"], first["revision"]
        destination = tmp_path / template["id"]
        if template["format"] == "docx":
            context.exports.export(identifier, revision, "docx", destination)
            paragraphs = Document(destination.with_suffix(".docx")).paragraphs
            assert template["title"] in [paragraph.text for paragraph in paragraphs]
        elif template["format"] == "pptx":
            assert first["capabilities"]["edit_slides"]
            assert first["content"]["surfaces"][0]["elements"]
            assert "preserve_source" not in first["content"]
            context.fixed_documents.export(identifier, revision, "pptx", destination)
            slides = Presentation(destination.with_suffix(".pptx")).slides
            assert len(slides) == len(template["sections"]) + 1
            assert any(shape.text == template["title"] for shape in slides[0].shapes)
        else:
            assert first["capabilities"]["ink"]
            source = context.fixed_documents.source(identifier)
            assert len(PdfReader(source).pages) == 1
            context.fixed_documents.export(identifier, revision, "pdf", destination)
            assert template["title"] in PdfReader(destination.with_suffix(".pdf")).pages[0].extract_text()

    library = client.get("/api/open_doc/files").json
    assert library["templates"] == all_templates
    assert not library["files"]
    assert created <= {document["id"] for document in library["documents"]}

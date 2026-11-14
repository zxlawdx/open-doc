from base64 import b64decode

from config.composition import configure
from shared.services.preferences_service import Config


def test_preview_catalog_and_independent_personal_snapshots(tmp_path):
    ctx = configure(Config(tmp_path))
    catalog = ctx.documents.list_library()["templates"]
    for template in catalog:
        preview = ctx.templates.preview(template["id"])
        fmt = template["format"]
        assert preview["format"] == fmt
        if fmt == "pdf":
            assert b64decode(preview["bytes"]).startswith(b"%PDF")
        elif fmt == "pptx":
            assert b64decode(preview["bytes"]).startswith(b"PK")
        elif fmt == "docx":
            assert preview["content"]["blocks"]
        else:
            assert preview["sheets"][0]["cells"]
        if fmt == "xlsx":
            original = ctx.workbooks.create("Origem", preview["sheets"])
        else:
            original = ctx.documents.create_from_template(template["id"])
        saved = ctx.templates.save(original["id"], "Modelo pessoal", fmt == "xlsx")
        assert saved["id"] != original["id"]
        assert saved["format"] == fmt
        assert saved["id"] not in {item["id"] for item in ctx.documents.list_library()["documents"]}
        copy = ctx.documents.create_from_template(saved["id"])
        assert copy["id"] not in {saved["id"], original["id"]}
        assert copy["title"] == "Modelo pessoal"
        assert ctx.templates.preview(saved["id"])["format"] == fmt

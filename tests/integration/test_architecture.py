from __future__ import annotations

import ast
from pathlib import Path

from vela.core.router import Router

from apps.home.app import HOME_APP
from shared.contracts.domain import DocumentFormat, DocumentRef
from apps.home.views.editor import workspace_view
from config.settings import ASSETS

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "shared"
FORBIDDEN_FRAMEWORKS = {"vela", "bottle", "webview", "pywebview"}


def _imports(path: Path) -> set[str]:
    result: set[str] = set()
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            result.add(node.module)
    return result


def _framework_offenders(root: Path) -> list[str]:
    offenders = []
    for path in root.rglob("*.py"):
        for imported in _imports(path):
            if imported.split(".", 1)[0] in FORBIDDEN_FRAMEWORKS:
                offenders.append(f"{path.relative_to(ROOT)} -> {imported}")
    return offenders


def test_domain_is_independent_from_vela_and_webview():
    assert _framework_offenders(APP / "contracts/domain") == []


def test_canonical_document_model_is_independent_from_vela_and_webview():
    assert _framework_offenders(APP / "contracts/document_model") == []


def test_application_does_not_depend_on_webview_or_bottle():
    assert _framework_offenders(ROOT / "apps/documents/services") == []


def test_bridge_delegates_document_rules_to_application_facade():
    text = (ROOT / "config" / "bridge.py").read_text(encoding="utf-8")
    assert "services().editor" not in text
    assert "services().fixed_documents" not in text
    assert "import_docx" not in text
    assert "import_pdf" not in text


def test_wsgi_does_not_import_bottle_directly():
    imports = _imports(ROOT / "config" / "wsgi.py")
    assert not any(name == "bottle" or name.startswith("bottle.") for name in imports)


def test_legacy_vela_transport_workaround_is_removed():
    assert not (APP / "infrastructure" / "vela_compat.py").exists()


def test_collectstatic_is_the_declared_asset_entrypoint():
    assert ASSETS["node"]["install"] == "ci"
    assert ASSETS["node"]["scripts"] == ["build:vendor"]
    assert ASSETS["hooks"] == ["tools.build_css:main"]
    assert ASSETS["tailwind"] is False


def test_composed_local_partials_survive_vela_autoescape():
    html = workspace_view({"router": Router()})
    assert '<div class="toolbar"' in html
    assert "data-paragraph" in html
    assert "data-document-body" in html
    assert "&lt;div class=&quot;toolbar&quot;" not in html


def test_document_value_objects_are_framework_free():
    assert DocumentFormat.PDF.value == "pdf"
    assert DocumentRef("abc", 2).revision == 2


def test_app_definition_is_explicit():
    assert HOME_APP.module == "apps.home"
    assert HOME_APP.api_module.endswith(".api")


def test_workspace_context_is_published_only_after_services_initialize(
    tmp_path, monkeypatch
):
    import pytest

    from config.composition import configure, get_context
    from apps.data.services.store import Datasets
    from shared.services.preferences_service import Config

    active = configure(Config(tmp_path / "active"))

    def fail(_):
        raise OSError("Dataset initialization failed")

    monkeypatch.setattr(Datasets, "initialize", fail)
    with pytest.raises(OSError, match="Dataset initialization failed"):
        configure(Config(tmp_path / "failed"))
    assert get_context() is active

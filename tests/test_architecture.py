from __future__ import annotations

import ast
from pathlib import Path

from apps.open_doc.app import OPEN_DOC_APP
from apps.open_doc.domain import DocumentFormat, DocumentRef

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps" / "open_doc"


def _imports(path: Path) -> set[str]:
    result: set[str] = set()
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            result.add(node.module)
    return result


def test_domain_is_independent_from_vela_and_webview():
    offenders = []
    for path in (APP / "domain").rglob("*.py"):
        for imported in _imports(path):
            if imported.split(".", 1)[0] in {"vela", "bottle", "webview", "pywebview"}:
                offenders.append(f"{path.relative_to(ROOT)} -> {imported}")
    assert offenders == []


def test_application_does_not_depend_on_webview_or_bottle():
    offenders = []
    for path in (APP / "application").rglob("*.py"):
        for imported in _imports(path):
            if imported.split(".", 1)[0] in {"vela", "bottle", "webview", "pywebview"}:
                offenders.append(f"{path.relative_to(ROOT)} -> {imported}")
    assert offenders == []


def test_bridge_delegates_document_rules_to_application_facade():
    text = (APP / "bridge.py").read_text(encoding="utf-8")
    assert "services().editor" not in text
    assert "services().fixed_documents" not in text
    assert "import_docx" not in text
    assert "import_pdf" not in text


def test_wsgi_does_not_import_bottle_directly():
    imports = _imports(ROOT / "config" / "wsgi.py")
    assert not any(name == "bottle" or name.startswith("bottle.") for name in imports)


def test_legacy_vela_transport_workaround_is_isolated_in_infrastructure():
    compat = APP / "infrastructure" / "vela_compat.py"
    assert "from bottle import BaseRequest" in compat.read_text(encoding="utf-8")
    assert "BaseRequest.MEMFILE_MAX" in compat.read_text(encoding="utf-8")


def test_document_value_objects_are_framework_free():
    assert DocumentFormat.PDF.value == "pdf"
    assert DocumentRef("abc", 2).revision == 2


def test_app_definition_is_explicit():
    assert OPEN_DOC_APP.module == "apps.open_doc"
    assert OPEN_DOC_APP.api_module.endswith(".api")

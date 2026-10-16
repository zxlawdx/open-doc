"""A implementação pertence ao app descoberto pelo Vela."""

import ast
from pathlib import Path


def test_vela_structure():
    root = Path(__file__).resolve().parents[1]
    for path in ["app", "ui", "tools/sync_frontend.py"]:
        assert not (root / path).exists()
    for path in ["templates", "static", "services", "views", "parsers/docx"]:
        assert (root / "apps/open_doc" / path).is_dir()
    for file in [
        *root.glob("apps/**/*.py"),
        *root.glob("config/*.py"),
        root / "manage.py",
        root / "launcher.py",
    ]:
        for node in ast.walk(ast.parse(file.read_text())):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith("app.")
            if isinstance(node, ast.Import):
                assert all(not n.name.startswith("app.") for n in node.names)
    assert "sync_frontend" not in (root / "manage.py").read_text()

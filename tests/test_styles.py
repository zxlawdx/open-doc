"""Visual architecture contracts; behavior and geometry are checked in Qt."""

import re
from pathlib import Path
from tools.audit_css import audit
from tools.build_css import STYLE_ORDER

ROOT = Path(__file__).resolve().parents[1]


def test_css_tokens_and_order():
    assert not audit()
    source = ROOT / "apps/open_doc/styles"
    assert set(STYLE_ORDER) == {file.name for file in source.glob("*.css")}
    assert STYLE_ORDER[0] == "tokens.css"
    assert STYLE_ORDER[-2:] == ("responsive.css", "utilities.css")
    generated = (ROOT / "apps/open_doc/static/css/main.css").read_text()
    assert generated.endswith(
        "\n".join((source / name).read_text() for name in STYLE_ORDER) + "\n"
    )


def test_css_compatibility_and_single_toolbar_definition():
    source = ROOT / "apps/open_doc/styles"
    for file in source.glob("*.css"):
        value = re.sub(r"/\*.*?\*/", "", file.read_text(), flags=re.S)
        assert not re.search(r"@layer|@container|:has\(|subgrid", value)
        if file.name != "responsive.css":
            assert "@media" not in value
    toolbar = (source / "toolbar.css").read_text()
    assert toolbar.count(".open-doc .toolbar {") == 1
    assert "flex-wrap: nowrap" in toolbar


def test_missing_token_is_detected(tmp_path):
    source = tmp_path / "apps/open_doc/styles"
    source.mkdir(parents=True)
    (tmp_path / "apps/open_doc/static/js").mkdir(parents=True)
    (source / "example.css").write_text(".example { color: var(--missing, red); }")
    assert audit(tmp_path) == ["apps/open_doc/styles/example.css: --missing"]

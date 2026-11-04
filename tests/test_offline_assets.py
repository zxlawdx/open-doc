"""Offline local asset preparation must not require Node or bypass Vela."""

from __future__ import annotations

import hashlib
from pathlib import Path
from shutil import copyfile

from tools.check_runtime_assets import source_hash
from tools.offline_assets import ROOT, STYLE_ORDER, _existing_tailwind_css, prepare


def test_vendor_source_hash_is_unchanged_by_windows_line_endings(tmp_path: Path):
    script = tmp_path / "tools/build_vendor_js.mjs"
    script.parent.mkdir(parents=True)
    lock = tmp_path / "package-lock.json"
    script.write_bytes(b"// hello\nconst x = 1;\n")
    lock.write_bytes(b'{"lockfileVersion":3}\n')
    expected = hashlib.sha256(script.read_bytes() + b"\0" + lock.read_bytes()).hexdigest()
    assert source_hash(tmp_path) == expected
    script.write_bytes(script.read_bytes().replace(b"\n", b"\r\n"))
    lock.write_bytes(lock.read_bytes().replace(b"\n", b"\r\n"))
    assert source_hash(tmp_path) == expected


def test_checked_in_css_contains_usable_compiled_tailwind():
    compiled = _existing_tailwind_css(ROOT)
    assert "--tw-" in compiled
    assert ".flex" in compiled
    assert "semantic-overlays" not in compiled


def test_prepare_uses_vela_collector_without_node(monkeypatch, tmp_path: Path):
    styles = tmp_path / "apps/open_doc/styles"
    styles.mkdir(parents=True)
    for name in STYLE_ORDER:
        copyfile(ROOT / "apps/open_doc/styles" / name, styles / name)

    css = tmp_path / "apps/open_doc/static/css/main.css"
    css.parent.mkdir(parents=True)
    original = (ROOT / "apps/open_doc/static/css/main.css").read_text("utf-8")
    css.write_text(original, encoding="utf-8")

    import tools.offline_assets as module
    import vela.cli.collectstatic as collector

    monkeypatch.setattr(module, "validate_vendor", lambda root: {"files": {}})
    monkeypatch.setattr(module, "check", lambda root: {"files": {}})
    called = {}

    def fake_collect_static(**kwargs):
        called.update(kwargs)
        return {"errors": 0}

    monkeypatch.setattr(collector, "collect_static", fake_collect_static)
    prepare(tmp_path)

    assert called["asset_config"] == {"tailwind": False}
    assert called["skip_tailwind"] is True
    assert called["allow_install"] is False
    assert "semantic-overlay" in css.read_text("utf-8")
    assert "--tw-" in (tmp_path / "staticfiles/css/vela.bundle.css").read_text("utf-8")

"""Offline local asset preparation must not require Node or bypass Vela."""

from __future__ import annotations

import hashlib
from pathlib import Path
from shutil import copyfile

import subprocess
import sys


def test_offline_script_bootstraps_project_imports():
    result = subprocess.run(
        [sys.executable, "tools/offline_assets.py", "--help"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "prepare" in result.stdout


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


def test_real_vela_offline_collectstatic_runs_without_node(tmp_path: Path, monkeypatch):
    """Exercise actual Vela copy/manifest flow with PATH containing no Node."""
    from shutil import copytree
    from tools.check_runtime_assets import check

    for rel in ["apps/open_doc/static", "apps/open_doc/styles"]:
        copytree(ROOT / rel, tmp_path / rel)
    for rel in ["tools/build_vendor_js.mjs", "package-lock.json"]:
        dest = tmp_path / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        copyfile(ROOT / rel, dest)

    monkeypatch.setenv("PATH", "")
    prepare(tmp_path)
    assert check(tmp_path)["target"] == "chrome83"
    generated = tmp_path / "staticfiles/open_doc/css/main.css"
    assert generated.is_file()
    assert "semantic-overlay" in generated.read_text(encoding="utf-8")

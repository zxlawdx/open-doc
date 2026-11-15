"""Offline local asset preparation must not require Node or bypass Vela."""

from __future__ import annotations

import hashlib
import json
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


from tools.check_runtime_assets import BUNDLES, repair_vendor_line_endings, source_hash
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
    styles = tmp_path / "apps/home/styles"
    styles.mkdir(parents=True)
    for name in STYLE_ORDER:
        copyfile(ROOT / "apps/home/styles" / name, styles / name)

    css = tmp_path / "apps/home/static/css/main.css"
    css.parent.mkdir(parents=True)
    original = (ROOT / "apps/home/static/css/main.css").read_text("utf-8")
    css.write_text(original, encoding="utf-8")

    import tools.offline_assets as module
    import vela.cli.collectstatic as collector

    monkeypatch.setattr(module, "repair_vendor_line_endings", lambda root: [])
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
    assert css.read_text("utf-8") == original
    runtime = tmp_path / "apps/home/static/css/runtime.css"
    assert runtime.is_file()
    assert "--tw-" in runtime.read_text(encoding="utf-8")
    assert "semantic-overlay" in runtime.read_text(encoding="utf-8")
    assert "--tw-" in (tmp_path / "staticfiles/css/vela.bundle.css").read_text("utf-8")


def test_real_vela_offline_collectstatic_runs_without_node(tmp_path: Path, monkeypatch):
    """Exercise actual Vela copy/manifest flow with PATH containing no Node."""
    from shutil import copytree
    from tools.check_runtime_assets import check

    for rel in ["apps/home/static", "apps/home/styles"]:
        copytree(ROOT / rel, tmp_path / rel)
    for rel in ["tools/build_vendor_js.mjs", "package-lock.json"]:
        dest = tmp_path / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        copyfile(ROOT / rel, dest)

    monkeypatch.setenv("PATH", "")
    prepare(tmp_path)
    assert check(tmp_path)["target"] == "chrome83"
    generated = tmp_path / "staticfiles/home/css/runtime.css"
    assert generated.is_file()
    assert "semantic-overlay" in generated.read_text(encoding="utf-8")



def _vendor_fixture(tmp_path: Path) -> tuple[Path, dict[str, bytes]]:
    """Minimal four-bundle manifest; mirrors the verified SHA-256 format."""
    vendor = tmp_path / "apps/home/static/js/vendor"
    vendor.mkdir(parents=True)
    contents = {
        name: (f"window.fixture={i};\n").encode("ascii")
        for i, name in enumerate(BUNDLES)
    }
    for name, data in contents.items():
        (vendor / name).write_bytes(data)
    (vendor / "vendor-manifest.json").write_text(
        json.dumps({"files": {
            name: hashlib.sha256(data).hexdigest()
            for name, data in contents.items()
        }}),
        encoding="utf-8",
    )
    return vendor, contents


def test_repair_vendor_windows_crlf_only_when_sha_matches(tmp_path: Path):
    vendor, contents = _vendor_fixture(tmp_path)
    path = vendor / "pdf.bundle.js"
    path.write_bytes(contents["pdf.bundle.js"].replace(b"\n", b"\r\n"))
    assert path.read_bytes() != contents["pdf.bundle.js"]

    repaired = repair_vendor_line_endings(tmp_path)
    assert repaired == ["pdf.bundle.js"]
    assert path.read_bytes() == contents["pdf.bundle.js"]
    assert repair_vendor_line_endings(tmp_path) == []


def test_repair_vendor_refuses_corrupt_code_without_touching_other_bundles(tmp_path: Path):
    vendor, contents = _vendor_fixture(tmp_path)
    converted = vendor / "pdf.bundle.js"
    converted.write_bytes(contents["pdf.bundle.js"].replace(b"\n", b"\r\n"))
    corrupted = vendor / "pptx.bundle.js"
    corrupted.write_bytes(b"window.intruder=true;\r\n")

    import pytest

    with pytest.raises(RuntimeError, match="reparação automática recusada"):
        repair_vendor_line_endings(tmp_path)
    # All bundle hashes must pass before a single file is rewritten.
    assert converted.read_bytes().endswith(b"\r\n")
    assert corrupted.read_bytes() == b"window.intruder=true;\r\n"


def test_prebuilt_bundles_stay_binary_in_git_attributes():
    attributes = (ROOT / ".gitattributes").read_text("utf-8")
    assert "apps/home/static/js/vendor/*.bundle.js -text" in attributes

"""Reject partial groups and stale build inputs instead of silently using old JS."""

from pathlib import Path
import shutil
import pytest
from tools.check_runtime_assets import check, ROOT


def test_runtime_assets_release_manifest():
    manifest = check()
    assert manifest["versions"]["pdfjs-dist"] == "4.10.38"


def test_partial_vendor_group_is_rejected(tmp_path):
    root = tmp_path / "app"
    vendor = root / "apps/open_doc/static/js/vendor"
    vendor.mkdir(parents=True)
    (vendor / ".build-failed").write_text("interrupted")
    with pytest.raises(RuntimeError, match="último build"):
        check(root)


def test_tampered_bundle_is_rejected(tmp_path):
    root = tmp_path / "app"
    for relative in [
        "tools/build_vendor_js.mjs",
        "package-lock.json",
        "apps/open_doc/static/css/main.css",
    ]:
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, destination)
    shutil.copytree(
        ROOT / "apps/open_doc/static/js/vendor",
        root / "apps/open_doc/static/js/vendor",
        dirs_exist_ok=True,
    )
    (root / "apps/open_doc/static/js/vendor/pdf.bundle.js").write_text("stale")
    with pytest.raises(RuntimeError, match="Bundle inconsistente"):
        check(root)

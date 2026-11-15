"""Regression tests for frozen Open Doc asset validation."""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from tools import check_runtime_assets as assets


class FrozenAssetValidationTests(TestCase):
    def test_frozen_bundle_needs_no_build_sources(self):
        with TemporaryDirectory() as location:
            root = Path(location)
            vendor = root / "apps/home/static/js/vendor"
            vendor.mkdir(parents=True)
            hashes = {}
            for name in assets.BUNDLES:
                data = ("bundle: " + name).encode("utf-8")
                (vendor / name).write_bytes(data)
                hashes[name] = hashlib.sha256(data).hexdigest()
            (vendor / "vendor-manifest.json").write_text(
                json.dumps({
                    "target": "chrome83",
                    "source_hash": "not-available-at-runtime",
                    "files": hashes,
                    "versions": {},
                    "build_hash": "test",
                }), encoding="utf-8")
            (root / "apps/home/static/css").mkdir(parents=True)
            (root / "apps/home/static/css/main.css").write_text("body{}")
            (root / "apps/home/static/css/runtime.css").write_text("body{}")
            (root / "staticfiles/home/css").mkdir(parents=True)
            (root / "staticfiles/home/css/runtime.css").write_text("body{}")
            (root / "staticfiles/css").mkdir(parents=True)
            (root / "staticfiles/css/vela.bundle.css").write_text("body{}")
            with patch.object(assets.sys, "frozen", True, create=True):
                self.assertEqual(assets.check(root)["target"], "chrome83")

            # Corrupted vendor files must still be rejected in production.
            (vendor / assets.BUNDLES[0]).write_bytes(b"tampered")
            with patch.object(assets.sys, "frozen", True, create=True):
                with self.assertRaises(RuntimeError):
                    assets.check(root)

    def test_dev_still_requires_source_inputs(self):
        with TemporaryDirectory() as location:
            root = Path(location)
            vendor = root / "apps/home/static/js/vendor"
            vendor.mkdir(parents=True)
            (vendor / "vendor-manifest.json").write_text(
                json.dumps({"target": "chrome83", "source_hash": "old", "files": {}}),
                encoding="utf-8")
            with patch.object(assets.sys, "frozen", False, create=True):
                with self.assertRaises(RuntimeError):
                    assets.validate_vendor(root)

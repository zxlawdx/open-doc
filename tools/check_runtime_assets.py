"""Reject stale or partial local vendor groups before starting Vela."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def check(root=ROOT):
    vendor = root / "apps/open_doc/static/js/vendor"
    try:
        if (vendor / ".build-failed").exists():
            raise ValueError("O último build falhou ou foi interrompido.")
        manifest = json.loads((vendor / "vendor-manifest.json").read_text())
        source = hashlib.sha256(
            (root / "tools/build_vendor_js.mjs").read_bytes()
            + b"\0"
            + (root / "package-lock.json").read_bytes()
        ).hexdigest()
        if manifest["source_hash"] != source or manifest["target"] != "chrome87":
            raise ValueError("Manifesto de vendor desatualizado.")
        for name in [
            "pdf.bundle.js",
            "pdf.worker.bundle.js",
            "freehand.bundle.js",
            "pptx.bundle.js",
        ]:
            if (
                hashlib.sha256((vendor / name).read_bytes()).hexdigest()
                != manifest["files"][name]
            ):
                raise ValueError("Bundle inconsistente: " + name)
        if not (root / "apps/open_doc/static/css/main.css").is_file():
            raise ValueError("CSS ausente.")
        return manifest
    except (KeyError, ValueError, OSError) as exc:
        raise RuntimeError(
            "Assets locais indisponíveis. Execute npm ci e npm run build. " + str(exc)
        ) from exc


if __name__ == "__main__":
    print(json.dumps(check(), ensure_ascii=False))

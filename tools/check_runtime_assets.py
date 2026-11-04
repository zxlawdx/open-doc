"""Validate Open Doc's checked-in vendor bundles before the Vela desktop starts.

The manifest is generated with LF on CI. On Windows a Git checkout may convert
the two text inputs to CRLF, which must not invalidate identical source files.
"""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLES = (
    "pdf.bundle.js",
    "pdf.worker.bundle.js",
    "freehand.bundle.js",
    "pptx.bundle.js",
)


def source_hash(root: Path = ROOT) -> str:
    """Hash normalized source text, matching the LF checkout used for builds."""
    source = (root / "tools/build_vendor_js.mjs").read_bytes().replace(b"\r\n", b"\n")
    lock = (root / "package-lock.json").read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(source + b"\0" + lock).hexdigest()


def validate_vendor(root: Path = ROOT) -> dict:
    """Validate all prebuilt JS bytes; no Node executable is required."""
    vendor = root / "apps/open_doc/static/js/vendor"
    try:
        if (vendor / ".build-failed").exists():
            raise ValueError("O último build falhou ou foi interrompido.")
        manifest = json.loads((vendor / "vendor-manifest.json").read_text("utf-8"))
        if manifest["source_hash"] != source_hash(root) or manifest["target"] != "chrome83":
            raise ValueError("Manifesto de vendor desatualizado.")
        for name in BUNDLES:
            if (
                hashlib.sha256((vendor / name).read_bytes()).hexdigest()
                != manifest["files"][name]
            ):
                raise ValueError("Bundle inconsistente: " + name)
        return manifest
    except (KeyError, ValueError, OSError) as exc:
        raise RuntimeError(
            "Bundles locais indisponíveis ou incompatíveis. "
            "É necessário usar assets pré-compilados para esta versão ou compilar com Node. "
            + str(exc)
        ) from exc


def check(root: Path = ROOT) -> dict:
    """Validate vendor and the two CSS files expected by Vela's HTTP shell."""
    manifest = validate_vendor(root)
    try:
        if not (root / "apps/open_doc/static/css/main.css").is_file():
            raise ValueError("CSS ausente.")
        if not (root / "staticfiles/css/vela.bundle.css").is_file():
            raise ValueError("CSS offline do shell Vela ausente.")
        return manifest
    except (OSError, ValueError) as exc:
        raise RuntimeError(
            "Assets locais indisponíveis. Execute `python manage.py collectstatic` "
            "ou `python tools/offline_assets.py prepare`. " + str(exc)
        ) from exc


if __name__ == "__main__":
    print(json.dumps(check(), ensure_ascii=False))

"""Validate Open Doc's checked-in vendor bundles before the Vela desktop starts.

The manifest is generated with LF on CI. On Windows a Git checkout may convert
the two text inputs to CRLF, which must not invalidate identical source files.
"""

import hashlib
import json
import os
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


def source_hashes(root: Path = ROOT) -> set[str]:
    """Accept a genuinely built native-CRLF manifest OR the LF source build.

    Node's builder hashes the raw checkout bytes. Windows can produce CRLF
    output, while our checked-in assets were compiled using LF on Linux.
    """
    source = (root / "tools/build_vendor_js.mjs").read_bytes()
    lock = (root / "package-lock.json").read_bytes()
    return {
        hashlib.sha256(source + b"\0" + lock).hexdigest(),
        source_hash(root),
    }


def repair_vendor_line_endings(root: Path = ROOT) -> list[str]:
    """Restore checked-in bundle bytes only when Git converted LF to CRLF.

    The manifest's SHA-256 is still authoritative. Convert bytes only if
    changing CRLF back to LF produces the exact expected digest. Never repair
    a genuinely different bundle or mask a partial/interrupted build.
    All files are verified before any write, so failures leave them untouched.
    """
    vendor = root / "apps/open_doc/static/js/vendor"
    if (vendor / ".build-failed").exists():
        raise RuntimeError("Build de vendor interrompido; não restaurar automaticamente.")
    try:
        manifest = json.loads((vendor / "vendor-manifest.json").read_text("utf-8"))
        expected_hashes = manifest["files"]
        corrections: dict[Path, bytes] = {}
        for name in BUNDLES:
            path = vendor / name
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() == expected_hashes[name]:
                continue
            canonical = data.replace(b"\r\n", b"\n")
            if (
                canonical == data
                or hashlib.sha256(canonical).hexdigest() != expected_hashes[name]
            ):
                raise RuntimeError(
                    f"Bundle {name} foi alterado além de CRLF/LF; "
                    "reparação automática recusada. "
                    "Verifique git status e recupere o arquivo original."
                )
            corrections[path] = canonical
    except (OSError, KeyError, ValueError) as exc:
        raise RuntimeError("Não foi possível conferir os bundles do Git.") from exc

    for path, data in corrections.items():
        temporary = path.with_name(path.name + ".lf-repair.tmp")
        try:
            temporary.write_bytes(data)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    return [path.name for path in corrections]


def validate_vendor(root: Path = ROOT) -> dict:
    """Validate all prebuilt JS bytes; no Node executable is required."""
    vendor = root / "apps/open_doc/static/js/vendor"
    try:
        if (vendor / ".build-failed").exists():
            raise ValueError("O último build falhou ou foi interrompido.")
        manifest = json.loads((vendor / "vendor-manifest.json").read_text("utf-8"))
        if manifest["source_hash"] not in source_hashes(root) or manifest["target"] != "chrome83":
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

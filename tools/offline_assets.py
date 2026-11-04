"""Pack and install reproducible Open Doc frontend assets without local Node.js.

The package is built by GitHub Actions using Vela's official collectstatic,
not by a second asset builder. Installation copies vetted compiled files only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from tools.check_runtime_assets import check

ROOT = Path(__file__).resolve().parents[1]
METADATA = "open-doc-prebuilt.json"
FORMAT = "open-doc-prebuilt-v1"
MAX_TOTAL_BYTES = 180 * 1024 * 1024
MAX_FILE_BYTES = 60 * 1024 * 1024
MAX_FILES = 1000
REQUIRED = {
    "apps/open_doc/static/css/main.css",
    "apps/open_doc/static/js/vendor/vendor-manifest.json",
    "staticfiles/css/vela.bundle.css",
    "staticfiles/open_doc/css/main.css",
    "staticfiles/open_doc/js/vendor/vendor-manifest.json",
}


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_fingerprint(root: Path = ROOT) -> str:
    """Fingerprint inputs affecting browser assets, not the current Git SHA.

    This allows an archive made on a PR to work after a squash merge so long
    as the underlying application/frontend inputs did not change.
    """
    candidates = [
        "package-lock.json",
        "package.json",
        "tailwind.config.js",
        "tools/build_vendor_js.mjs",
        "tools/build_css.py",
        "config/settings.py",
    ]
    for relative in (
        "apps/open_doc/styles",
        "apps/open_doc/templates",
        "apps/open_doc/static/js",
    ):
        directory = root / relative
        if directory.is_dir():
            candidates.extend(
                path.relative_to(root).as_posix()
                for path in directory.rglob("*")
                if path.is_file()
                and "vendor" not in path.relative_to(directory).parts
            )
    h = hashlib.sha256()
    for name in sorted(set(candidates)):
        path = root / name
        if not path.is_file():
            raise RuntimeError(f"Fonte ausente para pacote offline: {name}")
        data = path.read_bytes()
        h.update(name.encode("utf-8") + b"\0")
        h.update(len(data).to_bytes(8, "big"))
        h.update(data)
    return h.hexdigest()


def _permitted(name: str) -> bool:
    path = PurePosixPath(name)
    if (
        not name
        or name != path.as_posix()
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
        or "\\" in name
    ):
        return False
    return (
        name.startswith("staticfiles/")
        or name.startswith("apps/open_doc/static/js/vendor/")
        or name == "apps/open_doc/static/css/main.css"
    )


def _compiled_files(root: Path) -> list[Path]:
    files = sorted(path for path in (root / "staticfiles").rglob("*") if path.is_file())
    files += sorted(
        path
        for path in (root / "apps/open_doc/static/js/vendor").rglob("*")
        if path.is_file()
    )
    files.append(root / "apps/open_doc/static/css/main.css")
    for path in files:
        if not _permitted(path.relative_to(root).as_posix()):
            raise RuntimeError(f"Arquivo não permitido no pacote offline: {path}")
    return files


def pack(output: Path, root: Path = ROOT) -> None:
    manifest = check(root)
    files = _compiled_files(root)
    hashes = {p.relative_to(root).as_posix(): _digest(p.read_bytes()) for p in files}
    if not REQUIRED.issubset(hashes):
        raise RuntimeError("Assets obrigatórios ausentes: " + repr(REQUIRED - hashes.keys()))
    metadata = {
        "schema": FORMAT,
        "source_fingerprint": source_fingerprint(root),
        "vendor_build_hash": manifest["build_hash"],
        "files": hashes,
    }
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr(METADATA, json.dumps(metadata, sort_keys=True, indent=2) + "\n")
        for path in files:
            z.write(path, path.relative_to(root).as_posix())
    print(f"Pacote offline verificado: {output} ({len(files)} arquivos)")


def install(archive: Path, *, root: Path = ROOT, verify_only: bool = False) -> None:
    """Validate all inputs and hashes BEFORE replacing any local files."""
    with zipfile.ZipFile(archive) as z:
        infos = [info for info in z.infolist() if not info.is_dir()]
        if len(infos) > MAX_FILES:
            raise RuntimeError("Pacote offline contém arquivos demais.")
        if sum(info.file_size for info in infos) > MAX_TOTAL_BYTES:
            raise RuntimeError("Pacote offline excede o tamanho máximo.")
        if any(info.file_size > MAX_FILE_BYTES for info in infos):
            raise RuntimeError("Arquivo excessivamente grande no pacote offline.")
        if len({info.filename for info in infos}) != len(infos):
            raise RuntimeError("Pacote offline contém entradas duplicadas.")
        if METADATA not in {info.filename for info in infos}:
            raise RuntimeError("Não encontrei open-doc-prebuilt.json. Baixe o ZIP interno do artefato.")
        metadata = json.loads(z.read(METADATA).decode("utf-8"))
        if metadata.get("schema") != FORMAT:
            raise RuntimeError("Formato do pacote offline incompatível.")
        if metadata.get("source_fingerprint") != source_fingerprint(root):
            raise RuntimeError(
                "Pacote offline não corresponde a esta versão do Open Doc. "
                "Atualize a branch main e baixe os assets da mesma versão."
            )
        hashes = metadata.get("files")
        if not isinstance(hashes, dict) or not REQUIRED.issubset(hashes):
            raise RuntimeError("Pacote offline sem os arquivos necessários.")
        included = {info.filename for info in infos} - {METADATA}
        if included != set(hashes) or not all(_permitted(name) for name in included):
            raise RuntimeError("Pacote offline contém caminhos inesperados ou faltando.")
        if any((info.external_attr >> 16) & 0o170000 == 0o120000 for info in infos):
            raise RuntimeError("Pacote offline não pode conter links simbólicos.")

        with tempfile.TemporaryDirectory(prefix=".open-doc-assets-", dir=root) as folder:
            stage = Path(folder)
            for name in sorted(included):
                data = z.read(name)
                if _digest(data) != hashes[name]:
                    raise RuntimeError(f"Arquivo do pacote offline adulterado: {name}")
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)

            vendor = json.loads(
                (stage / "apps/open_doc/static/js/vendor/vendor-manifest.json").read_text("utf-8")
            )
            expected_source = _digest(
                (root / "tools/build_vendor_js.mjs").read_bytes()
                + b"\0"
                + (root / "package-lock.json").read_bytes()
            )
            if vendor.get("source_hash") != expected_source:
                raise RuntimeError("Manifesto vendor do pacote não corresponde às fontes.")
            if vendor.get("build_hash") != metadata.get("vendor_build_hash"):
                raise RuntimeError("Manifesto vendor do pacote não corresponde ao artefato.")
            for name, digest in vendor.get("files", {}).items():
                compiled = stage / "apps/open_doc/static/js/vendor" / name
                if not compiled.is_file() or _digest(compiled.read_bytes()) != digest:
                    raise RuntimeError("Bundle de vendor inconsistente: " + name)

            if verify_only:
                print("Pacote offline validado, nenhum arquivo local modificado.")
                return

            for name in sorted(included):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                # Validated and staged on the same filesystem; atomic file replacement.
                os.replace(stage / name, target)

    check(root)
    print("Assets offline instalados e verificados. Execute python manage.py runapp.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    p = commands.add_parser("pack", help="Criar ZIP no CI após Vela collectstatic")
    p.add_argument("archive", type=Path)
    p = commands.add_parser("install", help="Usar ZIP pré-compilado, sem Node/npm")
    p.add_argument("archive", type=Path)
    p = commands.add_parser("verify", help="Checar ZIP sem modificar arquivos")
    p.add_argument("archive", type=Path)
    args = parser.parse_args()
    if args.action == "pack":
        pack(args.archive)
    else:
        install(args.archive, verify_only=args.action == "verify")


if __name__ == "__main__":
    main()

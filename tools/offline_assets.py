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
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

# A execução "python tools/offline_assets.py prepare" não coloca a raiz do
# repositório no sys.path. Use o mesmo bootstrap do manage.py/Vela.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.build_css import STYLE_ORDER
from tools.check_runtime_assets import check, source_hash, validate_vendor
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
        data = path.read_bytes().replace(b"\r\n", b"\n")
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


def _existing_tailwind_css(root: Path) -> str:
    """Reuse the *real* compiled Tailwind already tracked in main.css.

    Only handwritten styles are reassembled. No fake/empty CSS or remote CDN.
    If the compiled base or marker disappears, fail rather than fabricate CSS.
    """
    main = (root / "apps/open_doc/static/css/main.css").read_text(encoding="utf-8")
    first_line = (
        (root / "apps/open_doc/styles/tokens.css").read_text(encoding="utf-8")
        .splitlines()[0]
    )
    cut = main.find("\n" + first_line)
    if cut <= 0:
        raise RuntimeError(
            "O CSS pré-compilado do Git não contém o cabeçalho de estilos. "
            "Use um pacote de assets gerado em outra máquina."
        )
    compiled = main[:cut]
    if "--tw-" not in compiled or ".flex" not in compiled:
        raise RuntimeError("Tailwind pré-compilado ausente ou inconsistente.")
    return compiled


def prepare(root: Path = ROOT) -> None:
    """Prepare offline runtime with the official Vela collector.

    Prebuilt JS bundles are byte-for-byte SHA-256 checked. The checked-in
    Tailwind utility base is reused, and CURRENT handwritten styles are
    reassembled (including PDF annotations). Vela itself copies all app assets.
    """
    validate_vendor(root)
    compiled = _existing_tailwind_css(root)
    custom = "\n".join(
        (root / "apps/open_doc/styles" / name).read_text(encoding="utf-8")
        for name in STYLE_ORDER
    )
    main_css = root / "apps/open_doc/static/css/main.css"
    shell_css = root / "staticfiles/css/vela.bundle.css"
    shell_css.parent.mkdir(parents=True, exist_ok=True)
    shell_css.write_text(compiled + "\n", encoding="utf-8")
    main_css.write_text(compiled + "\n" + custom + "\n", encoding="utf-8")

    # Use Vela's official API. An empty project ASSETS node configuration
    # skips npm/hooks; Vela still owns collection and static manifest creation.
    from vela.cli.collectstatic import collect_static

    old_cwd = Path.cwd()
    try:
        os.chdir(root)
        result = collect_static(
            apps_dir="apps",
            output_dir="staticfiles",
            verbose=True,
            skip_tailwind=True,
            asset_config={"tailwind": False},
            allow_install=False,
        )
    finally:
        os.chdir(old_cwd)
    if result.get("errors"):
        raise RuntimeError("Vela reportou erro ao coletar assets.")
    check(root)
    print(
        "Open Doc preparado sem Node/npm usando assets locais verificados. "
        "Execute: python manage.py runapp"
    )


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
            expected_source = source_hash(root)
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
    commands.add_parser("prepare", help="Preparar runtime offline com Vela, sem Node/npm")
    p = commands.add_parser("pack", help="Criar ZIP após preparar assets locais")
    p.add_argument("archive", type=Path)
    p = commands.add_parser("install", help="Usar ZIP pré-compilado, sem Node/npm")
    p.add_argument("archive", type=Path)
    p = commands.add_parser("verify", help="Checar ZIP sem modificar arquivos")
    p.add_argument("archive", type=Path)
    args = parser.parse_args()
    if args.action == "prepare":
        prepare()
    elif args.action == "pack":
        pack(args.archive)
    else:
        install(args.archive, verify_only=args.action == "verify")


if __name__ == "__main__":
    main()

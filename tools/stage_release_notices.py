"""Stage license notices and version-specific source references with the bundle."""

import json
import os
import shutil
import sys
from importlib.metadata import distributions, version
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    bundle = Path(sys.argv[1])
    notices = bundle / "licenses"
    notices.mkdir(exist_ok=True)
    for license_path in (ROOT / "packaging/windows").glob("*.txt"):
        shutil.copy2(license_path, notices)

    components = []
    for distribution in distributions():
        name = distribution.metadata["Name"]
        if not name:
            continue
        components.append(f"{name}=={distribution.version}")
        for relative in distribution.files or ():
            # Distribution metadata carries license notices, including transitive
            # wheels that PyInstaller may otherwise omit.
            if not relative.parts[0].endswith(".dist-info"):
                continue
            if not relative.name.upper().startswith(("LICENSE", "COPYING", "NOTICE", "AUTHORS")):
                continue
            source = distribution.locate_file(relative)
            if source.is_file():
                destination = notices / name / Path(*relative.parts[1:])
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
    (notices / "build-dependencies.txt").write_text(
        "\n".join(sorted(set(components), key=str.casefold)) + "\n", encoding="utf-8"
    )

    repo = os.environ.get("GITHUB_REPOSITORY", "zxlawdx/open-doc")
    ref = os.environ.get("GITHUB_SHA", "main")
    qt_versions = {version("PyQt5-Qt5"), version("PyQtWebEngine-Qt5")}
    qt_sources = [
        f"https://download.qt.io/archive/qt/{number.rsplit('.', 1)[0]}/{number}/single/"
        for number in sorted(qt_versions)
    ]
    vela = next(
        line.split("@")[-1].strip()
        for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
        if line.startswith("vela-framework @ ")
    )
    sources = {
        "Open Doc": f"https://github.com/{repo}/tree/{ref}",
        "Vela Framework": f"https://github.com/zxlawdx/Vela-framework/tree/{vela}",
        "CPython": f"https://github.com/python/cpython/tree/v{sys.version.split()[0]}",
        "PyQt5": f"https://pypi.org/project/PyQt5/{version('PyQt5')}/#files",
        "PyQtWebEngine": f"https://pypi.org/project/PyQtWebEngine/{version('PyQtWebEngine')}/#files",
        "Qt and Qt WebEngine source archives": qt_sources,
    }
    (notices / "sources.json").write_text(
        json.dumps(sources, indent=2) + "\n", encoding="utf-8"
    )
    (notices / "README.txt").write_text(
        "The Open Doc source is MIT-licensed. This combined binary distribution\n"
        "includes PyQt under GPL version 3 and dynamically loaded Qt libraries.\n"
        "GPL and LGPL texts are provided here. Source and build references are\n"
        "listed in sources.json. The distribution uses the GPLv3 terms for the\n"
        "combined package and preserves the individual component notices.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

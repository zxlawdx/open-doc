"""Available system/bundled fonts; no proprietary font redistribution or downloads."""


def available_font_families():
    fonts = set()
    try:
        from PyQt5.QtWidgets import QApplication
        from PyQt5.QtGui import QFontDatabase

        if QApplication.instance():
            fonts.update(QFontDatabase().families())
    except ImportError:
        pass
    if not fonts:
        import subprocess

        try:
            output = subprocess.run(
                ["fc-list", "--format=%{family}\\n"],
                capture_output=True,
                text=True,
                timeout=5,
                check=True,
            ).stdout
            fonts.update(
                n.strip()
                for line in output.splitlines()
                for n in line.split(",")
                if n.strip()
            )
        except (OSError, subprocess.SubprocessError):
            pass
    return sorted(fonts | {"Inter"}, key=str.casefold)


class FontService:
    """Catálogo persistente de fontes locais, validado com FontTools."""

    def __init__(self, config):
        import threading

        self.directory = config.root / ".veladata" / "fonts"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.index = self.directory / "index.json"
        self.lock = threading.RLock()
        self.registered = {}
        self.reload()

    def _read(self):
        import json

        import re

        entries = (
            json.loads(self.index.read_text(encoding="utf-8")).get("fonts", [])
            if self.index.exists()
            else []
        )
        if not isinstance(entries, list):
            raise ValueError("Catálogo de fontes inválido.")
        for entry in entries:
            digest = entry.get("sha256", "")
            if not re.fullmatch("[a-f0-9]{64}", digest) or entry.get(
                "filename"
            ) not in {digest + ext for ext in [".ttf", ".otf", ".ttc"]}:
                raise ValueError("Catálogo de fontes inválido.")
        return entries

    def _write(self, fonts):
        import json, os, tempfile

        fd, name = tempfile.mkstemp(dir=self.directory, suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"fonts": fonts}, stream, ensure_ascii=False)
            os.replace(name, self.index)
        finally:
            from pathlib import Path

            Path(name).unlink(missing_ok=True)

    def _register(self, entry):
        try:
            from PyQt5.QtWidgets import QApplication
            from PyQt5.QtGui import QFontDatabase

            if QApplication.instance() and entry["id"] not in self.registered:
                font_id = QFontDatabase.addApplicationFont(
                    str(self.directory / entry["filename"])
                )
                if font_id >= 0:
                    self.registered[entry["id"]] = font_id
        except ImportError:
            pass

    def reload(self):
        with self.lock:
            for entry in self._read():
                if entry.get("enabled", True):
                    self._register(entry)
            return self.catalog()

    def catalog(self):
        with self.lock:
            imported = self._read()
            return {
                "fonts": sorted(
                    set(available_font_families()) | {f["family"] for f in imported},
                    key=str.casefold,
                ),
                "imported": imported,
            }

    def import_files(self, paths):
        import hashlib, shutil
        from fontTools.ttLib import TTFont, TTCollection

        with self.lock:
            entries = self._read()
            for path in paths:
                if (
                    path.is_symlink()
                    or path.suffix.lower() not in {".ttf", ".otf", ".ttc"}
                    or not 0 < path.stat().st_size <= 50 * 1024 * 1024
                ):
                    raise ValueError(
                        "Fonte inválida. Escolha TTF, OTF ou TTC de até 50 MB."
                    )
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                if any(e["sha256"] == digest for e in entries):
                    continue
                collection = (
                    TTCollection(str(path)) if path.suffix.lower() == ".ttc" else None
                )
                fonts = (
                    collection.fonts if collection else [TTFont(str(path), lazy=False)]
                )
                try:
                    families = []
                    for font in fonts:
                        font.ensureDecompiled()
                        family = font["name"].getDebugName(16) or font[
                            "name"
                        ].getDebugName(1)
                        if not family:
                            raise ValueError("A fonte não declara uma família válida.")
                        families.append(
                            (family, font["name"].getDebugName(2) or "Regular")
                        )
                finally:
                    for font in fonts:
                        font.close()
                filename = digest + path.suffix.lower()
                shutil.copyfile(path, self.directory / filename)
                for i, (family, style) in enumerate(families):
                    entry = {
                        "id": "sha256:" + digest + ":" + str(i),
                        "filename": filename,
                        "family": family,
                        "style": style,
                        "sha256": digest,
                        "enabled": True,
                    }
                    entries.append(entry)
                    self._register(entry)
                self._write(entries)
            return self.catalog()

    def remove(self, font_id):
        with self.lock:
            entries = self._read()
            selected = next((e for e in entries if e["id"] == font_id), None)
            if not selected:
                raise ValueError("Fonte importada não encontrada.")
            remaining = [e for e in entries if e["filename"] != selected["filename"]]
            self._write(remaining)
            for entry in entries:
                if (
                    entry["filename"] == selected["filename"]
                    and entry["id"] in self.registered
                ):
                    from PyQt5.QtGui import QFontDatabase

                    QFontDatabase.removeApplicationFont(
                        self.registered.pop(entry["id"])
                    )
            (self.directory / selected["filename"]).unlink(missing_ok=True)
            return self.catalog()

    def resolve(self, family):
        with self.lock:
            return next(
                (
                    self.directory / e["filename"]
                    for e in self._read()
                    if e["family"] == family and e.get("enabled", True)
                ),
                None,
            )

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

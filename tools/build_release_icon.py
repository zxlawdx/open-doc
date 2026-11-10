"""Rasterize the Open Doc header mark into a multi-size Windows icon."""

from io import BytesIO
from pathlib import Path

from PIL import Image
from PyQt5.QtCore import QBuffer, QIODevice, Qt
from PyQt5.QtGui import QImage, QPainter
from PyQt5.QtSvg import QSvgRenderer

ROOT = Path(__file__).resolve().parents[1]
SIZES = (16, 24, 32, 48, 64, 128, 256)


def main() -> None:
    renderer = QSvgRenderer(str(ROOT / "assets/branding/icone-atual-open-doc.svg"))
    if not renderer.isValid():
        raise ValueError("SVG da marca inválido.")
    images = []
    for size in SIZES:
        image = QImage(size, size, QImage.Format_ARGB32_Premultiplied)
        image.fill(Qt.transparent)
        painter = QPainter(image)
        renderer.render(painter)
        painter.end()
        buffer = QBuffer()
        buffer.open(QIODevice.WriteOnly)
        if not image.save(buffer, "PNG"):
            raise RuntimeError("Não foi possível rasterizar a marca.")
        images.append(Image.open(BytesIO(bytes(buffer.data()))).convert("RGBA"))
    output = ROOT / "build"
    output.mkdir(exist_ok=True)
    images[-1].save(output / "open-doc.ico", sizes=[image.size for image in images],
                    append_images=images[:-1])


if __name__ == "__main__":
    main()

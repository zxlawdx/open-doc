from pypdf import PdfReader
from .security import validated_pdf


class PdfService:
    def metadata(self, path, root=None):
        validated_pdf(path, root or path.parent)
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("PDF protegido por senha não é suportado nesta fase.")
        if not 1 <= len(reader.pages) <= 10000:
            raise ValueError("Quantidade de páginas inválida.")
        pages = []
        for i, p in enumerate(reader.pages):
            box = p.cropbox
            w, h = float(box.width), float(box.height)
            rotation = p.rotation % 360
            if rotation in [90, 270]:
                w, h = h, w
            pages.append(
                {
                    "index": i,
                    "width_pt": w,
                    "height_pt": h,
                    "rotation": rotation,
                    "strokes": [],
                    "text_overlays": [],
                }
            )
        return {"page_count": len(pages), "pages": pages}

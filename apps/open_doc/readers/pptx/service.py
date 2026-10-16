from pptx import Presentation
from ...parsers.docx.package import DocxPackage


class PresentationService:
    def metadata(self, path):
        # Apply ZIP/XML limits before python-pptx parses OOXML.
        DocxPackage.open(
            path,
            required_parts={
                "ppt/presentation.xml",
                "[Content_Types].xml",
                "_rels/.rels",
            },
        )
        doc = Presentation(path)
        if not 1 <= len(doc.slides) <= 10000:
            raise ValueError("Quantidade de slides inválida.")
        return {
            "pages": [
                {
                    "index": i,
                    "preview_kind": "pptx-native",
                    "width_pt": doc.slide_width / 12700,
                    "height_pt": doc.slide_height / 12700,
                    "strokes": [],
                    "text_overlays": [],
                }
                for i in range(len(doc.slides))
            ]
        }

"""Regression tests for real PDF operator edits (not text overlay annotations)."""
import io
import tempfile
import unittest
from pathlib import Path

import pikepdf
from PIL import Image
from pypdf import PdfReader

from apps.open_doc.readers.pdf.native_edit_engine import (
    NativePdfEditSession,
    PdfEditOperation,
    UnsupportedPdfEdit,
)


def sample_pdf(include_image=False):
    with pikepdf.Pdf.new() as pdf:
        page = pdf.add_blank_page(page_size=(400, 400))
        font = pikepdf.Dictionary(
            Type=pikepdf.Name("/Font"),
            Subtype=pikepdf.Name("/Type1"),
            BaseFont=pikepdf.Name("/Helvetica"),
            Encoding=pikepdf.Name("/WinAnsiEncoding"),
        )
        page.Resources = pikepdf.Dictionary(
            Font=pikepdf.Dictionary(F1=font)
        )
        raw = b"BT /F1 15 Tf 40 240 Td (HELLO) Tj ET\n"
        if include_image:
            image = Image.new("RGB", (3, 3), (255, 0, 0))
            memory = io.BytesIO()
            image.save(memory, format="JPEG")
            stream = pdf.make_stream(memory.getvalue())
            stream.Type = pikepdf.Name("/XObject")
            stream.Subtype = pikepdf.Name("/Image")
            stream.Width = 3
            stream.Height = 3
            stream.ColorSpace = pikepdf.Name("/DeviceRGB")
            stream.BitsPerComponent = 8
            stream.Filter = pikepdf.Name("/DCTDecode")
            page.Resources.XObject = pikepdf.Dictionary(Im1=stream)
            raw += b"q 10 0 0 10 120 120 cm /Im1 Do Q\n"
        page.Contents = pdf.make_stream(raw)
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()


class NativePdfEditTests(unittest.TestCase):
    def test_replace_changes_actual_show_text_operator_and_reopens(self):
        original = sample_pdf()
        session = NativePdfEditSession(original)
        result = session.apply(
            PdfEditOperation(
                kind="replace_literal_text",
                page=0,
                target="HELLO",
                replacement="WORLD",
            )
        )
        self.assertEqual(result["revision"], 1)
        reader = PdfReader(io.BytesIO(session.snapshot()))
        self.assertIn("WORLD", reader.pages[0].extract_text())
        self.assertNotIn("HELLO", reader.pages[0].extract_text())
        self.assertEqual(PdfReader(io.BytesIO(original)).pages[0].extract_text(), "HELLO")
        self.assertTrue(session.undo())
        self.assertIn("HELLO", PdfReader(io.BytesIO(session.snapshot())).pages[0].extract_text())
        self.assertTrue(session.redo())
        self.assertIn("WORLD", PdfReader(io.BytesIO(session.snapshot())).pages[0].extract_text())

    def test_text_insert_is_pdf_content_and_survives_reopen(self):
        session = NativePdfEditSession(sample_pdf())
        session.apply(
            PdfEditOperation(
                kind="insert_text", page=0, replacement="NATIVE", x=30, y=120
            )
        )
        self.assertIn(
            "NATIVE", PdfReader(io.BytesIO(session.snapshot())).pages[0].extract_text()
        )
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "edited.pdf"
            session.export(destination)
            self.assertIn("NATIVE", PdfReader(destination).pages[0].extract_text())

    def test_image_move_adjusts_only_isolated_graphic_transform(self):
        session = NativePdfEditSession(sample_pdf(include_image=True))
        session.apply(
            PdfEditOperation(
                kind="move_image_draw", page=0, target="/Im1", x=20, y=-5
            )
        )
        with pikepdf.Pdf.open(io.BytesIO(session.snapshot())) as pdf:
            instructions = [
                (list(ops), str(operator))
                for ops, operator in pikepdf.parse_content_stream(pdf.pages[0])
            ]
            matrices = [ops for ops, name in instructions if name == "cm"]
            self.assertEqual(len(matrices), 1)
            self.assertEqual(float(matrices[0][4]), 140)
            self.assertEqual(float(matrices[0][5]), 115)

    def test_delete_removes_real_image_draw(self):
        session = NativePdfEditSession(sample_pdf(include_image=True))
        session.apply(
            PdfEditOperation(kind="delete_image_draw", page=0, target="/Im1")
        )
        with pikepdf.Pdf.open(io.BytesIO(session.snapshot())) as pdf:
            operators = [
                str(operator)
                for _, operator in pikepdf.parse_content_stream(pdf.pages[0])
            ]
            self.assertNotIn("Do", operators)
        self.assertIn(
            "HELLO", PdfReader(io.BytesIO(session.snapshot())).pages[0].extract_text()
        )

    def test_replace_image_changes_xobject_bytes(self):
        session = NativePdfEditSession(sample_pdf(include_image=True))
        image = Image.new("RGB", (7, 4), (0, 120, 255))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        session.apply(
            PdfEditOperation(
                kind="replace_image",
                page=0,
                target="/Im1",
                image_bytes=buffer.getvalue(),
            )
        )
        with pikepdf.Pdf.open(io.BytesIO(session.snapshot())) as pdf:
            replacement = pdf.pages[0].Resources.XObject["/Im1"]
            self.assertEqual(int(replacement.Width), 7)
            self.assertEqual(int(replacement.Height), 4)

    def test_ambiguous_text_refused_atomically_and_unknown_font_refused(self):
        session = NativePdfEditSession(sample_pdf())
        old = session.snapshot()
        with self.assertRaises(UnsupportedPdfEdit):
            session.apply(
                PdfEditOperation(
                    kind="replace_literal_text", page=0,
                    target="HELLO", replacement="coração"
                )
            )
        self.assertEqual(session.snapshot(), old)
        with self.assertRaises(UnsupportedPdfEdit):
            session.apply(
                PdfEditOperation(
                    kind="replace_literal_text", page=0,
                    target="HEL", replacement="ABC"
                )
            )
        self.assertEqual(session.snapshot(), old)

    def test_invalid_page_and_unknown_image_are_rejected_without_changes(self):
        session = NativePdfEditSession(sample_pdf())
        old = session.snapshot()
        for operation in [
            PdfEditOperation(kind="insert_text", page=100, replacement="TEST"),
            PdfEditOperation(kind="delete_image_draw", page=0, target="/Unknown"),
        ]:
            with self.assertRaises(UnsupportedPdfEdit):
                session.apply(operation)
            self.assertEqual(session.snapshot(), old)


if __name__ == "__main__":
    unittest.main()

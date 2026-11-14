"""Cross-format differential-calculus regression: fractions, formulas and media.

This deliberately separates *visual fidelity* from *editable mathematics*:
a fraction image must survive import, but is not an editable equation object.
"""
from io import BytesIO
from math import isclose
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Inches as DocInches
from fpdf import FPDF
from pptx import Presentation
from pptx.util import Inches, Pt

from config.composition import configure
from shared.services.preferences_service import Config
from apps.documents.services.document_service import Editor


def examples():
    return [
        ("x²/3", lambda x: x * x / 3, lambda x: 2 * x / 3),
        ("(x²+1)/(x+1)", lambda x: (x*x+1)/(x+1),
         lambda x: (x*x+2*x-1)/(x+1)**2),
        ("x^(-1/2)", lambda x: x ** (-.5), lambda x: -.5 * x ** (-1.5)),
        ("(3x+1)/4", lambda x: (3*x+1)/4, lambda x: .75),
        ("1/(x²+1)", lambda x: 1/(x*x+1), lambda x: -2*x/(x*x+1)**2),
    ]


def test_five_derivatives_with_fractions_numerically():
    for name, function, expected in examples():
        for x in (1., 2., 4.):
            h = 1e-5
            actual = (function(x+h)-function(x-h))/(2*h)
            assert isclose(actual, expected(x), rel_tol=1e-5, abs_tol=1e-7), name


def _math_png(path):
    """Native PNG fixture: renders a fraction bar and numerator/denominator."""
    image = Image.new("RGB", (780, 230), "#F5F9FE")
    canvas = ImageDraw.Draw(image)
    # CI runners have different system fonts (Windows has Arial, Linux
    # generally has DejaVu). Pillow's built-in fallback prevents a missing
    # optional system font from failing the document interoperability test.
    font = None
    for candidate in ("DejaVuSans.ttf", "arial.ttf", "LiberationSans-Regular.ttf"):
        try:
            font = ImageFont.truetype(candidate, 48)
            break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default(size=48)
    canvas.text((65, 17), "d/dx", fill="#173A61", font=font)
    canvas.text((375, 17), "x² + 1", fill="#173A61", font=font)
    canvas.line((358, 95, 610, 95), fill="#173A61", width=4)
    canvas.text((390, 112), "x + 1", fill="#173A61", font=font)
    image.save(path)


def _pptx_fixture(path, math_png):
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    for title, _, _ in examples():
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        label = slide.shapes.add_textbox(Inches(.7), Inches(.5), Inches(11), Inches(1))
        label.text = "Derivadas com frações — " + title
        label.text_frame.paragraphs[0].font.size = Pt(32)
        slide.shapes.add_picture(str(math_png), Inches(1), Inches(1.6),
                                 width=Inches(10))
        step = slide.shapes.add_textbox(Inches(.8), Inches(4.1), Inches(11), Inches(1.5))
        step.text = "Identifique numerador e denominador; aplique a regra; simplifique."
        step.text_frame.paragraphs[0].font.size = Pt(22)
    prs.save(path)


def test_math_pptx_import_preserves_fractions_media_and_editable_text(tmp_path):
    png = tmp_path / "fraction.png"
    _math_png(png)
    source = tmp_path / "fractions.pptx"
    _pptx_fixture(source, png)
    workspace = configure(Config(tmp_path))
    original = source.read_bytes()
    note = workspace.fixed_documents.import_pptx(source)
    assert len(note["content"]["surfaces"]) == 5
    assert note["capabilities"]["edit_slides"] is True
    assert all(any(obj["type"] == "image" for obj in slide["elements"])
               for slide in note["content"]["surfaces"])
    # A readable text explanation remains editable, even though the math
    # illustration itself is an image rather than native OMML/OOXML math.
    assert all(any("Identifique" in obj.get("text", "")
                   for obj in slide["elements"])
               for slide in note["content"]["surfaces"])
    assert source.read_bytes() == original


def test_math_docx_import_keeps_explanation_and_fraction_images(tmp_path):
    png = tmp_path / "fraction.png"
    _math_png(png)
    doc = Document()
    doc.add_heading("Derivadas com frações", level=1)
    for title, _, _ in examples():
        doc.add_heading(title, level=2)
        doc.add_picture(str(png), width=DocInches(5.8))
        doc.add_paragraph("Passo 1: identifique o numerador e o denominador.")
        doc.add_paragraph("Passo 2: derive e simplifique o resultado.")
    source = tmp_path / "fractions.docx"
    doc.save(source)
    original = source.read_bytes()
    editor = Editor(Config(tmp_path / "docx-studio"))
    note = editor.import_docx(source)
    # Word deduplicates identical image bytes into a single media part.
    assert len(note["content"]["media"]) >= 1
    paragraphs = str(note["content"]["blocks"])
    assert "Passo 1" in paragraphs
    assert "Passo 2" in paragraphs
    assert source.read_bytes() == original


def test_math_pdf_import_preserves_original_source_and_text(tmp_path):
    source = tmp_path / "fractions.pdf"
    doc = FPDF()
    for title, _, _ in examples():
        doc.add_page()
        doc.set_font("Helvetica", size=16)
        doc.cell(0, 15, "Differential fractions", new_x="LMARGIN", new_y="NEXT")
        doc.set_font("Helvetica", size=13)
        doc.multi_cell(0, 12, "Step 1: numerator and denominator. Step 2: derivative.")
    doc.output(str(source))
    original = source.read_bytes()
    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.import_pdf(source)
    assert note["source_kind"] == "pdf"
    assert len(note["content"]["surfaces"]) == 5
    assert ctx.fixed_documents.source(note["id"]).read_bytes() == original
    # This smoke confirms PDF import, not editing the stacked fractions.

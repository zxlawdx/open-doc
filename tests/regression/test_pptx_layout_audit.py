"""Regression checks for the PPTX preflight used by the slide corpus."""
from pptx import Presentation
from pptx.util import Inches, Pt

from tools.pptx_layout_audit import audit_pptx


def _textbox(slide, text, *, width=3, height=1.5, size=18):
    shape = slide.shapes.add_textbox(
        Inches(.4), Inches(.4), Inches(width), Inches(height)
    )
    shape.text_frame.paragraphs[0].text = text
    shape.text_frame.word_wrap = True
    shape.text_frame.paragraphs[0].font.size = Pt(size)
    return shape


def test_pptx_layout_audit_detects_raw_latex_truncated_text_and_overflow(tmp_path):
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _textbox(slide, r"\text{Receitas primárias} - \text{Despesas}", width=4)
    _textbox(slide, "Explicação interrompida…")
    _textbox(slide, "Repetição de conteúdo com parágrafos longos. " * 14,
             width=1.4, height=.45, size=20)
    target = tmp_path / "bad-layout.pptx"
    prs.save(target)
    issues = audit_pptx(target)
    kinds = {item["kind"] for item in issues}
    assert {"literal_tex", "possible_truncation", "possible_overflow"} <= kinds


def test_pptx_layout_audit_accepts_short_complete_card_and_keeps_file(tmp_path):
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    _textbox(slide, "Receitas primárias", width=4, height=1.5, size=18)
    source = tmp_path / "read-only-audit.pptx"
    prs.save(source)
    original = source.read_bytes()
    assert audit_pptx(source) == []
    assert source.read_bytes() == original

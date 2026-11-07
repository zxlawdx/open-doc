"""Preflight for PPTX text overflows, truncated endings and raw TeX.

Read-only by design: never rewrite imported user documents. Visual assertions
remain necessary because font fallback and office renderers differ.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import ImageFont
from pptx import Presentation

_LITERAL_TEX = re.compile(r"\\(?:text|frac|begin|end)\s*\{")
_TRUNCATED = re.compile(r"(?:…|\.\.\.)\s*$")


def _font(pt, bold=False):
    size = max(9, round(pt * 110 / 72))
    for family in (("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),
                   ("LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf"),
                   "arial.ttf"):
        try:
            return ImageFont.truetype(family, size)
        except OSError:
            pass
    return None


def _line_count(text, width, font, pt):
    count = 0
    for paragraph in text.split("\n"):
        words = paragraph.split()
        if not words:
            count += 1
            continue
        line = ""
        for word in words:
            candidate = (line + " " + word).strip()
            measured = (font.getlength(candidate) if font is not None
                        else len(candidate) * pt * 110 / 72 * .55)
            if line and measured > width:
                count += 1
                line = word
            else:
                line = candidate
        count += 1
    return count


def audit_pptx(path):
    """Return diagnostic findings; measurements are estimates, not proof."""
    prs = Presentation(path)
    findings = []
    for number, slide in enumerate(prs.slides, 1):
        for index, shape in enumerate(slide.shapes):
            if not shape.has_text_frame or not shape.text.strip():
                continue
            txt = shape.text.strip()
            if _LITERAL_TEX.search(txt):
                findings.append({"slide": number, "shape": index,
                                 "kind": "literal_tex", "text": txt[:120]})
            if _TRUNCATED.search(txt):
                findings.append({"slide": number, "shape": index,
                                 "kind": "possible_truncation", "text": txt[-100:]})
            frame = shape.text_frame
            paragraph = frame.paragraphs[0]
            run = next((item for item in paragraph.runs if item.text.strip()), None)
            size = (run.font.size if run and run.font.size else None) or paragraph.font.size
            pt = float(size.pt) if size else 18.0
            bold = bool(run.font.bold if run and run.font.bold is not None else paragraph.font.bold)
            width = (shape.width - frame.margin_left - frame.margin_right) / 914400 * 110
            height = (shape.height - frame.margin_top - frame.margin_bottom) / 914400 * 110
            if min(width, height) <= 0:
                findings.append({"slide": number, "shape": index,
                                 "kind": "invalid_text_bounds"})
                continue
            n = _line_count(txt, width * .97, _font(pt, bold), pt)
            needed = n * pt * 110 / 72 * 1.20
            if needed > height * 1.09:
                findings.append({"slide": number, "shape": index,
                                 "kind": "possible_overflow", "lines": n,
                                 "font_pt": pt, "needed_px": round(needed, 1),
                                 "available_px": round(height, 1)})
    return findings


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    findings = audit_pptx(args.file)
    print(json.dumps(findings, ensure_ascii=False, indent=2))
    if args.strict and findings:
        raise SystemExit(1)

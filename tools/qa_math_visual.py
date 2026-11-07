"""Real Qt math rendering QA: PPTX, DOCX and PDF; generates screenshots.

Runs in the standard Open Doc Vela environment. It never edits original test
sources, and explicitly distinguishes image-rendered fractions from OMML math.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/"tests"))
os.chdir(ROOT)
os.environ.setdefault("PYWEBVIEW_GUI","qt")
os.environ.setdefault("QT_API","pyqt5")
os.environ.setdefault("QTWEBENGINE_REMOTE_DEBUGGING","9234")

import webview
from fpdf import FPDF
from docx import Document
from docx.shared import Inches as DocInches
from config.wsgi import create_app
from apps.open_doc.services.preferences_service import Config
from apps.open_doc.services.container import services
from test_math_differential_cross_formats import examples,_math_png,_pptx_fixture
from apps.open_doc.readers.pptx.native_math import build_word_omath


def wait(window, expression):
    for _ in range(160):
        if window.evaluate_js(expression):
            return
        time.sleep(.1)
    raise AssertionError("Qt math render did not become ready: "+expression)


def main():
    errors=[]
    commit=subprocess.check_output(["git","rev-parse","--short","HEAD"],text=True).strip()
    original=webview.start
    def qa():
        window=webview.windows[0]
        try:
            wait(window,"document.querySelector('[data-app]')?.dataset.ready==='true'")
            for kind,note in notes:
                window.evaluate_js(
                    "OpenDocApp.editor().load("+json.dumps(note,ensure_ascii=False)+")"
                )
                probe={
                    "pptx": "document.querySelector('[data-slide-editor=true] .slide-object-image')!==null",
                    "docx": "document.querySelector('[data-rich] [data-node-type=math]')!==null && document.querySelector('[data-rich]')?.textContent.includes('Passo 1')",
                    "pdf": "Array.from(document.querySelectorAll('.fixed-document .fixed-scroll .fixed-surface canvas[data-render-complete=true]')).some(c=>{const b=c.getBoundingClientRect();return b.width>80&&b.height>30})"
                }[kind]
                wait(window,probe)
                output=subprocess.run(
                    ["node",str(ROOT/"tools/qa_math_capture.cjs"),
                     os.environ["QTWEBENGINE_REMOTE_DEBUGGING"],kind,f"{sys.platform}-{commit}"],
                    capture_output=True,text=True,timeout=40
                )
                print(output.stdout,output.stderr,flush=True)
                assert output.returncode==0,(kind,output.stderr)
                print("QT_MATH_FRACTION_SCREENSHOT_"+kind.upper()+"_OK",flush=True)
        except Exception as e:
            import traceback
            traceback.print_exc()
            errors.append(str(e))
        finally:
            window.confirm_close=False
            window.destroy()
    def start(*args,**kwargs):
        original(qa,gui="qt",debug=False)
    webview.start=start
    try:
        with tempfile.TemporaryDirectory(prefix="open-doc-math-qa-") as folder:
            app=create_app(Config(Path(folder)))
            base=services().config.root
            png=base/"fraction.png"
            _math_png(png)
            pptx=base/"math-fractions.pptx"
            _pptx_fixture(pptx,png)
            docx=base/"math-fractions.docx"
            doc=Document()
            doc.add_heading("Cálculo diferencial: frações",0)
            for title,_,_ in examples():
                doc.add_heading("Derivada "+title,level=2)
                doc.add_paragraph()._p.append(build_word_omath([
                    {"kind":"fraction","numerator":"x² + 1","denominator":"x + 1"},
                    {"kind":"text","value":" = "},
                    {"kind":"nary","operator":"∫","lower":"0","upper":"π","body":"sen(x) dx"}
                ]))
                doc.add_paragraph("Passo 1: identifique numerador e denominador.")
                doc.add_paragraph("Passo 2: derive e simplifique.")
            doc.save(docx)
            pdf=base/"math-fractions.pdf"
            paper=FPDF()
            for title,_,_ in examples():
                paper.add_page()
                paper.set_font("Helvetica",size=15)
                paper.cell(0,13,"Differential calculus - fractions",new_x="LMARGIN",new_y="NEXT")
                paper.image(str(png),x=12,y=55,w=180)
                paper.set_y(135)
                paper.set_font("Helvetica",size=12)
                paper.multi_cell(0,10,"Step 1: numerator and denominator. Step 2: derive and simplify.")
            paper.output(str(pdf))
            notes=[
                ("pptx",services().fixed_documents.import_pptx(pptx)),
                ("docx",services().editor.import_docx(docx)),
                ("pdf",services().fixed_documents.import_pdf(pdf)),
            ]
            assert notes[0][1]["capabilities"]["edit_slides"]
            app.run()
    finally:
        webview.start=original
    if errors:
        raise RuntimeError("; ".join(errors))


if __name__=="__main__":
    main()

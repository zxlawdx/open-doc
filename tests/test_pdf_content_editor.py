"""Native PDF editing: bytes/operator integrity and actual round-trip extraction."""
from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image
from pikepdf import Operator, Pdf, parse_content_stream
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    DecodedStreamObject, DictionaryObject, NameObject, NumberObject
)

from apps.open_doc.readers.pdf.editing import (
    UnsafePDFEdit, apply_native_pdf_edits
)


def make_source(path: Path, *, duplicate=False, images=False, unsafe_font=False):
    writer=PdfWriter()
    page=writer.add_blank_page(width=612,height=792)
    font=DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/PrivateSubset") if unsafe_font
            else NameObject("/Helvetica"),
        NameObject("/Encoding"): NameObject("/WinAnsiEncoding")
    })
    resources=DictionaryObject({NameObject("/Font"):DictionaryObject({
        NameObject("/F1"):writer._add_object(font)
    })})
    text=b"BT /F1 16 Tf 65 700 Td (Relatorio de atividade de 2025) Tj ET\n"
    if duplicate:
        text+=b"BT /F1 16 Tf 65 675 Td (Relatorio de atividade de 2025) Tj ET\n"
    if images:
        image=DecodedStreamObject()
        image.set_data(bytes([255,0,0])*4)
        image.update({
            NameObject("/Type"):NameObject("/XObject"),
            NameObject("/Subtype"):NameObject("/Image"),
            NameObject("/Width"):NumberObject(2),
            NameObject("/Height"):NumberObject(2),
            NameObject("/BitsPerComponent"):NumberObject(8),
            NameObject("/ColorSpace"):NameObject("/DeviceRGB")
        })
        resources[NameObject("/XObject")]=DictionaryObject({
            NameObject("/Im0"):writer._add_object(image)
        })
        text+=b"q 100 0 0 60 50 300 cm /Im0 Do Q\n"
        text+=b"q 100 0 0 60 250 300 cm /Im0 Do Q\n"
    stream=DecodedStreamObject()
    stream.set_data(text)
    page[NameObject("/Resources")]=resources
    page[NameObject("/Contents")]=writer._add_object(stream)
    with path.open("wb") as out:writer.write(out)


def test_replace_existing_native_text_without_overlay(tmp_path):
    source=tmp_path/"original.pdf";result=tmp_path/"edited.pdf"
    make_source(source)
    source_bytes=source.read_bytes()
    info=apply_native_pdf_edits(source,[{
        "kind":"replace_text","page_index":0,
        "old_text":"atividade","new_text":"atividades"
    }],result)
    assert info["operations"]==1
    original=PdfReader(source).pages[0].extract_text()
    changed=PdfReader(result).pages[0].extract_text()
    assert "atividade de" in original
    assert "atividades de" in changed
    assert "atividade de" not in changed
    assert source.read_bytes()==source_bytes
    with Pdf.open(result) as pdf:
        commands=list(parse_content_stream(pdf.pages[0]))
        assert len([op for operands,op in commands if op==Operator("Tj")])==1


def test_duplicate_word_or_unknown_font_refuses_edit(tmp_path):
    source=tmp_path/"duplicate.pdf";result=tmp_path/"result.pdf"
    make_source(source,duplicate=True)
    with pytest.raises(UnsafePDFEdit,match="ambíguo"):
        apply_native_pdf_edits(source,[{
            "kind":"replace_text","page_index":0,
            "old_text":"atividade","new_text":"atividades"
        }],result)
    assert not result.exists()
    make_source(source,unsafe_font=True)
    with pytest.raises(UnsafePDFEdit,match="fonte"):
        apply_native_pdf_edits(source,[{
            "kind":"replace_text","page_index":0,
            "old_text":"atividade","new_text":"atividades"
        }],result)


def test_move_delete_and_replace_individual_shared_image_occurrence(tmp_path):
    original=tmp_path/"images.pdf";moved=tmp_path/"moved.pdf";deleted=tmp_path/"deleted.pdf"
    replacement=tmp_path/"replacement.pdf";assets=tmp_path/"assets";assets.mkdir()
    make_source(original,images=True)
    apply_native_pdf_edits(original,[{
        "kind":"move_image","page_index":0,"occurrence":0,"dx_pt":30,"dy_pt":-20
    }],moved)
    with Pdf.open(moved) as pdf:
        instructions=list(parse_content_stream(pdf.pages[0]))
        matrices=[tuple(float(v) for v in operands) for operands,op in instructions
                  if op==Operator("cm")]
        assert len(matrices)==2
        assert matrices[0][4:]==(80.0,320.0)
        assert matrices[1][4:]==(250.0,300.0)
    apply_native_pdf_edits(original,[{
        "kind":"delete_image","page_index":0,"occurrence":0
    }],deleted)
    with Pdf.open(deleted) as pdf:
        ops=[op for operands,op in parse_content_stream(pdf.pages[0])]
        assert ops.count(Operator("Do"))==1
    asset="a"*32+".png"
    Image.new("RGBA",(4,4),(0,100,200,128)).save(assets/asset)
    apply_native_pdf_edits(original,[{
        "kind":"replace_image","page_index":0,
        "occurrence":1,"asset":asset
    }],replacement,asset_directory=assets)
    with Pdf.open(replacement) as pdf:
        images=[(operands[0],op) for operands,op in parse_content_stream(pdf.pages[0])
                if op==Operator("Do")]
        assert len(images)==2
        assert images[0][0] != images[1][0]
        resource=pdf.pages[0].obj.Resources.XObject[images[1][0]]
        assert resource.Width==4 and resource.Height==4
        assert resource.SMask is not None


def test_reject_saving_over_original_and_bad_index(tmp_path):
    original=tmp_path/"one.pdf";make_source(original)
    with pytest.raises(UnsafePDFEdit):
        apply_native_pdf_edits(original,[{
            "kind":"replace_text","page_index":0,
            "old_text":"atividade","new_text":"atividades"
        }],original)
    with pytest.raises(UnsafePDFEdit):
        apply_native_pdf_edits(original,[{
            "kind":"move_image","page_index":3,"occurrence":0,
            "dx_pt":2,"dy_pt":1
        }],tmp_path/"bad.pdf")

"""Editable PowerPoint charts must keep data tables and native OOXML parts."""
from copy import deepcopy
from zipfile import ZipFile

import pytest
from pptx import Presentation

from config.composition import configure
from shared.services.preferences_service import Config
from shared.contracts.fixed_document.validation import validate


def chart_element(kind):
    return {
        "id":"chart-a", "type":"chart","name":"Dados de pesquisa",
        "x":.12,"y":.21,"width":.71,"height":.55,
        "rotation":0,"color":"#191C1E","fill":"#DAE2FD",
        "stroke":"#004AC6","stroke_width":1.5,
        "chart_type":kind,"chart_title":"Queimadas no Brasil",
        "chart_palette":"contrast",
        "chart_categories":["2023","2024","2025"],
        "chart_values":[12,16,30],
    }


@pytest.mark.parametrize("kind", ["bar","line","pie"])
def test_editable_native_chart_has_workbook_and_usable_values(tmp_path, kind):
    ctx=configure(Config(tmp_path / kind))
    note=ctx.fixed_documents.create_presentation("Dados de queimadas")
    model=deepcopy(note["content"])
    model["surfaces"][0]["elements"]=[chart_element(kind)]
    validate(model)
    saved=ctx.fixed_documents.save(note["id"],note["title"],model,note["revision"])
    destination=tmp_path / f"native-{kind}.pptx"
    ctx.fixed_documents.export(note["id"],saved["revision"],"pptx",destination)
    deck=Presentation(destination)
    assert len(deck.slides)==1
    chart_objects=[shape for shape in deck.slides[0].shapes if shape.has_chart]
    assert len(chart_objects)==1
    graphic=chart_objects[0]
    assert graphic.name=="Dados de pesquisa"
    assert [float(value) for value in graphic.chart.series[0].values]==[12,16,30]
    assert "Queimadas no Brasil" in graphic.chart.chart_title.text_frame.text
    with ZipFile(destination) as package:
        assert package.testzip() is None
        files=package.namelist()
        assert any(name.startswith("ppt/charts/chart") and name.endswith(".xml") for name in files)
        assert any(name.startswith("ppt/embeddings/") and name.endswith(".xlsx") for name in files), (
            "An editable chart requires the embedded source workbook")
        slide_xml=package.read("ppt/slides/slide1.xml")
        assert b"graphicFrame" in slide_xml and b"chart" in slide_xml
    # PowerPoint-native graphic frames, unlike screenshot images, have chart data.
    assert not graphic.shape_type==13


@pytest.mark.parametrize("change", [
    {"chart_type":"javascript"},
    {"chart_palette":"../../theme"},
    {"chart_categories":["ok"],"chart_values":[1,2]},
    {"chart_categories":[""]},
    {"chart_values":[float("inf"),2,3]},
    {"chart_values":[True,2,3]},
    {"rotation":45},
])
def test_chart_rejects_invalid_or_unsupported_data(tmp_path,change):
    ctx=configure(Config(tmp_path))
    note=ctx.fixed_documents.create_presentation("Validação de gráfico")
    model=deepcopy(note["content"])
    chart=chart_element("bar")
    chart.update(change)
    model["surfaces"][0]["elements"]=[chart]
    with pytest.raises(ValueError):
        validate(model)


def test_pie_rejects_negative_or_all_zero(tmp_path):
    ctx=configure(Config(tmp_path))
    note=ctx.fixed_documents.create_presentation("Pizza")
    for values in ([0,0,0],[-1,4,6]):
        model=deepcopy(note["content"])
        obj=chart_element("pie")
        obj["chart_values"]=values
        model["surfaces"][0]["elements"]=[obj]
        with pytest.raises(ValueError,match="pizza"):
            validate(model)


def test_single_slide_export_keeps_shapes_and_chart_editable(tmp_path):
    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation("Slides para exportação")
    model = deepcopy(note["content"])
    initial = deepcopy(model["surfaces"][0])
    initial["elements"] = [{
        "id": "text-single",
        "type": "text",
        "name": "Título original",
        "x": 0.1, "y": 0.1, "width": 0.6, "height": 0.15,
        "rotation": 0, "text": "Primeiro slide",
        "color": "#191C1E", "fill": "#DAE2FD", "stroke": "#004AC6",
        "font_size_pt": 28, "stroke_width": 1.5,
    }]
    second = deepcopy(initial)
    second["index"] = 1
    second["elements"] = [chart_element("pie")]
    model["surfaces"] = [initial, second]
    saved = ctx.fixed_documents.save(
        note["id"], note["title"], model, note["revision"]
    )
    destination = tmp_path / "slide-selecionado.pptx"
    result = ctx.fixed_documents.export_selected_slide(
        note["id"], saved["revision"], 1, destination
    )
    assert result["slides"] == 1
    deck = Presentation(destination)
    assert len(deck.slides) == 1
    shapes = list(deck.slides[0].shapes)
    assert len([shape for shape in shapes if shape.has_chart]) == 1
    assert all("Primeiro slide" not in shape.text for shape in shapes if shape.has_text_frame)
    assert [float(v) for v in shapes[0].chart.series[0].values] == [12, 16, 30]
    with ZipFile(destination) as package:
        assert package.testzip() is None
        assert any(p.startswith("ppt/embeddings/") and p.endswith(".xlsx")
                   for p in package.namelist())


def test_selected_slide_export_rejects_stale_revision_or_invalid_index(tmp_path):
    ctx = configure(Config(tmp_path))
    note = ctx.fixed_documents.create_presentation("Validação de slide")
    original = tmp_path / "original-should-not-be-created.pptx"
    with pytest.raises(ValueError, match="Slide selecionado inválido"):
        ctx.fixed_documents.export_selected_slide(
            note["id"], note["revision"], 9, original
        )
    with pytest.raises(ValueError, match="Salve a apresentação"):
        ctx.fixed_documents.export_selected_slide(
            note["id"], note["revision"] + 1, 0, original
        )
    assert not original.exists(), "invalid operations must not write any output"

"""Native chart and text formatting must survive XLSX-backed PPTX export/import."""
from copy import deepcopy
from zipfile import ZipFile

import pytest
from pptx import Presentation

from apps.open_doc.fixed_document.slide_model import SlideModelValidator
from apps.open_doc.readers.pptx.exporter import SlideDeckExporter
from apps.open_doc.readers.pptx.native_importer import read_editable_deck


CATEGORIES = [
    "Remuneração dos empregados",
    "Excedente operacional bruto e rendimento misto bruto",
    "Impostos líquidos de subsídios",
]
VALUES = [39.2, 45.3, 15.5]


def model(kind="bar"):
    return {
        "source_kind": "pptx", "editable_deck": True, "assets": {},
        "surfaces": [{
            "index": 0, "width_pt": 960, "height_pt": 540,
            "background": "#276F42", "elements": [{
                "id": "pib-chart", "type": "chart", "name": "Composição do PIB",
                "x": .05, "y": .13, "width": .88, "height": .72, "rotation": 0,
                "stroke_width": 1.5, "color": "#191C1E",
                "fill": "#DAE2FD", "stroke": "#004AC6",
                "chart_title": "Distribuição do PIB pela ótica da renda — Brasil, 2021",
                "chart_type": kind, "chart_palette": "contrast",
                "chart_categories": CATEGORIES[:], "chart_values": VALUES[:],
                "chart_background": "transparent",
                "chart_data_labels": "percent",
                "chart_label_wrap": True, "chart_label_font": "Liberation Sans",
                "chart_label_font_size": 14, "chart_label_letter_spacing": .5,
                "chart_label_rotation": 45,
                "chart_color_mode": "custom",
                "chart_item_colors": ["#275899", "#FF7733", "#3B9D7C"],
            }],
        }],
    }


@pytest.mark.parametrize("kind", ["bar", "hbar", "line", "area", "pie"])
def test_all_supported_native_chart_types_preserve_categories_and_percentages(
    tmp_path, kind
):
    deck = model(kind)
    SlideModelValidator().validate(deck)
    target = tmp_path / f"pib-{kind}.pptx"
    SlideDeckExporter(None, deck).write(target)
    presentation = Presentation(target)
    item = presentation.slides[0].shapes[0]
    assert item.has_chart
    chart = item.chart
    assert [entry.label for entry in chart.plots[0].categories] == CATEGORIES
    assert list(chart.series[0].values) == pytest.approx(VALUES)
    assert chart._chartSpace.xpath("./c:spPr/a:noFill")
    assert chart._chartSpace.chart.plotArea.xpath("./c:spPr/a:noFill")
    with ZipFile(target) as package:
        xml = package.read("ppt/charts/chart1.xml").decode()
        assert "Excedente operacional bruto e rendimento misto bruto" in xml
        assert "39.2" in xml
        assert "45.3" in xml
        assert "15.5" in xml
        assert "<a:noFill" in xml
        if kind != "pie":
            assert "39.2%" in xml
            assert "45.3%" in xml
            assert "15.5%" in xml
    reopened = read_editable_deck(target)
    assert reopened is not None
    chart_object = reopened["surfaces"][0]["elements"][0]
    assert chart_object["chart_categories"] == CATEGORIES
    assert chart_object["chart_values"] == pytest.approx(VALUES)
    assert chart_object["chart_background"] == "transparent"


def test_chart_colors_and_values_can_change_without_replacing_category_names(tmp_path):
    deck = model()
    first = tmp_path / "original.pptx"
    SlideDeckExporter(None, deck).write(first)
    reopened = read_editable_deck(first)
    assert reopened
    changed = deepcopy(reopened)
    obj = changed["surfaces"][0]["elements"][0]
    obj.update(chart_values=[45.3, 39.2, 15.5],
               chart_item_colors=["#114488", "#008844", "#BB2222"],
               chart_data_labels="both")
    SlideModelValidator().validate(changed)
    destination = tmp_path / "alterado.pptx"
    SlideDeckExporter(None, changed).write(destination)
    chart = Presentation(destination).slides[0].shapes[0].chart
    assert [entry.label for entry in chart.plots[0].categories] == CATEGORIES
    assert list(chart.series[0].values) == pytest.approx([45.3, 39.2, 15.5])


def test_text_letter_spacing_remains_native_after_save_and_reopen(tmp_path):
    deck = model()
    deck["surfaces"][0]["elements"].append({
        "id": "title", "name": "Título", "type": "text",
        "text": "Análise do produto interno bruto",
        "x": .08, "y": .02, "width": .85, "height": .1,
        "font_size_pt": 24, "font_letter_spacing_pt": 1.5,
        "font_family": "Liberation Sans", "color": "#FFFFFF",
        "fill": "#FFFFFF", "stroke": "#FFFFFF", "rotation": 0,
    })
    SlideModelValidator().validate(deck)
    destination = tmp_path / "spacing.pptx"
    SlideDeckExporter(None, deck).write(destination)
    run = Presentation(destination).slides[0].shapes[1].text_frame.paragraphs[0].runs[0]
    assert run._r.get_or_add_rPr().get("spc") == "150"
    new = read_editable_deck(destination)
    assert new is not None
    assert new["surfaces"][0]["elements"][1]["font_letter_spacing_pt"] == 1.5


@pytest.mark.parametrize("key,value", [
    ("chart_item_colors", ["not a color"]),
    ("chart_label_font_size", 3),
    ("chart_label_letter_spacing", 11),
    ("chart_label_rotation", 20),
    ("chart_data_labels", "misleading"),
    ("chart_background", "unexpected"),
    ("chart_categories", ["Truncar este nome"*16, "A", "B"]),
])
def test_chart_validation_blocks_invalid_formats(key, value):
    deck = model()
    deck["surfaces"][0]["elements"][0][key] = value
    with pytest.raises(ValueError):
        SlideModelValidator().validate(deck)

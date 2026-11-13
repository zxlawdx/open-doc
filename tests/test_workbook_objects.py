"""Native XLSX drawings, persistence and bounded shared media."""

import base64
from copy import deepcopy
from io import BytesIO

import pytest
from openpyxl import load_workbook
from PIL import Image

from apps.open_doc.application.context import configure
from apps.open_doc.services.preferences_service import Config
from apps.open_doc.spreadsheets import files
from apps.open_doc.spreadsheets.objects import image_bytes, media_directory, store_image
from apps.open_doc.spreadsheets.store import validate


def image():
    stream = BytesIO()
    Image.new("RGB", (80, 40), "#1a73e8").save(stream, format="PNG")
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()


def sheet():
    return {
        "name": "Vendas",
        "cells": {
            "0,0": "Mês",
            "0,1": "Receita",
            "0,2": "Custo",
            "1,0": "Jan",
            "1,1": "20",
            "1,2": "10",
            "2,0": "Fev",
            "2,1": "30",
            "2,2": "12",
        },
        "bold": [],
    }


def test_images_share_bytes_and_revision_history_preserves_drawings(tmp_path):
    ctx = configure(Config(tmp_path))
    media = media_directory(tmp_path)
    asset = store_image(media, image())
    assert store_image(media, image())["media_id"] == asset["media_id"]
    data = sheet()
    data["objects"] = [
        {
            "id": f"image-{i}",
            "type": "image",
            "name": "Foto",
            "media_id": asset["media_id"],
            "x": i * 112,
            "y": 28,
            "width": 160,
            "height": 80,
        }
        for i in range(20)
    ]
    assert len(validate([data])) < 10000
    assert len(list(media.iterdir())) == 1
    note = ctx.workbooks.create("Com imagens", [data])
    changed = deepcopy(note["sheets"])
    changed[0]["objects"][0]["x"] = 250
    saved = ctx.workbooks.save(note["id"], note["revision"], note["title"], changed)
    assert ctx.workbooks.get(note["id"])["sheets"][0]["objects"][0]["x"] == 250
    assert saved["revision"] == 2
    assert image_bytes(media, asset["media_id"])


@pytest.mark.parametrize("kind", ["bar", "hbar", "line", "pie", "area", "scatter"])
def test_native_image_and_chart_export_reimport_preserve_data_and_position(
    tmp_path, kind
):
    media = media_directory(tmp_path)
    asset = store_image(media, image())
    data = sheet()
    data["layout"] = {"columns": {"0": 200, "1": 250}, "rows": {"0": 80, "1": 50}}
    if kind == "scatter":
        data["cells"].update({"1,0": "1", "2,0": "2"})
    data["objects"] = [
        {
            "id": "photo",
            "type": "image",
            "name": "Foto",
            "media_id": asset["media_id"],
            "x": 127,
            "y": 55,
            "width": 160,
            "height": 80,
        },
        {
            "id": "chart",
            "type": "chart",
            "name": "Receita mensal",
            "chart_kind": kind,
            "range": [0, 0, 2, 2],
            "x": 300,
            "y": 150,
            "width": 560,
            "height": 320,
        },
    ]
    target = tmp_path / f"drawings-{kind}.xlsx"
    files.export([data], target, "xlsx", media_directory=media)
    native = load_workbook(target)
    assert len(native.active._images) == 1
    assert len(native.active._charts) == 1
    assert len(native.active._charts[0].series) == 2
    assert native.active["B2"].value == 20
    imported = files.read(target, media_directory=media)[0]
    picture, chart = imported["objects"]
    assert picture["media_id"] == asset["media_id"]
    assert picture["x"] == 127 and picture["y"] == 55
    assert picture["width"] == 160 and picture["height"] == 80
    assert chart["chart_kind"] == kind
    assert chart["range"] == [0, 0, 2, 2]
    assert chart["name"] == "Receita mensal"
    assert imported["cells"] == data["cells"]


def test_media_paths_and_object_geometry_are_validated(tmp_path):
    with pytest.raises(ValueError):
        image_bytes(tmp_path, "../outside")
    data = sheet()
    data["objects"] = [
        {
            "id": "x",
            "type": "chart",
            "name": "Dados",
            "chart_kind": "line",
            "range": [0, 0, 2, 2],
            "x": float("nan"),
            "y": 0,
            "width": 300,
            "height": 200,
        }
    ]
    with pytest.raises(ValueError):
        validate([data])
    data["objects"][0]["x"] = 0
    data["objects"][0]["range"] = [0, 0, 0, 2]
    with pytest.raises(ValueError):
        validate([data])
    with pytest.raises(ValueError):
        store_image(
            tmp_path,
            "data:image/png;base64," + base64.b64encode(b"not a picture").decode(),
        )


def test_cell_comments_links_lists_and_boolean_controls_roundtrip(tmp_path):
    data = sheet()
    data["cells"]["3,0"] = "TRUE"
    data["cells"]["3,1"] = "Pendente"
    data["cell_tools"] = {
        "3,0": {"checkbox": True},
        "3,1": {
            "choices": ["Pendente", "Concluído"],
            "comment": "Revisar antes de concluir",
        },
        "0,0": {"hyperlink": "https://example.com/dados"},
    }
    validate([data])
    path = tmp_path / "controls.xlsx"
    files.export([data], path, "xlsx")
    native = load_workbook(path).active
    assert native["A4"].value is True
    assert native["B4"].comment.text == "Revisar antes de concluir"
    assert native["A1"].hyperlink.target == "https://example.com/dados"
    assert len(native.data_validations.dataValidation) == 1
    imported = files.read(path)[0]
    assert imported["cell_tools"] == data["cell_tools"]
    data["cell_tools"]["0,0"]["hyperlink"] = "javascript:alert(1)"
    with pytest.raises(ValueError):
        validate([data])


@pytest.mark.parametrize(
    "kind", ["rect", "ellipse", "triangle", "diamond", "line", "arrow", "text"]
)
def test_native_drawingml_shapes_and_text_roundtrip(tmp_path, kind):
    from zipfile import ZipFile

    data = sheet()
    data["layout"] = {"columns": {"0": 200}, "rows": {"0": 80}}
    data["cell_tools"] = {"0,0": {"comment": "Comentário junto com formas"}}
    data["objects"] = [
        {
            "id": "shape",
            "type": "shape",
            "shape_kind": kind,
            "name": "Forma de teste",
            "text": "Texto editável\nSegunda linha",
            "fill": "#DDFFDD",
            "color": "#122334",
            "x": 123,
            "y": 76,
            "width": 240,
            "height": 140,
        }
    ]
    target = tmp_path / "shapes.xlsx"
    files.export([data], target, "xlsx")
    with ZipFile(target) as archive:
        assert b"Texto edit" in archive.read("xl/drawings/drawing1.xml")
        assert archive.testzip() is None
    imported = files.read(target)[0]
    actual = imported["objects"][0]
    assert actual["shape_kind"] == kind
    assert actual["text"] == data["objects"][0]["text"]
    assert actual["color"] == "#122334"
    assert [actual[key] for key in ("x", "y", "width", "height")] == [123, 76, 240, 140]
    assert imported["cell_tools"] == data["cell_tools"]


@pytest.mark.parametrize("kind", ["line", "column", "winloss"])
def test_native_sparkline_extension_roundtrip(tmp_path, kind):
    from zipfile import ZipFile
    from defusedxml.ElementTree import fromstring

    data = sheet()
    data["cell_tools"] = {"1,3": {"sparkline": {"kind": kind, "range": [1, 1, 1, 2]}}}
    validate([data])
    path = tmp_path / f"spark-{kind}.xlsx"
    files.export([data], path, "xlsx")
    with ZipFile(path) as archive:
        xml = fromstring(archive.read("xl/worksheets/sheet1.xml"))
        assert (
            xml.find(
                ".//{http://schemas.microsoft.com/office/spreadsheetml/2009/9/main}sparklineGroup"
            )
            is not None
        )
    imported = files.read(path)[0]
    assert imported["cell_tools"] == data["cell_tools"]
    assert imported["cells"] == data["cells"]

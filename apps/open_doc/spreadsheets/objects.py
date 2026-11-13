"""Validated worksheet drawings and content-addressed raster assets."""

from __future__ import annotations

import base64
import hashlib
import math
import re
from pathlib import Path
from uuid import uuid4

from apps.open_doc.document_model.images import prepare_image

KINDS = {"bar", "hbar", "line", "pie", "area", "scatter"}
DIGEST = re.compile(r"[a-f0-9]{64}")


def media_directory(root):
    return Path(root) / ".veladata" / "workbook-media"


def store_image(directory, data_url, name="Imagem"):
    blob, kind, width, height = prepare_image(data_url)
    digest = hashlib.sha256(blob).hexdigest()
    folder = Path(directory)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / digest
    if not target.exists():
        temporary = folder / (digest + "." + uuid4().hex + ".tmp")
        try:
            temporary.write_bytes(blob)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return {
        "media_id": digest,
        "width": width,
        "height": height,
        "url": f"data:image/{kind};base64," + base64.b64encode(blob).decode(),
        "name": str(name)[:200],
    }


def image_url(directory, identifier):
    blob = image_bytes(directory, identifier)
    kind = "png" if blob.startswith(b"\x89PNG") else "jpeg"
    return {"url": f"data:image/{kind};base64," + base64.b64encode(blob).decode()}


def image_bytes(directory, identifier):
    if not isinstance(identifier, str) or not DIGEST.fullmatch(identifier):
        raise ValueError("Imagem de planilha inválida.")
    if directory is None:
        raise ValueError("Catálogo de imagens da planilha indisponível.")
    path = Path(directory) / identifier
    if path.is_symlink() or not path.is_file():
        raise ValueError("Imagem da planilha não encontrada.")
    blob = path.read_bytes()
    if hashlib.sha256(blob).hexdigest() != identifier:
        raise ValueError("A imagem da planilha foi alterada fora do aplicativo.")
    return blob


def validate_objects(sheet):
    objects = sheet.get("objects", [])
    if not isinstance(objects, list) or len(objects) > 200:
        raise ValueError("Use até 200 imagens e gráficos por aba.")
    seen = set()
    for obj in objects:
        common = {"id", "type", "x", "y", "width", "height", "name"}
        if not isinstance(obj, dict) or not common <= obj.keys():
            raise ValueError("Objeto de planilha inválido.")
        identifier = obj["id"]
        if (
            not isinstance(identifier, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", identifier)
            or identifier in seen
        ):
            raise ValueError("Identificador de objeto inválido.")
        seen.add(identifier)
        if not isinstance(obj["name"], str) or len(obj["name"]) > 200:
            raise ValueError("Nome do objeto inválido.")
        for field, lower, upper in (
            ("x", 0, 11200),
            ("y", 0, 280000),
            ("width", 16, 4000),
            ("height", 16, 4000),
        ):
            value = obj[field]
            if (
                type(value) not in (int, float)
                or not math.isfinite(value)
                or not lower <= value <= upper
            ):
                raise ValueError("Posição ou dimensões do objeto inválidas.")
        if obj["type"] == "image":
            if (
                set(obj) - common - {"media_id"}
                or not isinstance(obj.get("media_id"), str)
                or not DIGEST.fullmatch(obj["media_id"])
            ):
                raise ValueError("Referência de imagem inválida.")
        elif obj["type"] == "chart":
            if (
                set(obj) - common - {"chart_kind", "range"}
                or obj.get("chart_kind") not in KINDS
            ):
                raise ValueError("Tipo de gráfico inválido.")
            bounds = obj.get("range")
            if (
                not isinstance(bounds, list)
                or len(bounds) != 4
                or any(type(n) is not int for n in bounds)
                or not 0 <= bounds[0] < bounds[2] < 10000
                or not 0 <= bounds[1] < bounds[3] < 100
                or (bounds[2] - bounds[0] + 1) * (bounds[3] - bounds[1] + 1) > 50000
            ):
                raise ValueError(
                    "Selecione cabeçalhos, categorias e pelo menos uma série numérica."
                )
        elif obj["type"] == "shape":
            if set(obj) - common - {"shape_kind", "text", "fill", "color"} or obj.get(
                "shape_kind"
            ) not in {
                "rect",
                "ellipse",
                "triangle",
                "diamond",
                "line",
                "arrow",
                "text",
            }:
                raise ValueError("Tipo de forma inválido.")
            if not isinstance(obj.get("text"), str) or len(obj["text"]) > 4000:
                raise ValueError("Texto da forma inválido.")
            if any(
                not isinstance(obj.get(k), str)
                or not re.fullmatch(r"#[a-fA-F0-9]{6}", obj[k])
                for k in ("fill", "color")
            ):
                raise ValueError("Cor da forma inválida.")
        else:
            raise ValueError("Tipo de objeto desconhecido.")


def _anchor(obj):
    from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
    from openpyxl.drawing.xdr import XDRPositiveSize2D
    from openpyxl.utils.units import pixels_to_EMU

    col, x = divmod(obj["x"], 112)
    row, y = divmod(obj["y"], 28)
    return OneCellAnchor(
        _from=AnchorMarker(
            col=int(col), row=int(row), colOff=pixels_to_EMU(x), rowOff=pixels_to_EMU(y)
        ),
        ext=XDRPositiveSize2D(
            pixels_to_EMU(obj["width"]), pixels_to_EMU(obj["height"])
        ),
    )


def export_objects(sheet, output, directory):
    from openpyxl.chart import (
        AreaChart,
        BarChart,
        LineChart,
        PieChart,
        Reference,
        ScatterChart,
        Series,
    )
    from openpyxl.drawing.image import Image

    verified = set()
    for obj in sheet.get("objects", []):
        if obj["type"] == "image":
            if obj["media_id"] not in verified:
                image_bytes(directory, obj["media_id"])
                verified.add(obj["media_id"])
            picture = Image(str(Path(directory) / obj["media_id"]))
            picture.width, picture.height = obj["width"], obj["height"]
            picture.anchor = _anchor(obj)
            output.add_image(picture)
            continue
        if obj["type"] == "shape":
            continue
        kind = obj["chart_kind"]
        chart = {
            "bar": BarChart,
            "hbar": BarChart,
            "line": LineChart,
            "pie": PieChart,
            "area": AreaChart,
            "scatter": ScatterChart,
        }[kind]()
        if kind == "hbar":
            chart.type = "bar"
        chart.title = obj["name"]
        top, left, bottom, right = obj["range"]
        if kind == "scatter":
            x = Reference(output, min_col=left + 1, min_row=top + 2, max_row=bottom + 1)
            for col in range(left + 1, right + 1):
                y = Reference(
                    output, min_col=col + 1, min_row=top + 1, max_row=bottom + 1
                )
                chart.series.append(Series(y, x, title_from_data=True))
        else:
            data = Reference(
                output,
                min_col=left + 2,
                max_col=right + 1,
                min_row=top + 1,
                max_row=bottom + 1,
            )
            chart.add_data(data, titles_from_data=True)
            chart.set_categories(
                Reference(output, min_col=left + 1, min_row=top + 2, max_row=bottom + 1)
            )
        chart.anchor = _anchor(obj)
        output.add_chart(chart)


def import_objects(source, sheet, directory):
    """Read standard OOXML images and supported native charts without flattening."""
    from openpyxl.chart import AreaChart, BarChart, LineChart, PieChart, ScatterChart
    from openpyxl.utils.cell import range_boundaries
    from openpyxl.utils.units import EMU_to_pixels

    def geometry(anchor, width=480, height=300):
        marker = getattr(anchor, "_from", None)
        extent = getattr(anchor, "ext", None)
        return {
            "x": marker.col * 112 + EMU_to_pixels(marker.colOff) if marker else 112,
            "y": marker.row * 28 + EMU_to_pixels(marker.rowOff) if marker else 28,
            "width": max(16, min(4000, EMU_to_pixels(extent.cx) if extent else width)),
            "height": max(
                16, min(4000, EMU_to_pixels(extent.cy) if extent else height)
            ),
        }

    objects = []
    for image in source._images:
        if directory is None:
            raise ValueError(
                "Importação com imagens exige o catálogo de mídia da aplicação."
            )
        blob = image._data()
        mime = "jpeg" if image.format in {"jpeg", "jpg"} else "png"
        stored = store_image(
            directory, f"data:image/{mime};base64," + base64.b64encode(blob).decode()
        )
        objects.append(
            {
                "id": uuid4().hex,
                "type": "image",
                "name": "Imagem importada",
                "media_id": stored["media_id"],
                **geometry(image.anchor, image.width, image.height),
            }
        )
    for chart in source._charts:
        kind = next(
            (
                name
                for cls, name in (
                    (BarChart, "bar"),
                    (LineChart, "line"),
                    (PieChart, "pie"),
                    (AreaChart, "area"),
                    (ScatterChart, "scatter"),
                )
                if isinstance(chart, cls)
            ),
            None,
        )
        if kind is None:
            raise ValueError(
                "O arquivo contém um tipo de gráfico ainda incompatível com a edição."
            )
        if isinstance(chart, BarChart) and chart.type == "bar":
            kind = "hbar"
        ranges = []
        for series in chart.series:
            for key in ("val", "cat", "xVal", "yVal"):
                data = getattr(series, key, None)
                for ref in (
                    getattr(data, "numRef", None),
                    getattr(data, "strRef", None),
                ):
                    if ref is not None and ref.f:
                        ranges.append(
                            range_boundaries(ref.f.rsplit("!", 1)[-1].replace("$", ""))
                        )
        if not ranges:
            raise ValueError(
                "O gráfico importado não referencia um intervalo editável."
            )
        left = min(r[0] for r in ranges) - 1
        right = max(r[2] for r in ranges) - 1
        top = max(0, min(r[1] for r in ranges) - 2)
        bottom = max(r[3] for r in ranges) - 1
        title = "Gráfico importado"
        if chart.title is not None and chart.title.tx and chart.title.tx.rich:
            title = (
                "".join(run.t for p in chart.title.tx.rich.p for run in p.r) or title
            )
        objects.append(
            {
                "id": uuid4().hex,
                "type": "chart",
                "name": title[:200],
                "chart_kind": kind,
                "range": [top, left, bottom, right],
                **geometry(chart.anchor),
            }
        )
    if objects:
        sheet["objects"] = objects
    validate_objects(sheet)


def validate_cell_tools(sheet):
    from urllib.parse import urlsplit

    tools = sheet.get("cell_tools", {})
    if not isinstance(tools, dict) or len(tools) > 50000:
        raise ValueError("Controles de célula inválidos.")
    for key, value in tools.items():
        if not isinstance(key, str) or not re.fullmatch(
            r"(?:0|[1-9]\d{0,3}),(?:0|[1-9]\d?)", key
        ):
            raise ValueError("Endereço de controle inválido.")
        if not isinstance(value, dict) or set(value) - {
            "checkbox",
            "choices",
            "comment",
            "hyperlink",
            "sparkline",
        }:
            raise ValueError("Controle de célula desconhecido.")
        if "sparkline" in value:
            config = value["sparkline"]
            if (
                not isinstance(config, dict)
                or set(config) != {"kind", "range"}
                or config["kind"] not in {"line", "column", "winloss"}
            ):
                raise ValueError("Minigráfico inválido.")
            bounds = config["range"]
            if (
                not isinstance(bounds, list)
                or len(bounds) != 4
                or any(type(v) is not int for v in bounds)
                or not 0 <= bounds[0] <= bounds[2] < 10000
                or not 0 <= bounds[1] <= bounds[3] < 100
                or bounds[0] != bounds[2]
                and bounds[1] != bounds[3]
                or bounds[0] == bounds[2]
                and bounds[1] == bounds[3]
            ):
                raise ValueError(
                    "Minigráfico exige uma linha ou coluna de pelo menos dois valores."
                )
            row, col = map(int, key.split(","))
            if bounds[0] <= row <= bounds[2] and bounds[1] <= col <= bounds[3]:
                raise ValueError("Destino do minigráfico sobrepõe sua fonte.")
            if "checkbox" in value or "choices" in value:
                raise ValueError(
                    "Minigráfico não pode dividir a célula com outro controle."
                )
        if "checkbox" in value and value["checkbox"] is not True:
            raise ValueError("Caixa de seleção inválida.")
        if "checkbox" in value and "choices" in value:
            raise ValueError("Uma célula não pode combinar caixa de seleção com lista.")
        if "choices" in value:
            choices = value["choices"]
            if (
                not isinstance(choices, list)
                or not 1 <= len(choices) <= 50
                or any(
                    not isinstance(item, str)
                    or not item.strip()
                    or any(c in item for c in ',"\r\n')
                    for item in choices
                )
                or len(set(choices)) != len(choices)
                or len(",".join(choices)) > 250
            ):
                raise ValueError(
                    "Use até 50 opções únicas, sem vírgulas ou aspas e até 250 caracteres no total."
                )
        if "comment" in value and (
            not isinstance(value["comment"], str) or len(value["comment"]) > 4000
        ):
            raise ValueError("Comentário deve ter até 4.000 caracteres.")
        if "hyperlink" in value:
            url = value["hyperlink"]
            if not isinstance(url, str) or len(url) > 2000:
                raise ValueError("Link inválido.")
            parsed = urlsplit(url)
            if not (
                (parsed.scheme in {"http", "https"} and parsed.netloc)
                or (parsed.scheme == "mailto" and parsed.path)
            ):
                raise ValueError("Use um link HTTP, HTTPS ou mailto.")


def export_cell_tools(sheet, output):
    from openpyxl.comments import Comment
    from openpyxl.worksheet.datavalidation import DataValidation

    validations = {}
    validation_cells = {}
    for key, tools in sheet.get("cell_tools", {}).items():
        row, col = map(int, key.split(","))
        cell = output.cell(row + 1, col + 1)
        if tools.get("checkbox"):
            cell.value = str(sheet["cells"].get(key, "")).lower() in {
                "true",
                "1",
                "sim",
            }
            cell.data_type = "b"
        if "comment" in tools:
            cell.comment = Comment(tools["comment"], "Open Doc")
        if "hyperlink" in tools:
            cell.hyperlink = tools["hyperlink"]
        if "choices" in tools:
            values = tuple(tools["choices"])
            if values not in validations:
                validation = DataValidation(
                    type="list", formula1='"' + ",".join(values) + '"', allow_blank=True
                )
                validation.errorTitle = "Valor fora da lista"
                validation.error = "Escolha uma opção da lista."
                validation.showErrorMessage = True
                output.add_data_validation(validation)
                validations[values] = validation
                validation_cells[values] = []
            validation_cells[values].append(cell.coordinate)
    from openpyxl.worksheet.datavalidation import collapse_cell_addresses

    for values, validation in validations.items():
        validation.sqref = collapse_cell_addresses(validation_cells[values])


def import_cell_tools(source, sheet):
    tools = {}
    for row in source:
        for cell in row:
            entry = {}
            if type(cell.value) is bool:
                entry["checkbox"] = True
            if cell.comment:
                entry["comment"] = cell.comment.text[:4000]
            if cell.hyperlink and cell.hyperlink.target:
                from urllib.parse import urlsplit

                if urlsplit(cell.hyperlink.target).scheme in {
                    "http",
                    "https",
                    "mailto",
                }:
                    entry["hyperlink"] = cell.hyperlink.target
            if entry:
                tools[f"{cell.row-1},{cell.column-1}"] = entry
    for validation in source.data_validations.dataValidation:
        formula = validation.formula1 or ""
        if (
            validation.type != "list"
            or not formula.startswith('"')
            or not formula.endswith('"')
        ):
            continue
        choices = formula[1:-1].split(",")
        for area in validation.ranges.ranges:
            if (
                area.max_row > 10000
                or area.max_col > 100
                or len(tools)
                + (area.max_row - area.min_row + 1) * (area.max_col - area.min_col + 1)
                > 50000
            ):
                raise ValueError("Lista de seleção fora dos limites da planilha.")
            for row in range(area.min_row, area.max_row + 1):
                for col in range(area.min_col, area.max_col + 1):
                    tools.setdefault(f"{row-1},{col-1}", {})["choices"] = choices
    if tools:
        sheet["cell_tools"] = tools
    validate_cell_tools(sheet)

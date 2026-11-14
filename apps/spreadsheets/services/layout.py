"""Validated worksheet geometry shared by import, persistence and export."""

import math

from apps.spreadsheets.services.store import COLUMNS, ROWS


def validate_layout(sheet):
    layout = sheet.get("layout", {})
    if not isinstance(layout, dict) or set(layout) - {
        "rows",
        "columns",
        "merges",
        "freeze",
        "gridlines",
    }:
        raise ValueError("Layout de planilha inválido.")
    for scope, limit in [("rows", ROWS), ("columns", COLUMNS)]:
        sizes = layout.get(scope, {})
        if not isinstance(sizes, dict) or len(sizes) > limit:
            raise ValueError("Dimensões de planilha inválidas.")
        for key, size in sizes.items():
            if (
                not isinstance(key, str)
                or not key.isascii()
                or not key.isdecimal()
                or str(int(key)) != key
                or not 0 <= int(key) < limit
                or type(size) not in (int, float)
                or not math.isfinite(size)
                or not 16 <= size <= 2000
            ):
                raise ValueError("Tamanho de linha ou coluna inválido.")
    freeze = layout.get("freeze", [0, 0])
    if (
        not isinstance(freeze, list)
        or len(freeze) != 2
        or any(type(v) is not int for v in freeze)
        or not 0 <= freeze[0] <= ROWS
        or not 0 <= freeze[1] <= COLUMNS
    ):
        raise ValueError("Congelamento inválido.")
    if "gridlines" in layout and type(layout["gridlines"]) is not bool:
        raise ValueError("Exibição da grade inválida.")
    merges = layout.get("merges", [])
    if not isinstance(merges, list) or len(merges) > 1000:
        raise ValueError("Mesclagens inválidas.")
    covered = set()
    for rng in merges:
        if (
            not isinstance(rng, list)
            or len(rng) != 4
            or any(type(v) is not int for v in rng)
            or not 0 <= rng[0] <= rng[2] < ROWS
            or not 0 <= rng[1] <= rng[3] < COLUMNS
        ):
            raise ValueError("Intervalo mesclado inválido.")
        size = (rng[2] - rng[0] + 1) * (rng[3] - rng[1] + 1)
        if len(covered) + size > 50000:
            raise ValueError("Limite de 50 mil células mescladas.")
        for row in range(rng[0], rng[2] + 1):
            for col in range(rng[1], rng[3] + 1):
                if (row, col) in covered:
                    raise ValueError("Mesclagens sobrepostas.")
                covered.add((row, col))


def import_layout(source, sheet):
    from openpyxl.utils.cell import coordinate_to_tuple

    layout = {"rows": {}, "columns": {}, "merges": []}
    for row, dim in source.row_dimensions.items():
        if dim.height is not None and 1 <= row <= ROWS:
            layout["rows"][str(row - 1)] = min(2000, max(16, dim.height * 4 / 3))
    for dim in source.column_dimensions.values():
        if dim.width is not None:
            for col in range(max(1, dim.min), min(COLUMNS, dim.max) + 1):
                layout["columns"][str(col - 1)] = min(2000, max(16, dim.width * 7 + 5))
    for rng in source.merged_cells.ranges:
        layout["merges"].append(
            [rng.min_row - 1, rng.min_col - 1, rng.max_row - 1, rng.max_col - 1]
        )
    if source.freeze_panes:
        row, col = coordinate_to_tuple(source.freeze_panes)
        layout["freeze"] = [row - 1, col - 1]
    layout["gridlines"] = source.sheet_view.showGridLines is not False
    sheet["layout"] = layout
    validate_layout(sheet)


def export_layout(sheet, output):
    from openpyxl.utils.cell import get_column_letter

    layout = sheet.get("layout", {})
    for row, height in layout.get("rows", {}).items():
        output.row_dimensions[int(row) + 1].height = height * 3 / 4
    for col, width in layout.get("columns", {}).items():
        output.column_dimensions[get_column_letter(int(col) + 1)].width = max(
            1, (width - 5) / 7
        )
    for top, left, bottom, right in layout.get("merges", []):
        output.merge_cells(
            start_row=top + 1,
            start_column=left + 1,
            end_row=bottom + 1,
            end_column=right + 1,
        )
    row, col = layout.get("freeze", [0, 0])
    if row or col:
        output.freeze_panes = f"{get_column_letter(col+1)}{row+1}"
    if "gridlines" in layout:
        output.sheet_view.showGridLines = layout["gridlines"]


def cell_position(sheet, row, col):
    layout = sheet.get("layout", {})
    return (
        sum(layout.get("columns", {}).get(str(c), 112) for c in range(col)),
        sum(layout.get("rows", {}).get(str(r), 28) for r in range(row)),
    )


def cell_anchor(sheet, x, y):
    layout = sheet.get("layout", {})

    def locate(pixel, scope, limit, default):
        index = 0
        while index < limit - 1:
            size = layout.get(scope, {}).get(str(index), default)
            if pixel < size:
                break
            pixel -= size
            index += 1
        return index, pixel

    col, offset_x = locate(x, "columns", COLUMNS, 112)
    row, offset_y = locate(y, "rows", ROWS, 28)
    return col, row, offset_x, offset_y

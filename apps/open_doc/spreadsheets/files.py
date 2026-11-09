"""Bounded local file interchange. Imported text is never executable."""

import csv
import re
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import BadZipFile, ZipFile

from defusedxml.common import DefusedXmlException

from .store import COLUMNS, MAX_CELLS, ROWS, empty_sheet, validate

FORMATS = ("xlsx", "csv", "tsv")
FUNCTIONS = {"SOMA": "SUM", "MÉDIA": "AVERAGE", "MÍNIMO": "MIN", "MÁXIMO": "MAX",
             "SUM": "SUM", "AVERAGE": "AVERAGE", "MIN": "MIN", "MAX": "MAX"}


def safe_formula(value):
    """Only carry arithmetic and supported built-in functions into Excel."""
    if not re.fullmatch(r"[=0-9\s+*/().,:;!'_$\-A-Za-zÀ-ÿ]+", value):
        return None
    if any(name.upper() not in FUNCTIONS for name in re.findall(r"([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9_.]*)\s*\(", value)):
        return None
    return re.sub(r"([A-Za-zÀ-ÿ]+)(?=\s*\()", lambda match: FUNCTIONS[match[0].upper()],
                  value.replace(";", ","))


def read(path):
    fmt = path.suffix.lower()[1:]
    if fmt not in FORMATS:
        raise ValueError("Escolha um arquivo XLSX, CSV ou TSV.")
    if path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError("O arquivo de origem ultrapassa 8 MB.")
    if fmt == "xlsx":
        try:
            with ZipFile(path) as archive:
                members = archive.infolist()
                if len(members) > 500 or sum(item.file_size for item in members) > 40 * 1024 * 1024:
                    raise ValueError("O conteúdo descompactado do XLSX ultrapassa os limites.")
            from openpyxl import DEFUSEDXML, load_workbook
            if not DEFUSEDXML:
                raise ValueError("A proteção XML necessária à importação XLSX está indisponível.")
            try:
                book = load_workbook(path, read_only=True, keep_links=False)
            except ValueError as error:
                raise ValueError("Arquivo XLSX inválido.") from error
            try:
                sheets = []
                count = 0
                if len(book.worksheets) > 20:
                    raise ValueError("A pasta ultrapassa 20 abas.")
                for source in book.worksheets:
                    sheet = empty_sheet(source.title)
                    for row, cells in enumerate(source.rows):
                        if row >= ROWS or len(cells) > COLUMNS:
                            raise ValueError("Limite de 10 mil linhas e 100 colunas por aba.")
                        for col, cell in enumerate(cells):
                            key = f"{row},{col}"
                            value = cell.value
                            bold = bool(getattr(cell, "font", None) and cell.font.bold)
                            if bold:
                                sheet["bold"].append(key)
                                count += 1
                            if count > MAX_CELLS:
                                raise ValueError("Limite de 50 mil valores e estilos por pasta.")
                            if value is None:
                                continue
                            if cell.data_type == "f" and isinstance(value, str):
                                sheet["cells"][key] = safe_formula(value) or "'" + value
                            elif cell.data_type == "f":
                                raise ValueError("O arquivo contém fórmulas matriciais ainda incompatíveis.")
                            else:
                                text = str(value)
                                numeric_text = isinstance(value, str) and re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?", text)
                                sheet["cells"][key] = "'" + text if numeric_text or text.startswith(("=", "'")) else text
                            count += 1
                            if count > MAX_CELLS:
                                raise ValueError("Limite de 50 mil valores e estilos por pasta.")
                    sheets.append(sheet)
            finally:
                book.close()
        except (BadZipFile, DefusedXmlException, KeyError, IndexError, TypeError) as error:
            raise ValueError("Arquivo XLSX inválido.") from error
    else:
        sheet = empty_sheet()
        with path.open(encoding="utf-8-sig", newline="") as source:
            sample = source.read(4096)
            source.seek(0)
            delimiter = "\t" if fmt == "tsv" else ","
            if fmt == "csv" and sample:
                try:
                    delimiter = csv.Sniffer().sniff(sample, delimiters=",;").delimiter
                except csv.Error:
                    pass
            for row, values in enumerate(csv.reader(source, delimiter=delimiter, strict=True)):
                if row >= ROWS or len(values) > COLUMNS:
                    raise ValueError("Limite de 10 mil linhas e 100 colunas por aba.")
                for col, value in enumerate(values):
                    if value:
                        sheet["cells"][f"{row},{col}"] = "'" + value if value.startswith(("=", "'")) else value
                if len(sheet["cells"]) > MAX_CELLS:
                    raise ValueError("Limite de 50 mil valores e estilos por pasta.")
        sheets = [sheet]
    validate(sheets)
    return sheets


def literal(value):
    return value[1:] if value.startswith("'") else value


def export(sheets, destination, fmt, sheet_index=0):
    if fmt not in FORMATS or type(sheet_index) is not int or not 0 <= sheet_index < len(sheets):
        raise ValueError("Formato ou aba de exportação inválido.")
    destination = Path(destination).with_suffix("." + fmt)
    with NamedTemporaryFile(dir=destination.parent, suffix="." + fmt, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        if fmt == "xlsx":
            from openpyxl import Workbook
            from openpyxl.styles import Font

            book = Workbook()
            book.remove(book.active)
            for sheet in sheets:
                output = book.create_sheet(sheet["name"])
                for key in set(sheet["cells"]) | set(sheet["bold"]):
                    row, col = map(int, key.split(","))
                    cell = output.cell(row + 1, col + 1)
                    raw = sheet["cells"].get(key, "")
                    formula = safe_formula(raw) if raw.startswith("=") else None
                    if formula:
                        cell.value = formula
                    elif re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?", raw) and len(raw) <= 15:
                        cell.value = float(raw) if "." in raw else int(raw)
                    else:
                        cell.value = literal(raw)
                        cell.data_type = "s"
                for key in sheet["bold"]:
                    row, col = map(int, key.split(","))
                    output.cell(row + 1, col + 1).font = Font(bold=True)
            book.save(temporary)
        else:
            cells = sheets[sheet_index]["cells"]
            positions = [tuple(map(int, key.split(","))) for key in cells]
            height = max((row for row, _ in positions), default=-1) + 1
            width = max((col for _, col in positions), default=-1) + 1
            with temporary.open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.writer(stream, delimiter="\t" if fmt == "tsv" else ",")
                for row in range(height):
                    values = []
                    for col in range(width):
                        value = literal(cells.get(f"{row},{col}", ""))
                        risky = value.lstrip().startswith(("=", "+", "-", "@")) and not re.fullmatch(r"-\d+(?:\.\d+)?", value)
                        values.append("'" + value if risky else value)
                    writer.writerow(values)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return {"name": destination.name}


def append_delimited(sheets, index, path):
    """Prepare a bounded append to the current sheet without mutating the draft."""
    from apps.open_doc.datasets.store import delimited

    validate(sheets)
    if type(index) is not int or not 0 <= index < len(sheets):
        raise ValueError("Aba inválida.")
    if path.suffix.lower() not in (".csv", ".tsv"):
        raise ValueError("Selecione um CSV ou TSV.")
    if path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError("Arquivo grande para a grade. Use a área Dados.")
    sheet = sheets[index]
    cells = sheet["cells"]
    used = [tuple(map(int, key.split(","))) for key in cells]
    header_columns = sorted(col for row, col in used if row == 0)
    if not header_columns or header_columns != list(range(len(header_columns))):
        raise ValueError("A linha 1 precisa ter um cabeçalho contínuo, começando em A1.")
    columns = [literal(cells[f"0,{col}"]).strip() for col in header_columns]
    if any(not column for column in columns) or len(set(columns)) != len(columns):
        raise ValueError("O cabeçalho da planilha deve ter nomes preenchidos e únicos.")
    start = max(row for row, _ in used) + 1
    entries = {}
    added = 0
    with delimited(path, "utf-8-sig", "auto") as (header, reader):
        if set(header) != set(columns):
            raise ValueError("As colunas do arquivo não correspondem ao cabeçalho da aba.")
        positions = {name: column for column, name in enumerate(columns)}
        order = [positions[name] for name in header]
        for values in reader:
            if not values:
                continue
            if start + added >= ROWS:
                raise ValueError("A aba ultrapassaria 10 mil linhas. Use a área Dados.")
            if len(values) != len(header):
                raise ValueError(f"Registro até a linha {reader.line_num} com número de campos inválido.")
            for col, value in zip(order, values):
                if value:
                    entries[f"{start + added},{col}"] = "'" + value if value.startswith(("=", "'")) else value
            added += 1
    result = list(sheets)
    result[index] = {**sheet, "cells": cells | entries}
    validate(result)
    return {"entries": entries, "added": added}

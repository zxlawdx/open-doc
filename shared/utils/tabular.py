"""Delimited text and scalar conversion utilities shared by table consumers."""

import csv
from contextlib import contextmanager

ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")
DELIMITERS = (",", ";", "\t", "|")


@contextmanager
def delimited(path, encoding, delimiter):
    if encoding not in ENCODINGS or (
        delimiter != "auto" and delimiter not in DELIMITERS
    ):
        raise ValueError("Codificação ou separador inválido.")
    with path.open(encoding=encoding, newline="") as stream:
        if delimiter == "auto":
            sample = stream.read(16384)
            stream.seek(0)
            try:
                delimiter = (
                    csv.Sniffer()
                    .sniff(sample, delimiters="".join(DELIMITERS))
                    .delimiter
                )
            except csv.Error:
                delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
        reader = csv.reader(stream, delimiter=delimiter, strict=True)
        header = [column.strip() for column in next(reader, [])]
        if not header or not all(header) or len(set(header)) != len(header):
            raise ValueError(
                f"{path.name}: o cabeçalho deve ter nomes preenchidos e únicos."
            )
        yield header, reader


def typed_value(value, kind):
    """Adapt a *copy* of explicitly typed data for read-only SQL, without changing source."""
    from decimal import Decimal, InvalidOperation
    from datetime import date

    if value is None or kind in {"auto", "text"}:
        return value
    if kind == "boolean":
        token = str(value).strip().casefold()
        if token in {"sim", "true", "1", "verdadeiro"}:
            return 1
        if token in {"não", "nao", "false", "0", "falso"}:
            return 0
        return value
    if kind in {"integer", "decimal", "currency", "percent"}:
        token = str(value).strip().replace("\u00a0", "").replace(" ", "")
        token = token.removeprefix("R$").replace("%", "")
        if "," in token and "." in token:
            token = (
                token.replace(".", "").replace(",", ".")
                if token.rfind(",") > token.rfind(".")
                else token.replace(",", "")
            )
        elif "," in token:
            token = token.replace(",", ".")
        elif token.count(".") > 1 or (
            token.count(".") == 1
            and len(token.split(".")[1]) == 3
            and 1 <= len(token.split(".")[0]) <= 3
        ):
            token = token.replace(".", "")
        try:
            number = Decimal(token)
            if not number.is_finite():
                return value
            if kind == "percent" and str(value).strip().endswith("%"):
                number /= 100
            if kind == "integer":
                integer = int(number)
                return (
                    integer
                    if number == integer and -(2**63) <= integer < 2**63
                    else value
                )
            converted = float(number)
            return (
                converted if converted not in (float("inf"), float("-inf")) else value
            )
        except (InvalidOperation, ValueError, OverflowError):
            return value
    if kind == "date":
        parts = str(value).split("/")
        if len(parts) == 3:
            try:
                return date(int(parts[2]), int(parts[1]), int(parts[0])).isoformat()
            except ValueError:
                return value
    return value

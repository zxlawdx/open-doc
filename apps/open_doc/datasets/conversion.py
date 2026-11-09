"""Explicit, preview-first dataset conversions.

Never changes raw values merely because the semantic type changes.
Conversions are bounded, checked against the preview token and applied atomically
with their schema metadata and a reversible history entry.
"""
import hashlib
import json
import re
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation


SUPPORTED = {"auto", "text", "integer", "decimal", "currency", "percent",
             "date", "time", "datetime", "boolean"}
MAX_CONVERSION_CELLS = 50000


def canonical(value, kind):
    if value == "" or kind in {"auto", "text"}:
        return value
    raw = value.strip()
    if kind in {"integer", "decimal", "currency", "percent"}:
        cleaned = re.sub(r"\s|\u00a0", "", raw)
        if kind == "currency":
            cleaned = re.sub(r"^R\$", "", cleaned, flags=re.I)
        percent = cleaned.endswith("%")
        if percent:
            cleaned = cleaned[:-1]
        if not re.fullmatch(r"[+-]?[\d.,]+", cleaned):
            raise ValueError("Número inválido.")
        if "." in cleaned and "," in cleaned:
            cleaned = (cleaned.replace(".", "").replace(",", ".")
                       if cleaned.rfind(",") > cleaned.rfind(".") else cleaned.replace(",", ""))
        elif "," in cleaned:
            cleaned = cleaned.replace(",", ".")
        elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+", cleaned):
            cleaned = cleaned.replace(".", "")
        try:
            numeric = Decimal(cleaned)
            if not numeric.is_finite():
                raise ValueError("Número não finito.")
            if percent and kind == "percent":
                numeric /= 100
            if kind == "integer" and numeric != numeric.to_integral_value():
                raise ValueError("Valor não é inteiro.")
            if kind == "integer" and abs(numeric) >= Decimal(2)**63:
                raise ValueError("Inteiro fora do limite de 64 bits.")
            return format(numeric.normalize(), "f")
        except InvalidOperation as error:
            raise ValueError("Número inválido.") from error
    if kind == "boolean":
        term = raw.casefold()
        if term in {"sim", "true", "1", "verdadeiro"}:
            return "true"
        if term in {"não", "nao", "false", "0", "falso"}:
            return "false"
        raise ValueError("Booleano esperado: sim/não, true/false ou 1/0.")
    if kind == "date":
        try:
            converted = date.fromisoformat(raw)
        except ValueError:
            try:
                converted = datetime.strptime(raw, "%d/%m/%Y").date()
            except ValueError as error:
                raise ValueError("Data esperada em DD/MM/AAAA ou AAAA-MM-DD.") from error
        return converted.isoformat()
    if kind == "time":
        try:
            converted = time.fromisoformat(raw)
        except ValueError as error:
            raise ValueError("Hora esperada em HH:MM[:SS].") from error
        return converted.isoformat(timespec="seconds")
    if kind == "datetime":
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            for pattern in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
                try:
                    parsed = datetime.strptime(raw, pattern)
                    break
                except ValueError:
                    continue
            else:
                raise ValueError("Data/hora esperada em ISO 8601 ou DD/MM/AAAA HH:MM.")
        return parsed.isoformat(timespec="seconds")
    raise ValueError("Tipo de conversão não reconhecido.")


def bounds(dataset, scope, column, row=None, last_row=None, last_column=None):
    cols = len(json.loads(dataset["columns_json"]))
    total = dataset["row_count"]
    if type(column) is not int or not 0 <= column < cols or scope not in {"column", "cell", "selection"}:
        raise ValueError("Escopo ou coluna inválida.")
    if scope == "column":
        start_row, end_row, start_col, end_col = 1, total, column, column
    elif scope == "cell":
        start_row = end_row = row
        start_col = end_col = column
    else:
        start_row, end_row, start_col, end_col = row, last_row, column, last_column
    if (any(type(v) is not int for v in (start_row, end_row, start_col, end_col))
            or not 1 <= start_row <= end_row <= total
            or not 0 <= start_col <= end_col < cols
            or (end_row-start_row+1)*(end_col-start_col+1) > MAX_CONVERSION_CELLS):
        raise ValueError("Converta no máximo 50 mil células por operação; use uma seleção menor.")
    return start_row, end_row, start_col, end_col


def plan(db, dataset, scope, column, kind, row=None, last_row=None, last_column=None):
    if kind not in SUPPORTED or not isinstance(kind, str):
        raise ValueError("Tipo inválido.")
    region = bounds(dataset, scope, column, row, last_row, last_column)
    r0, r1, c0, c1 = region
    overrides = {}
    if scope == "column":
        overrides = {
            entry["row_number"]: entry["kind"] for entry in db.execute(
                "SELECT row_number,kind FROM dataset_field_types "
                "WHERE dataset_id=? AND scope='cell' AND column_number=? AND row_number BETWEEN ? AND ?",
                (dataset["id"], column, r0, r1),
            )
        }
    count, changed, incompatible, exceptions, invalid_count = 0, [], [], 0, 0
    digest = hashlib.sha256()
    digest.update(json.dumps(
        [dataset["id"], scope, column, kind, region], separators=(",", ":")
    ).encode())
    rows = db.execute(
        "SELECT number,values_json FROM dataset_rows "
        "WHERE dataset_id=? AND number BETWEEN ? AND ? ORDER BY number",
        (dataset["id"], r0, r1),
    )
    for record in rows:
        row_id = record["number"]
        cells = json.loads(record["values_json"])
        for c in range(c0, c1 + 1):
            value = cells[c]
            inherited = overrides.get(row_id) if scope == "column" else None
            digest.update(json.dumps([row_id, c, value, inherited],
                                     ensure_ascii=False, separators=(",", ":")).encode())
            if inherited is not None:
                exceptions += 1
                continue
            count += 1
            try:
                converted = canonical(value, kind)
            except ValueError as error:
                invalid_count += 1
                if len(incompatible) < 15:
                    incompatible.append({"row": row_id, "column": c, "value": value[:100],
                                         "reason": str(error)})
            else:
                if converted != value:
                    changed.append([row_id, c, value, converted])
    # The digest includes *all* original data and exceptions, not merely the sample.
    return {
        "token": digest.hexdigest(), "count": count, "changed": len(changed),
        "invalid": invalid_count, "invalid_sample": incompatible[:10],
        "exceptions": exceptions, "sample": [
            {"row": r, "column": c, "before": before[:100], "after": after[:100]}
            for r, c, before, after in changed[:10]
        ],
        "changes": changed, "region": region,
    }

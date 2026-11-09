import json

import pytest

from apps.open_doc.datasets.store import Datasets
from apps.open_doc.spreadsheets.store import validate


@pytest.fixture()
def store(tmp_path):
    (tmp_path / ".veladata").mkdir()
    service = Datasets(tmp_path)
    service.initialize()
    source = tmp_path / "medicoes.csv"
    source.write_text(
        "municipio;quantidade;data\n"
        "Porto Velho;1.234,56;18/08/2026\n"
        "Ariquemes;25,5;19/08/2026\n", encoding="utf-8",
    )
    identifier = service.import_files([source], delimiter=";")["id"]
    return service, identifier


def test_edit_cell_atomically_preserves_original_file_and_leading_zeroes(store):
    service, identifier = store
    assert service.cell(identifier, 1, 1)["value"] == "1.234,56"
    first = service.edit_cell(identifier, 1, 1, "000123")
    assert first["previous"] == "1.234,56"
    assert service.page(identifier, 0, 0)["rows"][0][1] == "000123"
    assert service.query(identifier, 'SELECT quantidade FROM dados LIMIT 1')["rows"] == [["000123"]]
    service.edit_cell(identifier, 1, 1, first["previous"])
    assert service.cell(identifier, 1, 1)["value"] == "1.234,56"
    with pytest.raises(ValueError):
        service.edit_cell(identifier, 0, 0, "erro")
    with pytest.raises(ValueError):
        service.edit_cell(identifier, 1, 10, "erro")
    with pytest.raises(ValueError):
        service.edit_cell(identifier, 1, 1, "x" * 8193)


def test_type_column_cell_and_selection_are_non_destructive_and_persistent(store):
    service, identifier = store
    assert service.set_type(identifier, "column", 1, "decimal")["updated"] == 1
    assert service.set_type(identifier, "cell", 1, "integer", row=1)["updated"] == 1
    result = service.page(identifier, 0, 0)
    assert result["types"]["columns"]["1"] == "decimal"
    assert result["types"]["cells"]["1,1"] == "integer"
    assert result["rows"][0][1] == "1.234,56"
    service.set_type(identifier, "selection", 0, "text", row=1, last_row=2, last_column=1)
    result = service.page(identifier, 0, 0)
    assert result["types"]["cells"]["1,0"] == "text"
    assert result["types"]["cells"]["2,1"] == "text"
    with pytest.raises(ValueError):
        service.set_type(identifier, "column", 1, "arbitrary")
    with pytest.raises(ValueError):
        service.set_type(identifier, "selection", 0, "text", row=2, last_row=1, last_column=1)


def test_types_and_pivot_configuration_validate_without_changing_raw_values():
    source = {"name": "Dados", "cells": {"0,0": "Grupo", "1,0": "A"}, "bold": [],
              "types": {"columns": {"0": "text"}, "cells": {"1,0": "auto"}}}
    result = {"name": "Tabela dinâmica", "cells": {"0,0": "Grupo", "1,0": "A"},
              "bold": ["0,0"], "pivot": {
                  "source": 0, "range": [0, 0, 1, 0],
                  "config": {"rows": [0], "columns": [],
                             "values": [{"field": 0, "operation": "count", "show": "value", "decimals": 2}],
                             "filters": [], "totals": True},
              }}
    encoded = validate([source, result])
    assert json.loads(encoded)[1]["pivot"]["source"] == 0
    assert source["cells"]["1,0"] == "A"
    result["pivot"]["config"]["values"][0]["operation"] = "unsafe"
    with pytest.raises(ValueError, match="Métrica inválida"):
        validate([source, result])
    result["pivot"]["config"]["values"][0]["operation"] = "count"
    source["types"]["columns"]["0"] = "bad-type"
    with pytest.raises(ValueError, match="Tipo"):
        validate([source, result])


def test_dataset_sql_reads_explicit_ptbr_types_without_modifying_source(store):
    service, identifier = store
    service.set_type(identifier, "column", 1, "decimal")
    rows = service.query(identifier, 'SELECT quantidade FROM dados ORDER BY quantidade DESC')["rows"]
    assert rows == [["1234.56"], ["25.5"]]
    assert service.query(identifier, 'SELECT ROUND(SUM(quantidade),2) FROM dados')["rows"] == [["1260.06"]]
    assert service.cell(identifier, 1, 1)["value"] == "1.234,56"
    service.set_type(identifier, "column", 2, "date")
    assert service.query(identifier, "SELECT data FROM dados LIMIT 1")["rows"] == [["2026-08-18"]]
    for attempted_sql in ("SELECT * FROM dataset_field_types",
                          "SELECT kind FROM dataset_field_types LIMIT 1"):
        with pytest.raises(ValueError):
            service.query(identifier, attempted_sql)

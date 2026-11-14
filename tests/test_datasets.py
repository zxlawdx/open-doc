import pytest

from apps.data.services.store import Datasets
from apps.open_doc.spreadsheets.files import append_delimited


@pytest.fixture
def store(tmp_path):
    (tmp_path / ".veladata").mkdir()
    datasets = Datasets(tmp_path)
    datasets.initialize()
    return datasets


def test_import_and_append_over_one_million_rows(tmp_path, store):
    first = tmp_path / "2023.csv"
    second = tmp_path / "2024.csv"
    with first.open("w") as stream:
        stream.write("id,ano\n")
        for row in range(600000):
            stream.write(f"{row:07d},2023\n")
    with second.open("w") as stream:
        stream.write("ano,id\n")
        for row in range(500000):
            stream.write(f"2024,{row:07d}\n")
    created = store.import_files([first])
    assert created["row_count"] == 600000
    appended = store.import_files([second], created["id"])
    assert appended["row_count"] == 1100000
    reopened = Datasets(tmp_path)
    result = reopened.page(created["id"], 599999, 0)
    assert result["rows"][:2] == [["0599999", "2023"], ["0000000", "2024"]]
    assert result["source_count"] == 2
    assert reopened.page(created["id"], 1099999, 1)["rows"] == [["2024"]]


def test_mismatched_or_malformed_batch_leaves_dataset_unchanged(tmp_path, store):
    good = tmp_path / "good.csv"
    good.write_text("id;nome\n001;Ana\n", encoding="utf-8")
    broken = tmp_path / "broken.csv"
    dataset = store.import_files([good])
    for text in ("id;municipio\n002;A\n", "id;nome\n002;A\n003\n"):
        broken.write_text(text, encoding="utf-8")
        with pytest.raises(ValueError):
            store.import_files([good, broken], dataset["id"], delimiter=";")
        assert store.page(dataset["id"], 0, 0)["rows"] == [["001", "Ana"]]
        assert store.page(dataset["id"], 0, 0)["source_count"] == 1


@pytest.mark.parametrize("line_break", ["\n", "\r\n"])
def test_dynamic_width_encoding_and_quoted_newline(tmp_path, store, line_break):
    source = tmp_path / "wide.tsv"
    header = [f"coluna{i}" for i in range(130)]
    values = [""] * 129 + [f'"ação{line_break}2024"']
    source.write_bytes(("\t".join(header) + "\n" + "\t".join(values) + "\n").encode("cp1252"))
    dataset = store.import_files([source], encoding="cp1252", delimiter="\t")
    result = store.page(dataset["id"], 0, 129)
    assert result["column_count"] == 130
    assert result["rows"] == [[f"ação{line_break}2024"]]


def test_append_to_existing_workbook_maps_columns_without_overwriting(tmp_path):
    source = tmp_path / "2024.csv"
    source.write_text("ano,id\n2024,00002\n", encoding="utf-8")
    cells = {"0,0": "id", "0,1": "ano", "1,0": "00001", "1,1": "2023"}
    sheets = [{"name": "Dados", "cells": cells, "bold": ["0,0"]}]
    result = append_delimited(sheets, 0, source)
    assert result == {"entries": {"2,0": "00002", "2,1": "2024"}, "added": 1}
    assert "2,0" not in cells


def test_sql_queries_only_selected_dataset_and_caps_results(tmp_path, store):
    path = tmp_path / "origem.csv"
    path.write_text("id;Nome do município\n" + "001;Porto Velho\n" * 110, encoding="utf-8")
    identifier = store.import_files([path])["id"]
    store.import_files([path])
    assert store.query(identifier, 'SELECT "Nome do município", COUNT(*) FROM dados GROUP BY 1')["rows"] == [
        ["Porto Velho", "110"]
    ]
    result = store.query(identifier, "SELECT id FROM dados")
    assert result["limited"] and len(result["rows"]) == 100
    assert result["rows"][0] == ["001"]
    for sql in ("DELETE FROM dados", "SELECT * FROM dataset_rows", "ATTACH DATABASE ':memory:' AS x",
                "PRAGMA table_info(dados)", "SELECT randomblob(100000000)",
                "WITH dados AS (SELECT * FROM dataset_rows) SELECT * FROM dados"):
        with pytest.raises(ValueError):
            store.query(identifier, sql)

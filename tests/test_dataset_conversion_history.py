import csv
from pathlib import Path

import pytest

from apps.open_doc.datasets.conversion import canonical
from apps.open_doc.datasets.store import Datasets


@pytest.fixture()
def data(tmp_path):
    (tmp_path / ".veladata").mkdir()
    file = tmp_path / "valores.csv"
    file.write_text("id;valor;data\n001;1.234,56;18/08/2026\n002;abc;19/08/2026\n"
                    "003;25,5;20/08/2026\n", encoding="utf-8")
    datasets = Datasets(tmp_path)
    datasets.initialize()
    identifier = datasets.import_files([file], delimiter=";")["id"]
    return datasets, identifier, tmp_path


@pytest.mark.parametrize(("value", "kind", "expected"), [
    ("1.234,56", "decimal", "1234.56"),
    ("R$ 1.234,56", "currency", "1234.56"),
    ("12,5%", "percent", "0.125"),
    ("000123", "integer", "123"),
    ("18/08/2026", "date", "2026-08-18"),
    ("15:17", "time", "15:17:00"),
    ("18/08/2026 15:17", "datetime", "2026-08-18T15:17:00"),
    ("2026-11-09T15:17:00-03:00", "datetime", "2026-11-09T15:17:00-03:00"),
    ("não", "boolean", "false"),
])
def test_conversion_canonical_locale_types(value, kind, expected):
    assert canonical(value, kind) == expected


@pytest.mark.parametrize(("value", "kind"), [
    ("31/02/2026", "date"), ("texto", "decimal"), ("1,2", "integer"),
    ("25:15", "time"), ("talvez", "boolean"), ("2026-05-01 40:66", "datetime")
])
def test_conversion_canonical_invalid_values(value, kind):
    with pytest.raises(ValueError):
        canonical(value, kind)


def test_preview_and_confirmation_are_separate_and_reversible_after_reopen(data):
    service, identifier, root = data
    before = service.page(identifier, 0, 0)["rows"]
    scan = service.conversion_preview(identifier, "column", 1, "decimal")
    assert scan["count"] == 3
    assert scan["changed"] == 2
    assert scan["invalid"] == 1
    assert scan["sample"][0]["after"] == "1234.56"
    assert service.page(identifier, 0, 0)["rows"] == before
    with pytest.raises(ValueError, match="confirmação"):
        service.conversion_commit(identifier, "column", 1, "decimal", scan["token"])
    with pytest.raises(ValueError, match="incompatíveis"):
        service.conversion_commit(identifier, "column", 1, "decimal", scan["token"], confirm=True)
    assert service.page(identifier, 0, 0)["rows"] == before
    answer = service.conversion_commit(identifier, "column", 1, "decimal", scan["token"],
                                       confirm=True, on_invalid="keep")
    assert answer["converted"] == 2 and answer["invalid"] == 1
    reopened = Datasets(root)
    result = reopened.page(identifier, 0, 0)
    assert result["rows"][0][1] == "1234.56"
    assert result["rows"][1][1] == "abc"
    assert result["rows"][2][1] == "25.5"
    assert result["types"]["columns"]["1"] == "decimal"
    assert reopened.undo(identifier)["changed"]
    restored = reopened.page(identifier, 0, 0)
    assert restored["rows"] == before
    assert "1" not in restored["types"]["columns"]
    assert reopened.undo(identifier, redo=True)["changed"]
    assert reopened.page(identifier, 0, 0)["rows"][0][1] == "1234.56"


def test_converted_values_refuse_stale_previews(data):
    store, identifier, _ = data
    report = store.conversion_preview(identifier, "cell", 1, "decimal", row=1)
    store.edit_cell(identifier, 1, 1, "7,5")
    with pytest.raises(ValueError, match="mudaram"):
        store.conversion_commit(identifier, "cell", 1, "decimal",
                                report["token"], row=1, confirm=True)
    assert store.cell(identifier, 1, 1)["value"] == "7,5"


def test_column_conversion_preserves_explicit_cell_exceptions(data):
    store, identifier, _ = data
    store.set_type(identifier, "cell", 1, "text", row=1)
    report = store.conversion_preview(identifier, "column", 1, "decimal")
    assert report["exceptions"] == 1
    answer = store.conversion_commit(identifier, "column", 1, "decimal",
                                     report["token"], confirm=True, on_invalid="keep")
    assert answer["exceptions"] == 1
    assert store.cell(identifier, 1, 1)["value"] == "1.234,56"
    assert store.cell(identifier, 3, 1)["value"] == "25.5"
    assert store.page(identifier, 0, 0)["types"]["cells"]["1,1"] == "text"


def test_type_and_edit_history_persists_across_instances_and_redo_is_invalidated(data):
    store, identifier, root = data
    store.set_type(identifier, "column", 1, "currency")
    store.edit_cell(identifier, 1, 0, "009")
    reopened = Datasets(root)
    assert [entry["operation"] for entry in reopened.history(identifier)["entries"][:2]] == ["edit", "type"]
    assert reopened.undo(identifier)["operation"] == "edit"
    assert reopened.cell(identifier, 1, 0)["value"] == "001"
    assert reopened.undo(identifier)["operation"] == "type"
    assert reopened.page(identifier, 0, 0)["types"]["columns"] == {}
    assert reopened.undo(identifier, redo=True)["operation"] == "type"
    reopened.edit_cell(identifier, 1, 0, "010")
    assert not reopened.undo(identifier, redo=True)["changed"]


def test_conversion_size_guard_on_large_column(tmp_path):
    (tmp_path / ".veladata").mkdir()
    file = tmp_path / "grande.csv"
    with file.open("w", encoding="utf-8", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(["valor"])
        for i in range(50001):
            writer.writerow([i])
    service = Datasets(tmp_path)
    service.initialize()
    identifier = service.import_files([file])["id"]
    with pytest.raises(ValueError, match="50 mil"):
        service.conversion_preview(identifier, "column", 0, "integer")
    report = service.conversion_preview(identifier, "cell", 0, "integer", row=1)
    assert report["count"] == 1


def test_one_thousand_edits_have_bounded_persistent_history(data):
    store, identifier, root = data
    for i in range(1000):
        store.edit_cell(identifier, 1, 0, str(i))
    assert store.cell(identifier, 1, 0)["value"] == "999"
    assert len(Datasets(root).history(identifier, limit=200)["entries"]) == 100
    assert store.undo(identifier)["changed"]
    assert store.cell(identifier, 1, 0)["value"] == "998"

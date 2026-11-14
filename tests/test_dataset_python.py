import csv

import pytest

from apps.code.services import python_runner
from apps.data.services.store import Datasets


@pytest.fixture
def dataset(tmp_path):
    (tmp_path / ".veladata").mkdir()
    store = Datasets(tmp_path)
    store.initialize()
    source = tmp_path / "origem.csv"
    source.write_bytes('id,descrição\r\n001,"primeira\r\nsegunda"\r\n'.encode())
    return store, store.import_files([source], delimiter=",")["id"]


def test_csv_export_preserves_raw_values_and_existing_destination_on_failure(tmp_path, dataset):
    store, identifier = dataset
    destination = tmp_path / "saida.csv"
    assert python_runner.export_csv(store, identifier, destination) == {"name": "saida.csv", "rows": 1}
    with destination.open(encoding="utf-8", newline="") as stream:
        assert list(csv.reader(stream)) == [["id", "descrição"], ["001", "primeira\r\nsegunda"]]
    before = destination.read_bytes()
    with pytest.raises(ValueError, match="Dataset não encontrado"):
        python_runner.export_csv(store, "invalid", destination)
    assert destination.read_bytes() == before


def test_python_uses_selected_snapshot_and_captures_script_errors(dataset):
    store, identifier = dataset
    result = python_runner.run_python(store, identifier, """
from __future__ import annotations
import csv
with DATASET_CSV.open(encoding="utf-8", newline="") as stream:
    print(next(csv.DictReader(stream))["id"])
""".lstrip())
    assert result == {"output": "001\n", "returncode": 0, "stopped": None, "rows": 1}
    failed = python_runner.run_python(store, identifier, 'raise ValueError("ação")')
    assert failed["returncode"] and "ValueError: ação" in failed["output"]


def test_python_limits_runtime_and_output(dataset, monkeypatch):
    store, identifier = dataset
    monkeypatch.setattr(python_runner, "TIMEOUT", 0.2)
    result = python_runner.run_python(store, identifier, "import time; time.sleep(10)")
    assert result["stopped"] == "timeout"
    monkeypatch.setattr(python_runner, "TIMEOUT", 5)
    result = python_runner.run_python(store, identifier, 'print("x" * 100000)')
    assert result["stopped"] == "output"
    assert len(result["output"]) == python_runner.MAX_OUTPUT

from io import StringIO

import pytest

from apps.open_doc.datasets.worksheet import WorksheetSnapshot


def test_worksheet_snapshot_supports_sql_and_csv():
    snapshot = WorksheetSnapshot(["Município", "Cota"], [["Porto Velho", "15"], ["Porto Velho", "27"]])
    result = snapshot.query('SELECT "Município", SUM(CAST(Cota AS INTEGER)) FROM dados GROUP BY 1')
    assert result["rows"] == [["Porto Velho", "42"]]
    with pytest.raises(ValueError):
        snapshot.query("DELETE FROM dados")
    output = StringIO(newline="")
    assert snapshot.write_csv(None, output) == 2
    assert output.getvalue().splitlines() == ["Município,Cota", "Porto Velho,15", "Porto Velho,27"]


@pytest.mark.parametrize("columns,rows", [(["A", "a"], []), (["A"], [["1", "2"]]), (["A"], [[1]])])
def test_invalid_worksheet_snapshots_are_rejected(columns, rows):
    with pytest.raises(ValueError):
        WorksheetSnapshot(columns, rows)

from io import StringIO

import pytest

from apps.data.services.worksheet import WorksheetSnapshot


def test_worksheet_snapshot_supports_sql_and_csv():
    snapshot = WorksheetSnapshot(["Município", "Cota"], [["Porto Velho", "15"], ["Porto Velho", "27"]])
    result = snapshot.query('SELECT "Município", SUM(CAST(Cota AS INTEGER)) FROM dados GROUP BY 1')
    assert result["rows"] == [["Porto Velho", 42]]
    with pytest.raises(ValueError):
        snapshot.query("DELETE FROM dados")
    output = StringIO(newline="")
    assert snapshot.write_csv(None, output) == 2
    assert output.getvalue().splitlines() == ["Município,Cota", "Porto Velho,15", "Porto Velho,27"]


@pytest.mark.parametrize("columns,rows", [(["A", "a"], []), (["A"], [["1", "2"]]), (["A"], [[{}]])])
def test_invalid_worksheet_snapshots_are_rejected(columns, rows):
    with pytest.raises(ValueError):
        WorksheetSnapshot(columns, rows)


def test_native_worksheet_numbers_booleans_and_nulls_are_not_csv_strings():
    snapshot=WorksheetSnapshot(['number','flag','empty'],[[0,False,None],[2,True,None]])
    assert snapshot.query('SELECT SUM(number),SUM(flag),COUNT(empty) FROM dados')['rows']==[[2,1,0]]

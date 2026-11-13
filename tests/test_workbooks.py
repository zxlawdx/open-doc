import pytest
from openpyxl import Workbook, load_workbook

from apps.open_doc.application.context import configure
from apps.open_doc.services.document_service import RevisionConflict
from apps.open_doc.services.preferences_service import Config
from apps.open_doc.spreadsheets import files, templates


def test_workbook_is_independent_reopens_and_restores(tmp_path):
    config = Config(tmp_path)
    context = configure(config)
    original = templates.create(context.workbooks, "sheet-budget")
    clone = templates.create(context.workbooks, "sheet-budget")
    assert original["id"] != clone["id"]
    sheets = original["sheets"]
    sheets[0]["cells"]["1,1"] = "2000"
    updated = context.workbooks.save(original["id"], 1, "Orçamento", sheets)
    assert updated["revision"] == 2
    with pytest.raises(RevisionConflict):
        context.workbooks.save(original["id"], 1, "Versão antiga", sheets)
    context = configure(config)
    assert context.workbooks.get(original["id"]) == updated
    assert context.workbooks.get(clone["id"])["sheets"][0]["cells"]["1,1"] == "1500"
    previous = context.workbooks.versions(original["id"])[1]
    restored = context.workbooks.save(
        original["id"], 2, None, None, restore=previous["id"]
    )
    assert restored["revision"] == 3
    assert restored["sheets"][0]["cells"]["1,1"] == "1500"
    assert len(context.workbooks.versions(original["id"])) == 3
    assert len(templates.catalog()) == 5


@pytest.mark.parametrize("extension, delimiter", [("csv", ";"), ("tsv", "\t")])
def test_delimited_text_preserves_leading_zeroes_and_does_not_create_formula(
    tmp_path, extension, delimiter
):
    source = tmp_path / f"entrada.{extension}"
    source.write_text(f"id{delimiter}nome\n00123{delimiter}Ana\n", encoding="utf-8")
    sheets = files.read(source)
    assert sheets[0]["cells"]["1,0"] == "00123"
    destination = tmp_path / f"saída.{extension}"
    files.export(sheets, destination, extension)
    assert files.read(destination) == sheets
    source.write_text(f"id{delimiter}texto\n00123{delimiter}=1+2\n", encoding="utf-8")
    assert files.read(source)[0]["cells"]["1,1"] == "'=1+2"


def test_xlsx_roundtrip_multiple_sheets_formula_text_and_bold(tmp_path):
    book = Workbook()
    book.active.title = "Dados"
    book.active["A1"] = "00001"
    book.active["A2"] = 15
    book.create_sheet("Resumo")["B2"] = "=Dados!A2*2"
    book["Resumo"]["B3"] = '=WEBSERVICE("https://example.invalid/")'
    source = tmp_path / "source.xlsx"
    book.save(source)
    sheets = files.read(source)
    assert sheets[1]["cells"]["1,1"] == "=Dados!A2*2"
    sheets[0]["bold"] = ["0,0"]
    output = tmp_path / "output.xlsx"
    files.export(sheets, output, "xlsx")
    checked = load_workbook(output)
    assert checked.sheetnames == ["Dados", "Resumo"]
    assert checked["Dados"]["A1"].value == "00001"
    assert checked["Dados"]["A1"].font.bold
    assert checked["Resumo"]["B2"].data_type == "f"
    assert checked["Resumo"]["B3"].data_type == "s"
    assert files.read(output) == sheets


def test_xlsx_entity_is_rejected(tmp_path):
    from zipfile import ZipFile

    source = tmp_path / "normal.xlsx"
    workbook = Workbook()
    workbook.active["A1"] = "EXAMPLE"
    workbook.save(source)
    poisoned = tmp_path / "entidade.xlsx"
    with ZipFile(source) as original, ZipFile(poisoned, "w") as modified:
        for entry in original.infolist():
            content = original.read(entry)
            if entry.filename == "xl/worksheets/sheet1.xml":
                content = (
                    b'<!DOCTYPE worksheet [<!ENTITY attack "unsafe">]>'
                    + content.replace(b"EXAMPLE", b"&attack;")
                )
            modified.writestr(entry, content)
    with pytest.raises(ValueError, match="XLSX inválido"):
        files.read(poisoned)


def test_workbook_styles_survive_local_reopen_and_xlsx(tmp_path):
    context = configure(Config(tmp_path / "workspace"))
    book = templates.create(context.workbooks, "sheet-budget")
    styles = {
        "1,1": {
            "family": "Arial",
            "size": 14,
            "italic": True,
            "underline": True,
            "strike": True,
            "align": "right",
            "wrap": True,
            "border": True,
            "color": "#103060",
            "fill": "#f0f3fa",
        }
    }
    book["sheets"][0]["styles"] = styles
    updated = context.workbooks.save(
        book["id"], book["revision"], book["title"], book["sheets"]
    )
    assert context.workbooks.get(book["id"])["sheets"][0]["styles"] == styles
    xlsx = tmp_path / "formatado.xlsx"
    files.export(updated["sheets"], xlsx, "xlsx")
    assert files.read(xlsx)[0]["styles"] == styles
    styles["1,1"]["color"] = "url(https://example.invalid)"
    with pytest.raises(ValueError, match="Cor de célula inválida"):
        context.workbooks.save(
            book["id"], updated["revision"], book["title"], book["sheets"]
        )


def test_import_preserves_geometry_merges_freeze_and_tracker_formulas(tmp_path):
    from openpyxl.styles import Alignment
    from apps.open_doc.spreadsheets.store import validate

    book = Workbook()
    source = book.active
    source.title = "Tracker"
    source["A2"] = "Título mesclado"
    source.merge_cells("A2:F2")
    source.column_dimensions["B"].width = 33
    source.row_dimensions[6].height = 100
    source.freeze_panes = "A6"
    source.sheet_view.showGridLines = False
    source["B6"] = "Texto longo para quebra automática"
    source["B6"].alignment = Alignment(wrap_text=True, vertical="center")
    source["B6"].number_format = "0.0"
    source["E8"] = '=IF(COUNT(B8:D8)=0,"",AVERAGE(B8:D8))'
    original = tmp_path / "reference.xlsx"
    book.save(original)
    sheets = files.read(original)
    assert sheets[0]["layout"]["columns"]["1"] == 236
    assert sheets[0]["layout"]["rows"]["5"] == pytest.approx(400 / 3)
    assert sheets[0]["layout"]["merges"] == [[1, 0, 1, 5]]
    assert sheets[0]["layout"]["freeze"] == [5, 0]
    assert sheets[0]["cells"]["7,4"].startswith("=IF(")
    assert sheets[0]["styles"]["5,1"]["valign"] == "center"
    sheets[0]["layout"]["columns"]["1"] = 300
    sheets[0]["layout"]["rows"]["5"] = 180
    validate(sheets)
    output = tmp_path / "roundtrip.xlsx"
    files.export(sheets, output, "xlsx")
    reopened = load_workbook(output).active
    assert str(next(iter(reopened.merged_cells.ranges))) == "A2:F2"
    assert reopened.column_dimensions["B"].width == pytest.approx((300 - 5) / 7)
    assert reopened.row_dimensions[6].height == 135
    assert reopened.freeze_panes == "A6"
    assert reopened["E8"].value == source["E8"].value
    assert reopened["B6"].alignment.vertical == "center"
    assert reopened["B6"].number_format == "0.0"
    for invalid in [-1, float("nan"), float("inf"), True, 3000]:
        sheets[0]["layout"]["rows"]["5"] = invalid
        with pytest.raises(ValueError):
            validate(sheets)


def test_formula_strings_are_preserved_and_external_or_unknown_functions_stay_literal():
    assert (
        files.safe_formula('=IF(COUNT(B8:D8)=0,"",AVERAGE(B8:D8))')
        == '=IF(COUNT(B8:D8)=0,"",AVERAGE(B8:D8))'
    )
    assert files.safe_formula('=SE(A1=0;"a;b";"x")') == '=IF(A1=0,"a;b","x")'
    assert files.safe_formula('=WEBSERVICE("https://example.com")') is None
    assert files.safe_formula("=[external.xlsx]Sheet1!A1") is None

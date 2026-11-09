from apps.open_doc.datasets.python_analysis import analyze


def labels(code, line, column):
    return {item["label"] for item in analyze(code, line, column, "complete")["items"]}


def test_static_completions_use_installed_library_and_local_symbols(tmp_path):
    code = "import openpyxl as book\nbook.load_work"
    assert "load_workbook" in labels(code, 2, len("book.load_work"))
    code = "class Modelo:\n    def transformar(self): pass\nobjeto = Modelo()\nobjeto.trans"
    assert "transformar" in labels(code, 4, len("objeto.trans"))
    marker = tmp_path / "executado"
    code = f"from pathlib import Path\nPath({str(marker)!r}).touch()\nPath.re"
    assert "read_text" in labels(code, 3, len("Path.re"))
    assert not marker.exists()


def test_signatures_documentation_and_syntax_diagnostics():
    result = analyze("from pathlib import Path\nPath(", 2, 5, "inspect")
    assert result["signature"].startswith("Path(")
    result = analyze("from pathlib import Path\nPath", 2, 2, "inspect")
    assert result["documentation"]
    result = analyze("x = )", 1, 0, "diagnostics")
    assert result["items"][0]["line"] == 1
    assert result["items"][0]["column"] == 4

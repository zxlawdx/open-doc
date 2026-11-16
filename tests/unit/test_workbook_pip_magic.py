"""Spreadsheet Python package magics must not require an already-running kernel."""

import pytest


def test_workbook_explicit_pip_installs_before_kernel_initialization(tmp_path, monkeypatch):
    from config.wsgi import create_app
    from config.composition import get_context
    from shared.services.preferences_service import Config
    from apps.code.api import notebook

    app = create_app(Config(tmp_path))
    try:
        context = get_context()
        book = context.workbooks.create()
        identifier = book["id"]
        calls = []

        def fake_open(*args, **kwargs):
            calls.append(("open", args))
            return {"returncode": 0}

        def fake_execute(project, code, language):
            calls.append(("execute", project, code, language))
            return {"returncode": 0, "output": "Bibliotecas instaladas"}

        monkeypatch.setattr(context.notebooks, "open_workbook", fake_open)
        monkeypatch.setattr(context.notebooks, "execute", fake_execute)
        for magic in ("!pip install ipykernel", "%pip install pandas"):
            request = {
                "headers": {"X-Open-Doc-Token": context.token},
                "json": {"operation": "execute-workbook", "id": identifier,
                         "columns": ["Valor"], "rows": [[10]],
                         "language": "python", "code": magic},
            }
            result = notebook(request)
            assert result["returncode"] == 0
            assert calls[-1] == ("execute", identifier, magic, "python")
        assert not any(entry[0] == "open" for entry in calls)

        request["json"]["code"] = "print(1)"
        result = notebook(request)
        assert result["returncode"] == 0
        assert calls[-2][0] == "open"
        assert calls[-1] == ("execute", identifier, "print(1)", "python")
    finally:
        app.close()

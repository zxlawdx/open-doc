"""Python analysis API owned by the Code application."""

from vela.api import api
from shared.services.http import _data, _handle


@api.post("/open_doc/dataset/python-analysis")
def dataset_python_analysis(context=None):
    from apps.code.services.python_analysis import analyze

    def operation():
        data = _data(context)
        return analyze(
            data["code"],
            data["line"],
            data["column"],
            data["operation"],
            data.get("project"),
        )

    return _handle(operation)


@api.post("/open_doc/notebook")
def notebook(context=None):
    from shared.contracts.workspace import workspace
    def operation():
        data = _data(context)
        ctx = workspace()
        command = data["operation"]
        if command == "open": return ctx.notebooks.open(data["id"])
        if command == "execute-workbook":
            language = data.get("language", "python")
            code = data["code"]
            # Explicit notebook pip magics must be handled before opening a
            # kernel. On a fresh Linux Mint project, ipykernel may be absent;
            # opening the workbook first would fail before pip could install it.
            if language == "python" and isinstance(code, str) and code.strip().startswith(("!pip ", "%pip ")):
                return ctx.notebooks.execute(data["id"], code, language)
            if data["id"] not in ctx.notebooks._bindings:
                opened = ctx.notebooks.open_workbook(data["id"], data["columns"], data["rows"])
                if opened.get("returncode"): return opened
            return ctx.notebooks.execute(data["id"], code, language)
        if command == "execute": return ctx.notebooks.execute(data["id"], data["code"], data.get("language", "python"))
        if command == "publish": return ctx.notebooks.publish(data["id"])
        if command == "sessions": return {"sessions": ctx.kernels.status()}
        if command == "stop": return ctx.notebooks.stop(data["id"])
        if command == "save-cells": return ctx.notebooks.save_cells(data["id"], data["cells"])
        if command == "load-cells": return ctx.notebooks.load_cells(data["id"])
        raise ValueError("Operação de notebook inválida.")
    return _handle(operation)


@api.post('/open_doc/remote-sql')
def remote_sql(context=None):
    from shared.contracts.workspace import workspace
    from apps.code.services.remote_sql import query
    def operation():
        data = _data(context)
        return query(workspace().config.root, data['id'], data['connection'], data['sql'])
    return _handle(operation)

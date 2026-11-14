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
            if data["id"] not in ctx.notebooks._bindings:
                opened = ctx.notebooks.open_workbook(data["id"], data["columns"], data["rows"])
                if opened.get("returncode"): return opened
            return ctx.notebooks.execute(data["id"], data["code"], data.get("language", "python"))
        if command == "execute": return ctx.notebooks.execute(data["id"], data["code"], data.get("language", "python"))
        if command == "publish": return ctx.notebooks.publish(data["id"])
        if command == "sessions": return {"sessions": ctx.kernels.status()}
        if command == "stop": return ctx.notebooks.stop(data["id"])
        if command == "save-cells": return ctx.notebooks.save_cells(data["id"], data["cells"])
        if command == "load-cells": return ctx.notebooks.load_cells(data["id"])
        raise ValueError("Operação de notebook inválida.")
    return _handle(operation)

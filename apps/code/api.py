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

"""Data-owned HTTP routes, registered exclusively by the Vela AppConfig."""

from vela.api import api
from shared.contracts.workspace import workspace as get_context
from shared.services.http import _data, _handle


@api.post("/open_doc/dataset")
def dataset(context=None):
    def operation():
        data = _data(context)
        store = get_context().datasets
        if data["operation"] == "resource-snapshot":
            return get_context().dataset_exchange.snapshot(data["id"])
        if data["operation"] == "list":
            return {"datasets": store.list()}
        if data["operation"] == "page":
            return store.page(data["id"], data["row"], data["column"])
        if data["operation"] == "columns":
            return {"columns": store.columns(data["id"])}
        if data["operation"] in {"cell", "filter-literal"}:
            return store.cell(
                data["id"],
                data["row"],
                data["column"],
                for_query=data["operation"] == "filter-literal",
            )
        if data["operation"] == "edit":
            return store.edit_cell(
                data["id"], data["row"], data["column"], data["value"]
            )
        if data["operation"] == "type":
            return store.set_type(
                data["id"],
                data["scope"],
                data["column"],
                data["kind"],
                data.get("row"),
                data.get("last_row"),
                data.get("last_column"),
            )
        if data["operation"] == "history":
            return store.history(data["id"])
        if data["operation"] == "undo":
            return store.undo(data["id"])
        if data["operation"] == "redo":
            return store.undo(data["id"], redo=True)
        if data["operation"] in {"python-env-status", "python-env-install"}:
            manager = get_context().code_tools.environments(get_context().config.root)
            if data["operation"] == "python-env-status":
                return manager.status(data["id"])
            result = manager.install(
                data["id"], data["packages"], confirm=data.get("confirm") is True
            )
            get_context().code_tools.clear_analysis_cache()
            return result
        if data["operation"] == "conversion-preview":
            return store.conversion_preview(
                data["id"],
                data["scope"],
                data["column"],
                data["kind"],
                data.get("row"),
                data.get("last_row"),
                data.get("last_column"),
            )
        if data["operation"] == "conversion-commit":
            return store.conversion_commit(
                data["id"],
                data["scope"],
                data["column"],
                data["kind"],
                data["token"],
                data.get("row"),
                data.get("last_row"),
                data.get("last_column"),
                on_invalid=data.get("on_invalid", "abort"),
                confirm=data.get("confirm", False),
            )
        if data["operation"] == "query":
            return store.query(data["id"], data["sql"])
        raise ValueError("Operação de dataset inválida.")

    return _handle(operation)

"""Data-owned HTTP routes, registered exclusively by the Vela AppConfig."""

from vela.api import api
from shared.contracts.workspace import workspace as get_context
from shared.services.http import _data, _handle


@api.post("/open_doc/dataset")
def dataset(context=None):
    def operation():
        data = _data(context)
        store = get_context().datasets
        if data["operation"] == "import-preview":
            return get_context().dataset_imports.preview(
                data["token"], data.get("options")
            )
        if data["operation"] == "import-commit":
            return get_context().dataset_imports.commit(data["token"])
        if data["operation"] == "import-cancel":
            return get_context().dataset_imports.cancel(data["token"])
        if data["operation"] == "review-types":
            return {"preview": get_context().dataset_imports.review(data["id"])}
        if data["operation"] == "create":
            return store.create(data.get("title", "Novo programa"))
        if data["operation"] == "delete":
            if data.get("confirm") is not True:
                raise ValueError("Confirme a exclusão do dataset.")
            get_context().notebooks.stop(data["id"])
            return store.delete(data["id"])
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
        if data["operation"] in {
            "python-env-status",
            "python-env-install",
            "python-env-remove",
            "python-env-discover",
            "python-env-select",
            "python-env-cancel",
            "python-env-check",
            "python-env-export",
            "python-env-import",
            "python-env-job",
        }:
            manager = get_context().code_tools.environments(get_context().config.root)
            if data["operation"] == "python-env-job":
                return manager.job_status(data["id"])
            if data["operation"] == "python-env-cancel":
                return manager.cancel(data["id"])
            if data["operation"] == "python-env-check":
                return manager.check(data["id"])
            if data["operation"] == "python-env-export":
                return manager.requirements(data["id"])
            if data["operation"] == "python-env-import":
                result = manager.import_requirements(
                    data["id"], data["text"], confirm=data.get("confirm") is True
                )
                get_context().code_tools.clear_analysis_cache()
                return result
            if data["operation"] == "python-env-discover":
                from apps.code.services.local_runtime import discover_pythons

                return {"interpreters": discover_pythons()}
            if data["operation"] == "python-env-select":
                result = manager.select(
                    data["id"],
                    data.get("python"),
                    existing=data.get("existing") is True,
                    internal=data.get("internal") is True,
                )
                get_context().kernels.stop(data["id"])
                get_context().code_tools.clear_analysis_cache()
                return result
            if data["operation"] == "python-env-status":
                result = manager.status(data["id"])
                result["kernel"] = next(
                    (
                        session
                        for session in get_context().kernels.status()
                        if session["project"] == data["id"]
                    ),
                    None,
                )
                return result
            if (
                data["operation"] == "python-env-remove"
                and get_context().notebooks is not None
            ):
                get_context().notebooks.stop(data["id"])
            action = (
                manager.remove
                if data["operation"] == "python-env-remove"
                else manager.install
            )
            options = {"confirm": data.get("confirm") is True}
            if data["operation"] == "python-env-install":
                options["upgrade"] = data.get("upgrade") is True
            result = action(data["id"], data["packages"], **options)
            get_context().code_tools.clear_analysis_cache()
            if data[
                "operation"
            ] == "python-env-install" and get_context().kernels.has_session(data["id"]):
                try:
                    get_context().kernels.execute(
                        data["id"], "import importlib; importlib.invalidate_caches()"
                    )
                except ValueError:
                    pass  # The active cell invalidates caches when it finishes.
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

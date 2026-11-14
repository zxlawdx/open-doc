from __future__ import annotations
from pathlib import Path
from typing import Any
from uuid import uuid4
from vela.api import api
from vela.core.http import Request, Response
from shared.contracts.workspace import workspace as get_context
from shared.services.http import _data, _handle, _header, _has_session
FORBIDDEN, RANGE_NOT_SATISFIABLE = 403, 416

def _documents():
    return get_context().documents

@api.post("/open_doc/workbook")
def workbook(context=None):
    def operation():
        from apps.spreadsheets.services import templates

        data = _data(context)
        store = get_context().workbooks
        command = data["operation"]
        if command == "link-dataset":
            handle = get_context().dataset_exchange.parquet_snapshot(data["dataset_id"])
            book = store.create(data.get("title", "Dados vinculados"), [{"name": "Dados", "cells": {}, "bold": [], "external_resource": {"resource_id": handle["resource_id"], "revision": handle["revision"]}}])
            get_context().resource_workspace.runtime.resources.pin("workbook_"+book["id"], handle["resource_id"], handle["revision"])
            return book
        if command == "resource-page":
            book = store.get(data["id"])
            sheet = book["sheets"][data.get("sheet", 0)]
            handle = sheet["external_resource"]
            runtime = get_context().resource_workspace.runtime
            import pyarrow.parquet as pq
            with pq.ParquetFile(runtime.resources.open_path(handle["resource_id"], handle["revision"])) as parquet:
                names = parquet.schema_arrow.names
                total = parquet.metadata.num_rows
            column = data.get("column", 0)
            if type(column) is not int or column < 0: raise ValueError("Coluna inválida.")
            columns = names[column:column+20]
            page = runtime.tabular.page(handle["resource_id"], handle["revision"], offset=data.get("offset", 0), limit=50, columns=columns)
            return {"columns": columns, "rows": page.to_pylist(), "total": total, "column_count": len(names), "resource": handle}
        if command in {"image-add", "image-read"}:
            from apps.spreadsheets.services.objects import image_url, media_directory, store_image
            book = store.get(data["id"])
            directory = media_directory(get_context().config.root)
            if command == "image-add":
                return store_image(directory, data["data_url"], data.get("name", "Imagem"))
            if not any(obj.get("media_id") == data["media_id"] for sheet in book["sheets"] for obj in sheet.get("objects", [])):
                raise ValueError("A imagem não pertence à planilha.")
            return image_url(directory, data["media_id"])
        if command == "query":

            return get_context().data_tools.worksheet(data["columns"], data["rows"]).query(data["sql"])
        if command == "from-query":
            from apps.spreadsheets.services.store import empty_sheet

            data_sheet = get_context().data_tools.worksheet(data["columns"], data["rows"])
            new_sheet = empty_sheet("Resultados SQL")
            for col, name in enumerate(data_sheet.columns):
                new_sheet["cells"][f"0,{col}"] = name
                new_sheet["bold"].append(f"0,{col}")
            for row, values in enumerate(data_sheet.rows, start=1):
                for col, value in enumerate(values):
                    if value:
                        new_sheet["cells"][f"{row},{col}"] = (
                            "'" + value if value.startswith(("=", "'")) else value
                        )
            return store.create("Resultado SQL", [new_sheet])
        if command == "new":
            return store.create()
        if command == "template":
            return templates.create(store, data["template"])
        if command == "open":
            return store.get(data["id"])
        if command == "versions":
            return {"versions": store.versions(data["id"])}
        if command == "restore":
            return store.save(data["id"], data["revision"], None, None, restore=data["version"])
        if command == "save":
            return store.save(data["id"], data["revision"], data["title"], data["sheets"])
        raise ValueError("Operação de planilha inválida.")

    return _handle(operation)


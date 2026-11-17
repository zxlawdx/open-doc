"""Notebook orchestration through injected table and kernel contracts."""

import json
import tempfile
from pathlib import Path
from threading import RLock


class NotebookService:
    def __init__(self, context):
        self.context = context
        self._bindings = {}
        self._lock = RLock()

    def open(self, identifier):
        ctx = self.context
        with self._lock:
            token = ctx.publications.token(identifier)
            original = ctx.dataset_exchange.snapshot(identifier, raw=True)["resource"]
            analysis = ctx.dataset_exchange.snapshot(identifier)["resource"]
            if ctx.publications.token(identifier) != token:
                raise ValueError("Tabela alterada durante a abertura; tente novamente.")
            path = ctx.dataset_exchange.runtime.resources.open_path(
                analysis["resource_id"], analysis["revision"]
            )
            reader = (
                "read_parquet"
                if analysis.get("media_type") == "application/vnd.apache.parquet"
                else "read_csv"
            )
            result = ctx.kernels.execute(
                identifier,
                "import pandas as pd\nfrom pathlib import Path\n"
                + ("DATASET_PARQUET" if reader == "read_parquet" else "DATASET_CSV")
                + " = Path("
                + repr(str(path))
                + ")\ndf = pd."
                + reader
                + "("
                + ("DATASET_PARQUET" if reader == "read_parquet" else "DATASET_CSV")
                + (
                    ", dtype_backend='numpy_nullable'"
                    if reader == "read_parquet"
                    else ""
                )
                + ")\nprint('DataFrame pronto:', df.shape)",
            )
            if result.get("returncode"):
                return result
            ctx.dataset_exchange.runtime.resources.replace_pins(
                "kernel_" + identifier, [original, analysis]
            )
            previous = self._bindings.get(identifier)
            if previous:
                self._release(previous)
            self._bindings[identifier] = {
                "before": original,
                "resource": analysis,
                "token": token,
            }
            return {**result, "resource": analysis}

    def execute(self, identifier, code, language="python"):
        try:
            return self._execute(identifier, code, language)
        finally:
            if language == "python":
                tools = getattr(self.context, "code_tools", None)
                if tools is not None:
                    tools.clear_analysis_cache()

    def _execute(self, identifier, code, language="python"):
        # Let IPython parse the complete cell, including multiline magics.
        if (
            language == "python"
            and isinstance(code, str)
            and code.lstrip().startswith(("!pip ", "%pip "))
        ):
            return self.context.kernels.execute(identifier, code)
        datasets = getattr(self.context, "datasets", None)
        if (
            language == "python"
            and identifier not in self._bindings
            and datasets is not None
            and datasets.is_program(identifier)
            and (
                getattr(self.context, "publications", None) is None
                or self.context.publications.bound_resource(identifier) is None
            )
        ):
            # A new code-only project has no source dataset to open. Once its
            # df is published, later sessions can load the persisted snapshot.
            return self.context.kernels.execute(identifier, code)
        if identifier not in self._bindings:
            opened = self.open(identifier)
            if opened.get("returncode"):
                return opened
        elif not self.context.kernels.has_session(identifier):
            handle = self._bindings[identifier]["resource"]
            runtime = self.context.dataset_exchange.runtime
            snapshot = runtime.resources.snapshot(
                handle["resource_id"], handle["revision"]
            )
            path = runtime.resources.open_path(snapshot.resource_id, snapshot.revision)
            reader = (
                "read_parquet"
                if snapshot.media_type == "application/vnd.apache.parquet"
                else "read_csv"
            )
            loaded = self.context.kernels.execute(
                identifier,
                "import pandas as pd\nfrom pathlib import Path\n"
                + ("DATASET_CSV" if reader == "read_csv" else "DATASET_PARQUET")
                + " = Path("
                + repr(str(path))
                + ")\ndf = pd."
                + reader
                + "("
                + repr(str(path))
                + (
                    ", dtype_backend='numpy_nullable'"
                    if reader == "read_parquet"
                    else ""
                )
                + ")",
            )
            if loaded.get("returncode"):
                return loaded
        if language == "sql":
            if len(code) > 12000:
                raise ValueError("Consulta SQL excede o limite.")
            # SQL cells leave a DataFrame accessible to subsequent Python cells.
            # The final expression still renders the result in the notebook.
            code = (
                "import duckdb\ndados = df\ndf_resultado = duckdb.sql("
                + repr(code)
                + ").df()\ndf_resultado"
            )
        return self.context.kernels.execute(identifier, code)

    def publish(self, identifier):
        with self._lock:
            binding = self._bindings.get(identifier)
            creating_from_program = (
                binding is None and self.context.datasets.is_program(identifier)
            )
            if binding is None and not creating_from_program:
                raise ValueError("Abra o DataFrame antes de publicar.")
            if creating_from_program and not self.context.kernels.has_session(
                identifier
            ):
                raise ValueError(
                    "Execute uma célula que crie o DataFrame df antes de publicar."
                )
            with tempfile.TemporaryDirectory(
                prefix="opendoc-publication-"
            ) as directory:
                path = Path(directory) / "frame.parquet"
                result = self.context.kernels.execute(
                    identifier,
                    "import pandas as _opendoc_pd\n"
                    "if 'df' not in globals() or not isinstance(df, _opendoc_pd.DataFrame):\n"
                    "    raise ValueError('Crie um pandas.DataFrame chamado df antes de publicar.')\n"
                    "df.to_parquet(" + repr(str(path)) + ", index=False)",
                )
                if result.get("returncode"):
                    return result
                # Programs start without a dataset binding. Capture a
                # revisioned before-snapshot only after the export succeeds,
                # so a failed publish cannot overwrite or bind the table.
                if creating_from_program:
                    token = self.context.publications.token(identifier)
                    before = self.context.dataset_exchange.snapshot(
                        identifier, raw=True
                    )["resource"]
                    if self.context.publications.token(identifier) != token:
                        raise ValueError(
                            "A tabela mudou durante a publicação. Tente novamente."
                        )
                    binding = {"before": before, "resource": before, "token": token}
                runtime = self.context.dataset_exchange.runtime
                # Prepare a new immutable resource. The table commit is the
                # publication boundary; a failed table commit never changes it.
                with path.open("rb") as stream:
                    after = runtime.resources.publish(
                        stream,
                        resource_id=binding["resource"]["resource_id"],
                        expected_revision=binding["resource"]["revision"],
                        media_type="application/vnd.apache.parquet",
                    ).to_dict()
                if binding.get("kind") == "workbook":
                    book = self.context.workbooks.get(identifier)
                    if book["revision"] != binding["book_revision"]:
                        raise ValueError(
                            "A planilha mudou após abrir df. Reabra o DataFrame antes de publicar."
                        )
                    sheets = [
                        *book["sheets"],
                        {
                            "name": "Notebook " + str(after["revision"]),
                            "cells": {},
                            "bold": [],
                            "external_resource": {
                                "resource_id": after["resource_id"],
                                "revision": after["revision"],
                            },
                        },
                    ]
                    saved = self.context.workbooks.save(
                        identifier, book["revision"], book["title"], sheets
                    )
                    runtime.resources.pin(
                        "workbook_" + identifier,
                        after["resource_id"],
                        after["revision"],
                    )
                    binding.update(resource=after, book_revision=saved["revision"])
                    return {"workbook": saved, "resource": after}
                adopted = self.context.publications.adopt(
                    identifier, binding["before"], after, binding["token"]
                )
                binding.update(before=after, resource=after, token=adopted["token"])
                if creating_from_program:
                    self._bindings[identifier] = binding
                runtime.events.emit("dataset:published", adopted)
                return adopted

    def save_cells(self, identifier, cells):
        self.context.code_tools.environments(self.context.config.root).path(identifier)
        if not isinstance(cells, list) or len(cells) > 100:
            raise ValueError("Notebook inválido.")
        payload = json.dumps(cells, ensure_ascii=False)
        if len(payload.encode()) > 1024 * 1024:
            raise ValueError("Notebook excede 1 MB.")
        from vela.resources import ResourceNotFound

        resources = self.context.dataset_exchange.runtime.resources
        resource_id = "notebook_" + identifier
        try:
            revision = resources.current(resource_id).revision
        except ResourceNotFound:
            revision = None
        snap = resources.publish(
            payload.encode("utf-8"),
            resource_id=resource_id,
            expected_revision=revision,
            media_type="application/json",
        )
        resources.prune(resource_id, keep_last=10)
        return {"saved": True, "revision": snap.revision}

    def load_cells(self, identifier):
        from vela.resources import ResourceNotFound

        self.context.code_tools.environments(self.context.config.root).path(identifier)
        resources = self.context.dataset_exchange.runtime.resources
        resource_id = "notebook_" + identifier
        try:
            snapshot = resources.current(resource_id)
        except ResourceNotFound:
            return {"cells": []}
        if snapshot.size > 1024 * 1024:
            raise ValueError("Caderno excede 1 MB.")
        content = b"".join(resources.iter_chunks(resource_id, snapshot.revision))
        return {"cells": json.loads(content), "revision": snapshot.revision}

    def open_workbook(self, identifier, columns, rows):
        import io

        book = self.context.workbooks.get(identifier)
        reference = book["sheets"][0].get("external_resource")
        runtime = self.context.dataset_exchange.runtime
        if reference:
            snapshot = runtime.resources.snapshot(
                reference["resource_id"], reference["revision"]
            )
        else:
            sheet = self.context.data_tools.worksheet(columns, rows)
            stream = io.StringIO(newline="")
            sheet.write_csv(None, stream)
            snapshot = runtime.resources.publish(
                stream.getvalue().encode(), media_type="text/csv"
            )
        path = runtime.resources.open_path(snapshot.resource_id, snapshot.revision)
        reader = (
            "read_parquet"
            if snapshot.media_type == "application/vnd.apache.parquet"
            else "read_csv"
        )
        result = self.context.kernels.execute(
            identifier,
            "import pandas as pd\nfrom pathlib import Path\n"
            + ("DATASET_CSV" if reader == "read_csv" else "DATASET_PARQUET")
            + " = Path("
            + repr(str(path))
            + ")\ndf = pd."
            + reader
            + "("
            + repr(str(path))
            + (", dtype_backend='numpy_nullable'" if reader == "read_parquet" else "")
            + ")\nprint('DataFrame pronto:', df.shape)",
        )
        if not result.get("returncode"):
            runtime.resources.replace_pins("kernel_" + identifier, [snapshot.to_dict()])
            previous = self._bindings.get(identifier)
            if previous:
                self._release(previous)
            self._bindings[identifier] = {
                "kind": "workbook",
                "resource": snapshot.to_dict(),
                "book_revision": book["revision"],
            }
        return result

    def stop(self, identifier):
        with self._lock:
            binding = self._bindings.pop(identifier, None)
            stopped = self.context.kernels.stop(identifier)
            self.context.dataset_exchange.runtime.resources.replace_pins(
                "kernel_" + identifier, []
            )
            if binding:
                self._release(binding)
            return stopped

    def _release(self, binding):
        from vela.resources import ResourceNotFound

        resources = self.context.dataset_exchange.runtime.resources
        for handle in (binding.get("before"), binding.get("resource")):
            if handle is not None:
                try:
                    resources.delete(handle["resource_id"])
                except (ValueError, ResourceNotFound):
                    pass

    def close(self):
        for identifier in list(self._bindings):
            self.stop(identifier)

"""Open Doc session coordination over Vela resources and EventBus.

Only references and navigation/session state belong here. Editors own their
mutable documents and publish resources explicitly through the Vela service.
"""

import json

from vela.resources import ResourceNotFound


class ResourceWorkspace:
    SESSION_ID = "open_doc_workspace_session"
    MAX_SESSION_BYTES = 1024 * 1024

    def __init__(self, runtime):
        self.runtime = runtime

    def load(self):
        try:
            snapshot = self.runtime.resources.current(self.SESSION_ID)
        except ResourceNotFound:
            return {"revision": 0, "tabs": [], "settings": {}, "modules": {}}
        if snapshot.size > self.MAX_SESSION_BYTES:
            raise ValueError("Sessão excede o limite permitido.")
        content = b"".join(
            self.runtime.resources.iter_chunks(self.SESSION_ID, snapshot.revision)
        )
        state = json.loads(content)
        return {"revision": snapshot.revision, **state}

    def save(self, *, expected_revision, tabs, settings, modules):
        if type(expected_revision) is not int or expected_revision < 0:
            raise ValueError("Revisão de sessão inválida.")
        registered = {app.name for app in self.runtime.apps}
        if (
            not isinstance(tabs, list)
            or not isinstance(settings, dict)
            or not isinstance(modules, dict)
        ):
            raise ValueError("Sessão inválida.")
        if not set(modules).issubset(registered):
            raise ValueError("Aplicação não registrada na sessão.")
        for tab in tabs:
            if not isinstance(tab, dict) or tab.get("app") not in registered:
                raise ValueError("Aplicação da aba inválida.")
            handle = tab.get("resource")
            if handle is not None:
                if not isinstance(handle, dict):
                    raise ValueError("Referência de recurso inválida.")
                self.runtime.resources.snapshot(
                    handle["resource_id"], handle["revision"]
                )
        payload = json.dumps(
            {"tabs": tabs, "settings": settings, "modules": modules},
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        if len(payload) > self.MAX_SESSION_BYTES:
            raise ValueError("Sessão excede o limite permitido.")
        snapshot = self.runtime.resources.publish(
            payload,
            resource_id=self.SESSION_ID,
            expected_revision=expected_revision or None,
            media_type="application/json",
        )
        self.runtime.events.emit("workspace:session-published", snapshot.to_dict())
        return snapshot.to_dict()

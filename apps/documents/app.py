from vela.apps import AppConfig

DOCUMENTS_APP = AppConfig(name="documents", module="apps.documents", persistent_modules=("apps.documents.services",))

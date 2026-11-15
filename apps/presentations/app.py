from vela.apps import AppConfig

PRESENTATIONS_APP = AppConfig(name="presentations", module="apps.presentations", persistent_modules=("apps.presentations.services",))

from vela.apps import AppConfig

TEMPLATES_APP = AppConfig(name="templates", module="apps.templates", persistent_modules=("apps.templates.services",))

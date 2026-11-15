from vela.apps import AppConfig

CODE_APP = AppConfig(name="code", module="apps.code", persistent_modules=("apps.code.services",))

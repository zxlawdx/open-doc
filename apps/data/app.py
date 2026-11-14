from vela.apps import AppConfig

DATA_APP = AppConfig(
    name="data", module="apps.data", persistent_modules=("apps.data.services",)
)

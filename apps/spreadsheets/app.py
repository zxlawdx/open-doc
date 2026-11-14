from vela.apps import AppConfig

SPREADSHEETS_APP = AppConfig(name="spreadsheets", module="apps.spreadsheets", persistent_modules=("apps.spreadsheets.services",))

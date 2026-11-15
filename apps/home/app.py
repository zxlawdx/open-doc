from vela.apps import AppConfig

HOME_APP = AppConfig(name="home", module="apps.home", persistent_modules=("apps.home.services",))

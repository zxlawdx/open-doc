from vela.apps import AppConfig

PDF_APP = AppConfig(name="pdf", module="apps.pdf", persistent_modules=("apps.pdf.services",))

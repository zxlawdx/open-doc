import re

EXTENSIONS = {"docx", "pdf", "html", "md"}


class ExportError(RuntimeError):
    """Falha segura de exportação, sem perda do documento salvo."""


def safe_stem(title):
    return re.sub(r"[^\w .-]", "", title).strip(" .")[:100] or "Documento"



from pathlib import Path


def validated_pdf(path, root):
    path = Path(path)
    root = Path(root).resolve()
    if (
        path.is_symlink()
        or not path.is_file()
        or not path.resolve().is_relative_to(root)
        or path.suffix.lower() != ".pdf"
        or path.stat().st_size > 100 * 1024 * 1024
    ):
        raise ValueError("PDF inválido.")
    with path.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise ValueError("Assinatura PDF inválida.")
    return path

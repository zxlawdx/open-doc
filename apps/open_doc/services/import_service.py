"""
Módulo: file_organizer.py.
Responsabilidade: validar e organizar documentos importados.
Autor: Open Doc Contributors
Criado em: 2026
"""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

from apps.open_doc.services.preferences_service import Config

TYPE_FOLDERS = {
    ".docx": "documents/docx",
    ".pptx": "documents/pptx",
    ".pdf": "documents/pdf",
    ".md": "notes",
    ".txt": "notes",
}
PDF_SIGNATURE = b"%PDF-"
OFFICE_PARTS = {".docx": "word/document.xml", ".pptx": "ppt/presentation.xml"}


class FileOrganizer:
    """Organiza arquivos sem substituir documentos existentes."""

    def __init__(self, config: Config) -> None:
        """Associa o serviço ao workspace configurado."""
        self.config = config

    def detect_type(self, source: Path) -> str:
        """Valida extensão e assinatura básica de um documento.

        Raises:
            ValueError: Quando o arquivo não pertence aos formatos aceitos.
        """
        extension = source.suffix.lower()
        if extension not in TYPE_FOLDERS:
            raise ValueError("Formato não suportado: " + extension)
        if not source.is_file() or source.is_symlink():
            raise ValueError("Selecione um arquivo regular.")
        if extension == ".pdf":
            with source.open("rb") as stream:
                if stream.read(len(PDF_SIGNATURE)) != PDF_SIGNATURE:
                    raise ValueError("Assinatura PDF inválida.")
        if extension in OFFICE_PARTS:
            try:
                with zipfile.ZipFile(source) as archive:
                    if OFFICE_PARTS[extension] not in archive.namelist():
                        raise ValueError("Estrutura Office inválida.")
            except zipfile.BadZipFile as exc:
                raise ValueError("Documento Office inválido.") from exc
        if extension in {".md", ".txt"}:
            with source.open(encoding="utf-8") as stream:
                for _ in stream:
                    pass
        return extension

    def organize(self, source: Path, *, move: bool = False) -> Path:
        """Copia ou move um documento, reservando um nome exclusivo.

        A cópia é o padrão para preservar o original. A origem só é removida
        após uma cópia bem-sucedida quando move=True.
        """
        extension = self.detect_type(source)
        directory = self.config.root / TYPE_FOLDERS[extension]
        counter = 0
        while True:
            suffix = f" ({counter})" if counter else ""
            target = directory / f"{source.stem}{suffix}{extension}"
            try:
                destination = target.open("xb")
                break
            except FileExistsError:
                counter += 1
        try:
            with destination, source.open("rb") as original:
                shutil.copyfileobj(original, destination)
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        if move:
            source.unlink()
        return target

    def list_files(self) -> list[dict[str, str]]:
        """Retorna documentos regulares do workspace, ordenados por nome."""
        files = []
        for folder in sorted(set(TYPE_FOLDERS.values())):
            directory = self.config.root / folder
            for path in directory.iterdir():
                if (
                    path.is_file()
                    and not path.is_symlink()
                    and path.suffix.lower() in TYPE_FOLDERS
                ):
                    files.append(
                        {
                            "name": path.name,
                            "type": path.suffix.lower().lstrip("."),
                            "path": path.relative_to(self.config.root).as_posix(),
                            "capabilities": {
                                k: path.suffix.lower() in {".docx", ".md", ".txt"}
                                for k in ("open", "edit", "export")
                            },
                        }
                    )
        return sorted(files, key=lambda item: item["name"].casefold())

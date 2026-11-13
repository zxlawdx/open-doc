"""Thin native boundary between JavaScript/WebView and application use cases."""

from __future__ import annotations

import logging
import os
import sys
from subprocess import SubprocessError
from threading import Lock
from pathlib import Path
from typing import Any

from vela.core.bridge import BaseBridge

from apps.open_doc.application.context import get_context
from apps.open_doc.services.export_service import ExportError
from apps.open_doc.services.document_service import RevisionConflict

LOGGER = logging.getLogger(__name__)


def default_import_directory(home: Path | None = None, platform_name: str | None = None) -> str:
    """Start Open/Import in OS Documents, not Open Doc private data.

    Windows 'Personal' shell folder follows OneDrive and custom redirections.
    Linux XDG documents location respects user-dirs.dirs.
    """
    home = home if home is not None else Path.home()
    platform_name = platform_name or sys.platform
    candidates: list[Path] = []

    if platform_name == "win32":
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
            ) as key:
                raw = winreg.QueryValueEx(key, "Personal")[0]
            if isinstance(raw, str) and raw:
                candidates.append(Path(os.path.expandvars(raw)).expanduser())
        except (OSError, ImportError, ValueError):
            pass
    elif platform_name.startswith("linux"):
        try:
            xdg_config = home / ".config" / "user-dirs.dirs"
            for line in xdg_config.read_text(encoding="utf-8").splitlines():
                key, separator, value = line.strip().partition("=")
                if not separator or key != "XDG_DOCUMENTS_DIR":
                    continue
                value = value.strip().strip('"')
                if value.startswith("$HOME/"):
                    candidates.append(home / value[len("$HOME/"):])
                elif value == "$HOME":
                    candidates.append(home)
                elif value.startswith("/"):
                    candidates.append(Path(value))
                break
        except (OSError, UnicodeError):
            pass

    candidates.extend((home / "Documents", home / "Documentos", home))
    for directory in candidates:
        if directory.is_dir():
            return str(directory)
    return str(home)


class OpenDocBridge(BaseBridge):
    def __init__(self, router: Any = None, config: dict[str, Any] | None = None) -> None:
        super().__init__(router=router, config=config)
        self._window: Any = None
        self._dataset_python_lock = Lock()

    @property
    def _documents(self):
        return get_context().documents

    def _attach_window(self, window: Any) -> None:
        super()._attach_window(window)
        self._window = window
        window.confirm_close = False

    def get_runtime_diagnostics(self) -> dict[str, Any]:
        """Reveal which executable/framework/assets are actually running.

        A passing repository CI cannot prove a locally installed Open Doc EXE
        was rebuilt. Return physical installation paths and a hash of the
        active slide editor asset for user-supported provenance checks.
        """
        import hashlib
        import importlib.metadata
        import sys
        import vela

        asset_path = Path(__file__).parent / "static" / "js" / "slide_editor.js"
        try:
            digest = hashlib.sha256(asset_path.read_bytes()).hexdigest()
        except OSError:
            digest = None
        try:
            pywebview_version = importlib.metadata.version("pywebview")
        except importlib.metadata.PackageNotFoundError:
            pywebview_version = None
        return {
            "python_executable": str(sys.executable),
            "frozen": bool(getattr(sys, "frozen", False)),
            "vela_version": getattr(vela, "__version__", None),
            "vela_path": str(Path(vela.__file__).resolve()),
            "app_path": str(Path(__file__).resolve()),
            "slide_editor_sha256": digest,
            "pywebview_version": pywebview_version,
            "window": self.window_get_state(),
        }

    def get_bootstrap(self) -> dict[str, Any]:
        try:
            return self._documents.bootstrap()
        except (OSError, ValueError):
            return {"error": "Não foi possível ler o workspace."}

    def default_apps(self, extension: str | None = None) -> dict[str, Any]:
        from apps.open_doc.services import file_associations

        executable = file_associations.installed_executable()
        if executable is None:
            return {"error": "Use a versão instalada do Open Doc para configurar Abrir com."}
        try:
            file_associations.register(executable)
            if sys.platform == "win32" and extension is None:
                os.startfile("ms-settings:defaultapps")
                return {"opened": True}
            if sys.platform.startswith("linux") and extension is None:
                return {"extensions": list(file_associations.FILE_TYPES)}
            file_associations.set_linux_default(executable, extension)
            return {"selected": extension}
        except ValueError as exc:
            return {"error": str(exc)}
        except (KeyError, OSError, SubprocessError):
            return {"error": "O sistema não confirmou a alteração do aplicativo padrão."}

    def import_document(self) -> dict[str, Any]:
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        paths = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            directory=default_import_directory(),
            file_types=("Documentos (*.pdf;*.docx;*.pptx;*.odt;*.odp;*.xlsx;*.csv;*.tsv;*.md;*.txt)",),
        )
        if not paths:
            return {"cancelled": True}
        try:
            return self._documents.import_path(Path(paths[0]))
        except (ValueError, OSError, UnicodeError):
            return {
                "error": "Não foi possível abrir/importar este documento. O arquivo original foi preservado."
            }

    def import_dataset(self, identifier, encoding, delimiter):
        import sqlite3
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        paths = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=True,
            directory=default_import_directory(),
            file_types=("Dados tabulares (*.csv;*.tsv)",),
        )
        if not paths:
            return {"cancelled": True}
        try:
            return get_context().datasets.import_files(
                paths, identifier, encoding=encoding, delimiter=delimiter
            )
        except (ValueError, OSError) as error:
            return {"error": str(error)}
        except sqlite3.Error:
            LOGGER.exception("Falha ao gravar dataset")
            return {"error": "Não foi possível gravar os dados. Verifique o espaço e tente novamente."}

    def export_dataset(self, identifier, title):
        import sqlite3
        import webview
        from apps.open_doc.datasets.python_runner import export_csv
        from apps.open_doc.services.export_service import safe_stem

        if self._window is None:
            return {"error": "Janela indisponível."}
        try:
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE, save_filename=f"{safe_stem(title)}.csv",
                file_types=("Dados CSV (*.csv)",),
            )
            if not paths:
                return {"cancelled": True}
            return export_csv(get_context().datasets, identifier, paths if isinstance(paths, str) else paths[0])
        except (ValueError, OSError, sqlite3.Error) as error:
            return {"error": str(error)}

    def export_code_notebook(self, notebook):
        """Export a bounded notebook through the native Save dialog."""
        import json
        import tempfile
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        try:
            data = json.dumps(notebook, ensure_ascii=False, indent=2).encode("utf-8")
            if len(data) > 2_000_000:
                raise ValueError("O caderno excede o limite de 2 MB.")
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE, save_filename="caderno.ipynb",
                file_types=("Jupyter Notebook (*.ipynb)",),
            )
            if not paths:
                return {"cancelled": True}
            path = Path(paths if isinstance(paths, str) else paths[0])
            if path.suffix.lower() != ".ipynb":
                path = path.with_name(path.name + ".ipynb")
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                try:
                    stream.write(data)
                    stream.close()
                    temporary.replace(path)
                finally:
                    temporary.unlink(missing_ok=True)
            return {"name": path.name}
        except (ValueError, OSError, TypeError) as error:
            return {"error": str(error)}

    def run_dataset_python(self, identifier, code):
        return self._run_analysis_python(lambda: get_context().datasets, identifier, code,
                                         project=identifier)

    def run_workbook_python(self, columns, rows, code, project=None):
        from apps.open_doc.datasets.worksheet import WorksheetSnapshot

        return self._run_analysis_python(lambda: WorksheetSnapshot(columns, rows), None, code,
                                         project=project)

    def _run_analysis_python(self, source, identifier, code, *, project=None):
        import sqlite3
        from apps.open_doc.datasets.python_runner import run_python

        if self._window is None:
            return {"error": "Janela indisponível."}
        if getattr(sys, "frozen", False):
            return {"error": "Abra o Open Doc pelo Python para executar scripts nesta versão."}
        if not self._dataset_python_lock.acquire(blocking=False):
            return {"error": "Uma execução Python já está em andamento."}
        try:
            if not self._window.create_confirmation_dialog(
                "Executar Python local",
                "Execute apenas código em que você confia. O script terá acesso aos arquivos "
                "e à rede com as permissões da sua conta. Executar agora?",
            ):
                return {"cancelled": True}
            return run_python(source(), identifier, code,
                              project_root=get_context().config.root, project_key=project)
        except (ValueError, OSError, sqlite3.Error) as error:
            return {"error": str(error)}
        finally:
            self._dataset_python_lock.release()

    def import_workbook(self):
        import csv
        import webview
        from apps.open_doc.spreadsheets.files import read

        if self._window is None:
            return {"error": "Janela indisponível."}
        paths = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False,
            directory=default_import_directory(),
            file_types=("Planilhas (*.xlsx;*.csv;*.tsv)",),
        )
        if not paths:
            return {"cancelled": True}
        try:
            source = Path(paths[0])
            from apps.open_doc.spreadsheets.objects import media_directory
            return get_context().workbooks.create(source.stem, read(source, media_directory=media_directory(get_context().config.root)), imported=True)
        except (ValueError, OSError, csv.Error) as error:
            return {"error": str(error)}
        except Exception:
            LOGGER.exception("Falha de importação de planilha")
            return {"error": "Não foi possível ler a planilha."}

    def append_workbook_csv(self, sheets, index):
        import csv
        import webview
        from apps.open_doc.spreadsheets.files import append_delimited

        if self._window is None:
            return {"error": "Janela indisponível."}
        paths = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False,
            directory=default_import_directory(),
            file_types=("Dados tabulares (*.csv;*.tsv)",),
        )
        if not paths:
            return {"cancelled": True}
        try:
            return append_delimited(sheets, index, Path(paths[0]))
        except (ValueError, OSError, csv.Error) as error:
            return {"error": str(error)}

    def export_workbook(self, identifier, revision, fmt, sheet_index):
        import webview
        from apps.open_doc.spreadsheets.files import FORMATS, export
        from apps.open_doc.services.export_service import safe_stem

        if self._window is None or fmt not in FORMATS:
            return {"error": "Janela ou formato indisponível."}
        try:
            book = get_context().workbooks.get(identifier)
            if book["revision"] != revision:
                raise ValueError("A planilha foi alterada em outra janela.")
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE, save_filename=f"{safe_stem(book['title'])}.{fmt}",
                file_types=(f"Planilha (*.{fmt})",),
            )
            if not paths:
                return {"cancelled": True}
            from apps.open_doc.spreadsheets.objects import media_directory
            return export(book["sheets"], paths if isinstance(paths, str) else paths[0], fmt, sheet_index,
                          media_directory=media_directory(get_context().config.root))
        except (ValueError, OSError) as error:
            return {"error": str(error)}

    def get_font_catalog(self):
        return self._documents.font_catalog()

    def set_dirty(self, dirty: bool) -> dict[str, bool]:
        if type(dirty) is not bool:
            raise ValueError("Estado de edição inválido.")
        if self._window is not None:
            self._window.confirm_close = dirty
        return {"ok": True}

    def export_document(self, document_id, revision, file_format):
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        try:
            descriptor = self._documents.export_descriptor(document_id, file_format)
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(descriptor["directory"]),
                save_filename=descriptor["filename"],
                file_types=(f"Documento (*.{file_format})",),
            )
            if not paths:
                return {"cancelled": True}
            destination = paths if isinstance(paths, str) else paths[0]
            return self._documents.export_to(
                document_id, revision, file_format, Path(destination)
            )
        except Exception as exc:
            LOGGER.exception("Falha de exportação nativa")
            return {
                "error": (
                    str(exc)
                    if isinstance(exc, ExportError)
                    else "Não foi possível exportar o documento. Seu conteúdo continua salvo."
                )
            }

    def export_native_pdf_edit(self, document_id, revision, operation):
        """Export a new PDF with actual content edits; the source stays immutable."""
        import webview

        from apps.open_doc.readers.pdf.native_edit_engine import (
            NativePdfEditSession,
            PdfEditOperation,
            UnsupportedPdfEdit,
        )

        if self._window is None:
            return {"error": "Janela indisponível."}
        if type(operation) is not dict:
            return {"error": "Operação PDF inválida."}
        if operation.get("kind") not in {"replace_literal_text", "insert_text"}:
            return {"error": "Essa ferramenta visual ainda não suporta esta operação PDF."}
        try:
            fixed = self._documents.context.fixed_documents
            note = fixed.require_native_pdf_edit(document_id, revision)
            values = {
                "kind": operation["kind"],
                "page": operation.get("page"),
                "target": operation.get("target", ""),
                "replacement": operation.get("replacement", ""),
                "x": operation.get("x", 0),
                "y": operation.get("y", 0),
            }
            if any(
                not isinstance(values[key], str) or len(values[key]) > 1000
                for key in ("target", "replacement")
            ):
                raise ValueError("Texto PDF inválido ou muito extenso.")
            source = fixed.source(document_id)
            session = NativePdfEditSession(source.read_bytes())
            session.apply(PdfEditOperation(**values))
            stem = Path(note["title"]).stem[:90] or "Documento"
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(self._documents.context.config.root),
                save_filename=f"{stem} - editado.pdf",
                file_types=("Documento PDF (*.pdf)",),
            )
            if not paths:
                return {"cancelled": True}
            destination = Path(paths if isinstance(paths, str) else paths[0])
            if destination.resolve() == source.resolve():
                raise ValueError("Não substitua a cópia original protegida.")
            output = session.export(destination)
            return {"path": str(output), "name": output.name, "ok": True}
        except (UnsupportedPdfEdit, ValueError, RevisionConflict) as error:
            return {"error": str(error)}
        except Exception:
            LOGGER.exception("Erro ao exportar edição nativa PDF")
            return {"error": "Falha ao alterar o conteúdo do PDF; o original foi preservado."}

    def edit_pdf_native(self, document_id, revision, operation):
        """Native save dialog for a REAL content-stream edit (not annotations)."""
        import webview
        from apps.open_doc.readers.pdf.native_edit import PdfNativeEditError

        if self._window is None:
            return {"error": "Janela indisponível."}
        if not isinstance(operation, dict):
            return {"error": "Operação de edição inválida."}
        try:
            descriptor = self._documents.export_descriptor(document_id, "pdf")
            stem = Path(descriptor["filename"]).stem
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(descriptor["directory"]),
                save_filename=f"{stem} - corrigido.pdf",
                file_types=("Documento PDF (*.pdf)",),
            )
            if not paths:
                return {"cancelled": True}
            destination = paths if isinstance(paths, str) else paths[0]
            saved = self._documents.export_native_pdf_edit(
                document_id, revision, operation, Path(destination)
            )
            # Reimport as an independent document so that the original and
            # its revision/history are never silently overwritten.
            result = self._documents.import_path(Path(saved["path"]))
            return {**saved, "document": result["document"], "opened": True}
        except (PdfNativeEditError, ValueError, RevisionConflict) as exc:
            return {"error": str(exc)}
        except Exception:
            LOGGER.exception("Falha na edição nativa do PDF")
            return {"error": "A edição nativa não pôde ser aplicada. O original foi preservado."}

    def export_slide(self, document_id, revision, slide_index):
        """Native Save dialog; the application exports one editable PPTX slide."""
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        try:
            descriptor = self._documents.export_descriptor(document_id, "pptx")
            stem = Path(descriptor["filename"]).stem
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(descriptor["directory"]),
                save_filename=f"{stem} - slide {slide_index + 1}.pptx",
                file_types=("Apresentação PowerPoint (*.pptx)",),
            )
            if not paths:
                return {"cancelled": True}
            destination = paths if isinstance(paths, str) else paths[0]
            return self._documents.export_selected_slide(
                document_id, revision, slide_index, Path(destination)
            )
        except (ValueError, RevisionConflict) as exc:
            return {"error": str(exc)}
        except Exception:
            LOGGER.exception("Falha ao exportar slide")
            return {"error": "Falha ao exportar o slide. A apresentação original foi preservada."}

    def extract_pdf_pages(self, document_id, revision, first_page, last_page):
        """Native Save dialog for a page interval; no HTML-supplied paths."""
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        try:
            descriptor = self._documents.export_descriptor(document_id, "pdf")
            stem = Path(descriptor["filename"]).stem
            filename = f"{stem} - paginas {first_page}-{last_page}.pdf"
            paths = self._window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(descriptor["directory"]),
                save_filename=filename,
                file_types=("Documento PDF (*.pdf)",),
            )
            if not paths:
                return {"cancelled": True}
            destination = paths if isinstance(paths, str) else paths[0]
            return self._documents.extract_pdf_pages(
                document_id, revision, first_page, last_page, Path(destination)
            )
        except Exception as exc:
            LOGGER.exception("Falha na extração de páginas PDF")
            return {
                "error": str(exc) if isinstance(exc, (ValueError, RevisionConflict))
                else "Não foi possível extrair páginas. O documento original foi preservado."
            }

    def import_font(self):
        import webview

        if self._window is None:
            return {"error": "Janela indisponível."}
        try:
            paths = self._window.create_file_dialog(
                webview.FileDialog.OPEN,
                allow_multiple=True,
                directory=default_import_directory(),
                file_types=("Fontes (*.ttf;*.otf;*.ttc)",),
            )
            return (
                self._documents.import_fonts([Path(path) for path in paths])
                if paths
                else {"cancelled": True}
            )
        except Exception:
            return {
                "error": "Não foi possível importar a fonte. Verifique se é um arquivo TTF, OTF ou TTC válido."
            }

    def remove_font(self, font_id):
        try:
            return self._documents.remove_font(font_id)
        except Exception:
            return {"error": "Não foi possível remover a fonte importada."}

    def recognize_handwriting(self, strokes, language="pt-BR"):
        try:
            return self._documents.recognize_handwriting(strokes, language=language)
        except Exception as exc:
            return {"error": str(exc)}

    def handwriting_capabilities(self):
        return self._documents.handwriting_capabilities()

"""Opt-in, project-local Python environment management for Open Doc.

No automatic package installation. A project-specific virtualenv lives under
the configured Open Doc workspace and never modifies system Python.
Installed Python packages remain user-trusted code, not a security sandbox.
"""
import importlib.metadata
import re
import subprocess
import sys
import venv
from pathlib import Path
from uuid import UUID
from .local_runtime import external_python, run_external

PACKAGE = re.compile(
    r"^[A-Za-z][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?"
    r"(?:(?:==|>=|<=|~=|!=|>|<)[A-Za-z0-9.!+_-]+)?$"
)
MAX_PACKAGES = 5
MAX_LOG = 49152


class PythonEnvironments:
    def __init__(self, workspace):
        self.root = Path(workspace) / ".veladata" / "python_envs"

    def path(self, project):
        try:
            identifier = str(UUID(project))
        except (TypeError, ValueError, AttributeError) as error:
            raise ValueError("Identificador de projeto inválido.") from error
        return self.root / identifier

    def interpreter(self, project):
        folder = self.path(project)
        candidate = folder / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        return candidate if candidate.is_file() else None

    def status(self, project):
        python = self.interpreter(project)
        if python is None:
            return {"initialized": False, "packages": [], "python": None}
        # Enumerate installed distributions in that interpreter, never import them.
        script = (
            "import importlib.metadata as m,json;"
            "print(json.dumps(sorted([{'name':d.metadata.get('Name',''),"
            "'version':d.version} for d in m.distributions()],"
            "key=lambda d:d['name'].casefold())))"
        )
        try:
            result = run_external(
                [str(python), "-I", "-c", script],
                capture_output=True, text=True, timeout=15, check=True,
            )
            import json
            packages = json.loads(result.stdout)
        except (subprocess.SubprocessError, ValueError) as error:
            raise ValueError("Não foi possível listar os pacotes deste ambiente.") from error
        return {"initialized": True, "packages": packages, "python": str(python)}

    def install(self, project, packages, *, confirm=False):
        if confirm is not True:
            raise ValueError("A instalação exige confirmação explícita do usuário.")
        if (not isinstance(packages, list) or not 1 <= len(packages) <= MAX_PACKAGES
                or any(not isinstance(item, str) or len(item) > 120
                       or not PACKAGE.fullmatch(item) for item in packages)):
            raise ValueError("Informe até cinco pacotes PyPI válidos. URLs e opções de pip não são aceitas.")
        python = self.interpreter(project)
        if python is None:
            folder = self.path(project)
            folder.parent.mkdir(parents=True, exist_ok=True)
            if getattr(sys, "frozen", False):
                run_external([str(external_python()), "-I", "-m", "venv", str(folder)],
                             check=True, capture_output=True, text=True, timeout=120)
            else:
                venv.EnvBuilder(with_pip=True, clear=False).create(folder)
            python = self.interpreter(project)
        if python is None:
            raise ValueError("Não foi possível criar o ambiente Python isolado do projeto.")
        try:
            process = run_external(
                [str(python), "-m", "pip", "install", "--disable-pip-version-check",
                 "--no-input", "--only-binary=:all:", *packages],
                capture_output=True, text=True, timeout=180,
                cwd=self.root,
            )
        except subprocess.TimeoutExpired as error:
            raise ValueError("Instalação encerrada após três minutos.") from error
        log = (process.stdout + "\n" + process.stderr)[-MAX_LOG:]
        if process.returncode:
            raise ValueError("pip retornou código "+str(process.returncode)+":\n"+log[-3000:])
        return {"installed": packages, "log": log, "environment": str(python)}

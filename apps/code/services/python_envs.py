"""Opt-in, project-local Python environment management for Open Doc.

No automatic package installation. A project-specific virtualenv lives under
the configured Open Doc workspace and never modifies system Python.
Installed Python packages remain user-trusted code, not a security sandbox.
"""

import json
import shlex
import re
import subprocess
import sys
from pathlib import Path
from uuid import UUID
from .local_runtime import external_python, run_external, HIDDEN_CHILD_BOOTSTRAP

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
        layouts = (
            ("Scripts/python.exe", "bin/python.exe", "bin/python")
            if sys.platform == "win32"
            else ("bin/python",)
        )
        return next(
            (folder / name for name in layouts if (folder / name).is_file()), None
        )

    def selected(self, project):
        setting = self.path(project).parent / (str(UUID(project)) + ".json")
        return json.loads(setting.read_text())["python"] if setting.is_file() else None

    def select(self, project, executable):
        if self.path(project).exists():
            raise ValueError(
                "O ambiente existente foi preservado. Use outro projeto para trocar o Python base."
            )
        actual = external_python(executable)
        setting = self.path(project).parent / (str(UUID(project)) + ".json")
        setting.parent.mkdir(parents=True, exist_ok=True)
        setting.write_text(json.dumps({"python": str(actual)}))
        return {"python": str(actual)}

    def _run(self, project, stage, args, timeout=120):
        try:
            result = run_external(args, capture_output=True, text=True, timeout=timeout)
            if result.returncode:
                raise subprocess.CalledProcessError(
                    result.returncode, args, result.stdout, result.stderr
                )
            return result
        except (OSError, subprocess.SubprocessError) as error:
            details = str(getattr(error, "stderr", None) or error)[-3000:]
            # Strip credentials from URLs and conventional token assignments.
            details = re.sub(
                r"(https?://)[^\s/@]+:[^\s/@]+@", r"\1[redacted]@", details
            )
            details = re.sub(
                r"(?i)(token|password|secret)([=:]\s*)[^\s]+",
                r"\1\2[redacted]",
                details,
            )
            raise ValueError(
                f"Etapa: {stage}\nPython: {args[0]}\nAmbiente: {self.path(project)}"
                f"\nComando: {shlex.join(args)}\nCódigo: {getattr(error, 'returncode', 'indisponível')}"
                f"\nErro: {details}\nVerifique o interpretador, as permissões e a conexão. O ambiente foi preservado."
            ) from error

    def ensure(self, project):
        folder = self.path(project)
        python = self.interpreter(project)
        if python is None:
            if folder.exists():
                raise ValueError(
                    f"Ambiente incompleto preservado: {folder}. Selecione outro projeto ou repare este ambiente."
                )
            base = external_python(self.selected(project))
            folder.parent.mkdir(parents=True, exist_ok=True)
            self._run(
                project,
                "criação do venv",
                [
                    str(base),
                    "-I",
                    "-c",
                    HIDDEN_CHILD_BOOTSTRAP
                    + "\nimport venv,sys; venv.EnvBuilder(with_pip=True, clear=False).create(sys.argv[1])",
                    str(folder),
                ],
            )
            python = self.interpreter(project)
        if python is None:
            raise ValueError(
                f"Criação do venv não produziu o executável esperado: {folder}"
            )
        self._run(
            project,
            "validação do ambiente",
            [
                str(python),
                "-I",
                "-c",
                "import sys; assert sys.prefix != sys.base_prefix",
            ],
        )
        return python

    def prepare_kernel(self, project):
        python = self.ensure(project)
        probe = run_external(
            [str(python), "-I", "-c", "import ipykernel"],
            capture_output=True,
            timeout=15,
        )
        if probe.returncode:
            self.install(
                project, ["ipykernel", "pandas", "pyarrow", "duckdb"], confirm=True
            )
        return python

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
                capture_output=True,
                text=True,
                timeout=15,
                check=True,
            )
            import json

            packages = json.loads(result.stdout)
        except (subprocess.SubprocessError, ValueError) as error:
            raise ValueError(
                "Não foi possível listar os pacotes deste ambiente."
            ) from error
        return {"initialized": True, "packages": packages, "python": str(python)}

    def install(self, project, packages, *, confirm=False):
        if confirm is not True:
            raise ValueError("A instalação exige confirmação explícita do usuário.")
        if (
            not isinstance(packages, list)
            or not 1 <= len(packages) <= MAX_PACKAGES
            or any(
                not isinstance(item, str)
                or len(item) > 120
                or not PACKAGE.fullmatch(item)
                for item in packages
            )
        ):
            raise ValueError(
                "Informe até cinco pacotes PyPI válidos. URLs e opções de pip não são aceitas."
            )
        python = self.ensure(project)
        # Static Jedi completion executes inside the selected interpreter on
        # Windows. Ensure its tooling is available whenever users authorize
        # installing packages; no environment is created without consent.
        tooling = (
            []
            if any(re.match(r"(?i)^jedi\b", package) for package in packages)
            else ["jedi==0.19.2"]
        )
        process = self._run(
            project,
            "instalação de bibliotecas",
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-input",
                "--only-binary=:all:",
                *packages,
                *tooling,
            ],
            timeout=180,
        )
        log = (process.stdout + "\n" + process.stderr)[-MAX_LOG:]
        return {"installed": packages, "log": log, "environment": str(python)}

    def remove(self, project, packages, *, confirm=False):
        if confirm is not True:
            raise ValueError("A remoção exige confirmação explícita do usuário.")
        if (
            not isinstance(packages, list)
            or not 1 <= len(packages) <= MAX_PACKAGES
            or any(
                not isinstance(name, str)
                or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,119}", name)
                for name in packages
            )
        ):
            raise ValueError("Informe até cinco nomes de pacotes válidos.")
        executable = self.interpreter(project)
        if executable is None:
            raise ValueError("Este projeto ainda não possui ambiente Python.")
        result = run_external(
            [
                str(executable),
                "-m",
                "pip",
                "uninstall",
                "--yes",
                "--disable-pip-version-check",
                *packages,
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
        log = (result.stdout + "\n" + result.stderr)[-MAX_LOG:]
        if result.returncode:
            raise ValueError("Não foi possível remover as bibliotecas: " + log[-3000:])
        return {"removed": packages, "log": log}

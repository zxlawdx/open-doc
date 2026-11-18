"""Project-local Python environments and default kernel dependencies."""

import os
import signal
import tempfile
import hashlib
import json
import shlex
import re
import subprocess
import sys
from pathlib import Path
from uuid import UUID
from threading import RLock
from .embedded_runtime import embedded_tools
from .local_runtime import popen_external
from .local_runtime import external_python, run_external, HIDDEN_CHILD_BOOTSTRAP

PACKAGE = re.compile(
    r"^[A-Za-z][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?"
    r"(?:(?:==|>=|<=|~=|!=|>|<)[A-Za-z0-9.!+_-]+)?$"
)
MAX_PACKAGES = 5
MAX_LOG = 49152
_JOBS = {}
_JOB_LOCK = RLock()
_ENV_LOCK = RLock()


class PythonEnvironments:
    def __init__(self, workspace):
        self.root = Path(workspace) / ".veladata" / "python_envs"

    def path(self, project):
        try:
            identifier = str(UUID(project))
        except (TypeError, ValueError, AttributeError) as error:
            raise ValueError("Identificador de projeto inválido.") from error
        slot = self.selection(project).get("slot", "")
        if slot and not re.fullmatch(r"[a-z0-9-]{1,64}", slot):
            raise ValueError("Seleção de ambiente inválida.")
        return self.root / (identifier + ("-" + slot if slot else ""))

    def interpreter(self, project):
        selection = self.selection(project)
        if selection.get("kind") == "existing":
            candidate = Path(selection["python"])
            if not candidate.is_file():
                raise ValueError(
                    "O ambiente selecionado não existe mais: " + str(candidate)
                )
            return candidate
        folder = self.path(project)
        layouts = (
            ("Scripts/python.exe", "bin/python.exe", "bin/python")
            if sys.platform == "win32"
            else ("bin/python",)
        )
        return next(
            (folder / name for name in layouts if (folder / name).is_file()), None
        )

    def selection(self, project):
        try:
            identifier = str(UUID(project))
        except (TypeError, ValueError, AttributeError) as error:
            raise ValueError("Identificador de projeto inválido.") from error
        setting = self.root / (identifier + ".json")
        return json.loads(setting.read_text()) if setting.is_file() else {}

    def selected(self, project):
        selection = self.selection(project)
        return selection.get("python") if selection.get("kind") != "internal" else None

    def select(self, project, executable=None, *, existing=False, internal=False):
        if internal:
            selected = {"kind": "internal", "slot": "internal"}
        elif existing:
            actual = Path(executable).absolute()
            self._run(
                project,
                "validação do ambiente selecionado",
                [
                    str(actual),
                    "-I",
                    "-c",
                    'import sys; assert sys.prefix != sys.base_prefix, "Selecione um venv, não o Python global"',
                ],
            )
            selected = {"kind": "existing", "python": str(actual)}
        else:
            base = str(external_python(executable))
            selected = {
                "kind": "base",
                "python": base,
                "slot": hashlib.sha256(base.encode()).hexdigest()[:16],
            }
        setting = self.root / (str(UUID(project)) + ".json")
        setting.parent.mkdir(parents=True, exist_ok=True)
        setting.write_text(json.dumps(selected))
        return selected

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
        with _ENV_LOCK:
            return self._ensure(project)

    def _ensure(self, project):
        folder = self.path(project)
        python = self.interpreter(project)
        if python is None:
            if folder.exists():
                raise ValueError(
                    f"Ambiente incompleto preservado: {folder}. Selecione outro projeto ou repare este ambiente."
                )
            base = external_python(self.selected(project))
            try:
                folder.parent.mkdir(parents=True, exist_ok=True)
            except OSError as error:
                raise ValueError(
                    f"Etapa: criação do diretório\nPython: {base}\nAmbiente: {folder}\nErro: {error}\nVerifique as permissões do workspace."
                ) from error
            tools = embedded_tools()
            if tools:
                args = [
                    str(tools["uv"]),
                    "venv",
                    "--offline",
                    "--no-python-downloads",
                    "--python",
                    str(base),
                    str(folder),
                ]
            else:
                args = [
                    str(base),
                    "-I",
                    "-c",
                    HIDDEN_CHILD_BOOTSTRAP
                    + "\nimport venv,sys; venv.EnvBuilder(with_pip=True, clear=False).create(sys.argv[1])",
                    str(folder),
                ]
            self._run(project, "criação do venv", args)
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
        with _ENV_LOCK:
            return self._prepare_kernel(project)

    def _prepare_kernel(self, project):
        python = self.ensure(project)
        probe = run_external(
            [str(python), "-I", "-c", "import ipykernel, jedi, pip"],
            capture_output=True,
            timeout=15,
        )
        if probe.returncode:
            tools = embedded_tools()
            compatible = (
                run_external(
                    [
                        str(python),
                        "-I",
                        "-c",
                        "import sys,struct; assert sys.version_info[:2] == (3,12) and struct.calcsize('P') == 8",
                    ],
                    capture_output=True,
                    timeout=15,
                )
                if tools
                else None
            )
            if tools and compatible.returncode == 0 and not self.selected(project):
                self._run(
                    project,
                    "preparação offline do Jupyter",
                    [
                        str(tools["uv"]),
                        "pip",
                        "install",
                        "--python",
                        str(python),
                        "--offline",
                        "--no-index",
                        "--find-links",
                        str(tools["root"] / "wheels"),
                        "--require-hashes",
                        "-r",
                        str(tools["root"] / "python-base.lock"),
                    ],
                    timeout=180,
                )
            else:
                self.install(project, ["ipykernel"], confirm=True)
        return python

    def prepare_data(self, project):
        python = self.prepare_kernel(project)
        probe = run_external(
            [str(python), "-I", "-c", "import pandas, pyarrow, duckdb"],
            capture_output=True,
            timeout=15,
        )
        if probe.returncode:
            self.install(project, ["pandas", "pyarrow", "duckdb"], confirm=True)
        return python

    def status(self, project):
        python = self.interpreter(project)
        if python is None:
            return {
                "initialized": False,
                "packages": [],
                "python": self.selected(project),
                "selection": self.selection(project),
            }
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
        return {
            "initialized": True,
            "packages": packages,
            "python": str(python),
            "selection": self.selection(project),
        }

    def install(self, project, packages, *, confirm=False, upgrade=False):
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
        tools = embedded_tools()
        if tools:
            command = [
                str(tools["uv"]),
                "pip",
                "install",
                "--python",
                str(python),
                "--no-progress",
            ]
        else:
            command = [
                str(python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-input",
            ]
        if upgrade:
            command.append("--upgrade")
        # Static Jedi completion executes inside the selected interpreter on
        # Windows. Ensure its tooling is available whenever users authorize
        # installing packages; no environment is created without consent.
        tooling = (
            []
            if any(re.match(r"(?i)^jedi\b", package) for package in packages)
            else ["jedi==0.19.2"]
        )
        process = (
            self._package_run(project, command + [*packages, *tooling])
            if tools
            else self._run(
                project,
                "instalação de bibliotecas",
                command + ["--only-binary=:all:", *packages, *tooling],
                timeout=180,
            )
        )
        if tools:
            # pip is also necessary for native %pip / !pip in this environment.
            self._run(
                project,
                "preparação do pip",
                [
                    str(tools["uv"]),
                    "pip",
                    "install",
                    "--python",
                    str(python),
                    "--offline",
                    "--no-index",
                    "--find-links",
                    str(tools["root"] / "wheels"),
                    "pip==25.3",
                ],
            )
        log = (process.stdout + "\n" + process.stderr)[-MAX_LOG:]
        return {"installed": packages, "log": log, "environment": str(python)}

    @staticmethod
    def _safe_log(text):
        text = re.sub(r"(https?://)[^\s/@]+:[^\s/@]+@", r"\1[redacted]@", text)
        return re.sub(
            r"(?i)(token|password|secret)([=:]\s*)[^\s]+", r"\1\2[redacted]", text
        )

    def _package_run(self, project, command):
        key = (str(self.root.resolve()), project)
        with tempfile.TemporaryDirectory(prefix="opendoc-install-") as directory:
            log = Path(directory) / "pip.log"
            with _JOB_LOCK, log.open("wb") as output:
                if key in _JOBS:
                    raise ValueError("Este projeto já está instalando bibliotecas.")
                process = popen_external(
                    command,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    start_new_session=(os.name != "nt"),
                )
                _JOBS[key] = {"process": process, "log": log}
            try:
                try:
                    process.wait(timeout=300)
                except subprocess.TimeoutExpired:
                    self._terminate_install(process)
                    process.wait()
                    raise ValueError(
                        "Instalação excedeu cinco minutos. O ambiente foi preservado."
                    )
                details = self._safe_log(
                    log.read_text(encoding="utf-8", errors="replace")[-MAX_LOG:]
                )
                if process.returncode:
                    raise ValueError(
                        f"Etapa: instalação de bibliotecas\nPython: {self.interpreter(project)}\nAmbiente: {self.path(project)}\nComando: {shlex.join(command)}\nCódigo: {process.returncode}\n{details[-3000:]}"
                    )
                return subprocess.CompletedProcess(
                    command, process.returncode, details, ""
                )
            finally:
                with _JOB_LOCK:
                    _JOBS.pop(key, None)

    def job_status(self, project):
        self.path(project)
        with _JOB_LOCK:
            job = _JOBS.get((str(self.root.resolve()), project))
            if not job:
                return {"running": False, "log": ""}
            with job["log"].open("rb") as stream:
                stream.seek(0, 2)
                size = stream.tell()
                stream.seek(max(0, size - MAX_LOG))
                log = self._safe_log(stream.read().decode("utf-8", errors="replace"))
            return {"running": job["process"].poll() is None, "log": log}

    @staticmethod
    def _terminate_install(process):
        if process.poll() is not None:
            return
        if os.name == "nt":
            taskkill = (
                Path(os.environ.get("SystemRoot", r"C:\Windows"))
                / "System32/taskkill.exe"
            )
            run_external(
                [str(taskkill), "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                timeout=15,
            )
        else:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    def cancel(self, project):
        self.path(project)
        with _JOB_LOCK:
            job = _JOBS.get((str(self.root.resolve()), project))
            if job is not None:
                self._terminate_install(job["process"])
        return {"cancelled": job is not None}

    def requirements(self, project):
        python = self.interpreter(project)
        if python is None:
            return {"text": ""}
        result = self._run(
            project, "exportação de requirements", [str(python), "-m", "pip", "freeze"]
        )
        return {"text": result.stdout}

    def import_requirements(self, project, text, *, confirm=False):
        if not isinstance(text, str) or len(text) > 64000:
            raise ValueError("requirements.txt deve ter até 64 KB.")
        packages = [
            line.strip()
            for line in text.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        if (
            not packages
            or len(packages) > 200
            or any(not PACKAGE.fullmatch(item) for item in packages)
        ):
            raise ValueError(
                "Use nomes PyPI e versões; opções, URLs e includes não são aceitos."
            )
        results = [
            self.install(project, packages[i : i + MAX_PACKAGES], confirm=confirm)
            for i in range(0, len(packages), MAX_PACKAGES)
        ]
        return {
            "installed": packages,
            "log": "\n".join(result["log"] for result in results),
        }

    def check(self, project):
        python = self.interpreter(project)
        if python is None:
            raise ValueError("Este projeto ainda não possui ambiente Python.")
        result = run_external(
            [str(python), "-m", "pip", "check"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return {
            "compatible": result.returncode == 0,
            "log": result.stdout + result.stderr,
        }

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

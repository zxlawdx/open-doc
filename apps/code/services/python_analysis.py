"""Static Python editor services. Script text is analyzed, never executed."""

import sys
import json
from functools import lru_cache
from threading import Lock

from .python_runner import MAX_CODE

_analysis_lock = Lock()


@lru_cache(maxsize=8)
def environment(interpreter):
    import jedi

    # Selected only from project-owned venv paths, never from an arbitrary client path.
    return jedi.create_environment(str(interpreter), safe=False)


def analyze(code, line, column, operation, project=None):
    if not isinstance(code, str) or len(code) > MAX_CODE:
        raise ValueError("O código excede o limite do editor.")
    if operation == "diagnostics":
        code = "\n".join("pass" if line.lstrip().startswith(("!pip ", "%pip ")) else line for line in code.split("\n"))
    lines = code.split("\n")
    if (type(line) is not int or type(column) is not int or not 1 <= line <= len(lines)
            or not 0 <= column <= len(lines[line - 1])):
        raise ValueError("Posição do cursor inválida.")
    if operation not in ("complete", "diagnostics", "inspect"):
        raise ValueError("Operação de análise inválida.")
    # Always use the project's own interpreter for third-party packages.
    # In-process Jedi with a separate Environment may retain import caches or
    # search a different site-packages than the notebook on Linux. The same
    # isolated worker path is used across Linux Mint and Windows.
    from .python_envs import PythonEnvironments
    from shared.contracts.workspace import workspace
    selected = (
        PythonEnvironments(workspace().config.root).interpreter(project)
        if project else None
    )
    if selected is not None or getattr(sys, "frozen", False) or sys.platform == "win32":
        from .local_runtime import external_python, run_external
        from .analysis_worker import SOURCE
        executable = selected or external_python()
        result = run_external([str(executable), "-I", "-c", SOURCE],
                              input=json.dumps([code,line,column,operation]), capture_output=True, text=True, timeout=15)
        if result.returncode:
            details=(result.stderr or result.stdout or "")[-1200:]
            if "No module named 'jedi'" in details or 'No module named "jedi"' in details:
                raise ValueError(
                    "Jedi não está instalado no Python deste projeto. Abra "
                    "Bibliotecas do projeto e selecione 'Ativar autocomplete Python (Jedi)'."
                )
            raise ValueError(
                "Falha ao analisar o Python do projeto. Verifique o ambiente "
                "selecionado e as bibliotecas instaladas."
            )
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise ValueError("O serviço de autocomplete retornou uma resposta inválida.") from error
    import jedi
    with _analysis_lock:
        script = jedi.Script(code, environment=environment(str(sys.executable)))
        if operation == "complete":
            return {"items": [
                {"label": item.name, "type": item.type}
                for item in script.complete(line, column)[:100]
            ]}
        if operation == "diagnostics":
            return {"items": [
                {"line": error.line, "column": error.column, "message": error.get_message()}
                for error in script.get_syntax_errors()[:30]
            ]}
        signatures = script.get_signatures(line, column)
        names = script.help(line, column)
        return {
            "signature": signatures[0].to_string() if signatures else "",
            "documentation": names[0].docstring(raw=True)[:4000] if names else "",
        }

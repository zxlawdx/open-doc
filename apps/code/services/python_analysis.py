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
    import jedi


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
    if getattr(sys, "frozen", False) or sys.platform == "win32":
        from .local_runtime import external_python, run_external
        from .analysis_worker import SOURCE
        from .python_envs import PythonEnvironments
        from shared.contracts.workspace import workspace
        executable = PythonEnvironments(workspace().config.root).interpreter(project) if project else None
        result = run_external([str(executable or external_python()), "-I", "-c", SOURCE],
                              input=json.dumps([code,line,column,operation]), capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise ValueError("Prepare o ambiente do notebook para habilitar autocomplete.")
        return json.loads(result.stdout)
    with _analysis_lock:
        executable = sys.executable
        if project:
            from shared.contracts.workspace import workspace as get_context
            from .python_envs import PythonEnvironments
            chosen = PythonEnvironments(get_context().config.root).interpreter(project)
            if chosen is not None:
                executable = chosen
        script = jedi.Script(code, environment=environment(str(executable)))
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

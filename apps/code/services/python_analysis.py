"""Static Python editor services. Script text is analyzed, never executed."""

import sys
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

    if getattr(sys, "frozen", False):
        raise ValueError("Abra o Open Doc pelo Python para usar análise contextual nesta versão.")

    if not isinstance(code, str) or len(code) > MAX_CODE:
        raise ValueError("O código excede o limite do editor.")
    lines = code.split("\n")
    if (type(line) is not int or type(column) is not int or not 1 <= line <= len(lines)
            or not 0 <= column <= len(lines[line - 1])):
        raise ValueError("Posição do cursor inválida.")
    if operation not in ("complete", "diagnostics", "inspect"):
        raise ValueError("Operação de análise inválida.")
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

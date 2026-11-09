"""Static Python editor services. Script text is analyzed, never executed."""

import sys
from functools import lru_cache
from threading import Lock

from .python_runner import MAX_CODE

_analysis_lock = Lock()


@lru_cache(maxsize=1)
def environment():
    import jedi

    return jedi.create_environment(sys.executable, safe=True)


def analyze(code, line, column, operation):
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
        script = jedi.Script(code, environment=environment())
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

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
    lines = code.split("\n")
    if (
        type(line) is not int
        or type(column) is not int
        or not 1 <= line <= len(lines)
        or not 0 <= column <= len(lines[line - 1])
    ):
        raise ValueError("Posição do cursor inválida.")
    if operation not in ("complete", "diagnostics", "inspect"):
        raise ValueError("Operação de análise inválida.")
    # Preserve cursor offsets on Python lines while hiding notebook magics
    # from Jedi. Keep indentation so magics inside a block remain valid.
    for index, source in enumerate(lines):
        stripped = source.lstrip()
        if stripped.startswith(("!", "%")):
            if index == line - 1 and operation != "diagnostics":
                return {"items": []} if operation == "complete" else {
                    "signature": "", "documentation": ""
                }
            lines[index] = source[:len(source) - len(stripped)] + "pass"
    code = "\n".join(lines)

    from .python_envs import PythonEnvironments
    from shared.contracts.workspace import workspace

    manager = PythonEnvironments(workspace().config.root) if project else None
    selected = None
    # Syntax linting does not need a project environment and should never
    # compete with its initial setup or with a package installation.
    if operation != "diagnostics" and manager:
        from .embedded_runtime import embedded_tools

        selected = manager.interpreter(project)
        if selected is None and embedded_tools():
            selected = manager.prepare_kernel(project)
    if selected is not None or getattr(sys, "frozen", False) or sys.platform == "win32":
        from .local_runtime import external_python, run_external
        from .analysis_worker import SOURCE

        executable = selected or external_python()
        payload = json.dumps([code, line, column, operation])

        def run_worker(python):
            return run_external(
                [str(python), "-I", "-c", SOURCE],
                input=payload,
                capture_output=True,
                text=True,
                timeout=15,
            )

        result = run_worker(executable)
        missing_jedi = "No module named 'jedi'"
        if result.returncode and selected is not None and missing_jedi in (result.stderr or ""):
            result = run_worker(manager.prepare_kernel(project))
        if result.returncode:
            if missing_jedi in (result.stderr or ""):
                raise ValueError(
                    "Jedi não está disponível no ambiente Python do projeto."
                )
            raise ValueError(
                "Falha ao analisar o Python do projeto. Verifique o ambiente "
                "selecionado e as bibliotecas instaladas."
            )
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise ValueError(
                "O serviço de autocomplete retornou uma resposta inválida."
            ) from error
    import jedi

    with _analysis_lock:
        script = jedi.Script(code, environment=environment(str(sys.executable)))
        if operation == "complete":
            return {
                "items": [
                    {"label": item.name, "type": item.type}
                    for item in script.complete(line, column)[:100]
                ]
            }
        if operation == "diagnostics":
            return {
                "items": [
                    {
                        "line": error.line,
                        "column": error.column,
                        "message": error.get_message(),
                    }
                    for error in script.get_syntax_errors()[:30]
                ]
            }
        signatures = script.get_signatures(line, column)
        names = script.help(line, column)
        return {
            "signature": signatures[0].to_string() if signatures else "",
            "documentation": names[0].docstring(raw=True)[:4000] if names else "",
        }

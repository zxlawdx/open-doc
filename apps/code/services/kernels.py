"""Persistent per-project Jupyter kernels using the selected external Python."""

import json
import os
import queue
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock

from .local_runtime import (
    child_environment,
    external_dll_search,
    external_python,
    run_external,
)
from .python_envs import PythonEnvironments


@dataclass
class Session:
    manager: object
    client: object
    directory: object
    lock: object = field(default_factory=RLock)
    executions: int = 0


class KernelSessions:
    def __init__(self, workspace, *, max_sessions=4):
        self.workspace = Path(workspace)
        self.max_sessions = max_sessions
        self._sessions = {}
        self._lock = RLock()
        self._closed = False

    def _session(self, project):
        from jupyter_client import KernelManager
        from jupyter_client.kernelspec import KernelSpec, KernelSpecManager

        # Validate project UUID through the existing environment manager.
        environments = PythonEnvironments(self.workspace)
        environments.path(project)
        with self._lock:
            if self._closed:
                raise RuntimeError("Sessões Python encerradas.")
            if project in self._sessions:
                if self._sessions[project].manager.is_alive():
                    return self._sessions[project]
                self.stop(project)
            if len(self._sessions) >= self.max_sessions:
                raise ValueError("Encerre uma sessão Python antes de abrir outra.")
            executable = environments.interpreter(project) or external_python()
            try:
                run_external(
                    [str(executable), "-c", "import ipykernel"],
                    capture_output=True,
                    check=True,
                    timeout=15,
                )
            except Exception as exc:
                raise ValueError(
                    "Instale ipykernel, pandas e pyarrow no ambiente deste projeto para iniciar o notebook."
                ) from exc

            class ProjectSpecs(KernelSpecManager):
                def get_kernel_spec(self, kernel_name):
                    return KernelSpec(
                        argv=[
                            str(executable),
                            "-m",
                            "ipykernel_launcher",
                            "-f",
                            "{connection_file}",
                        ],
                        display_name="Open Doc",
                        language="python",
                    )

            directory = tempfile.TemporaryDirectory(prefix="opendoc-kernel-")
            manager = KernelManager(
                kernel_name="open-doc",
                kernel_spec_manager=ProjectSpecs(),
                transport="tcp" if os.name == "nt" else "ipc",
                ip=(
                    "127.0.0.1"
                    if os.name == "nt"
                    else str(Path(directory.name) / "connection")
                ),
            )
            startup_log = Path(directory.name) / "startup.log"
            try:
                # Windowed frozen apps have no valid inherited standard handles.
                with startup_log.open("wb") as errors, external_dll_search():
                    manager.start_kernel(
                        cwd=directory.name, env=child_environment(),
                        stdout=subprocess.DEVNULL, stderr=errors,
                    )
                client = manager.blocking_client()
                client.start_channels()
                client.wait_for_ready(timeout=30)
            except BaseException as error:
                manager.shutdown_kernel(now=True)
                with startup_log.open("rb") as errors:
                    details = errors.read(16384).decode("utf-8", errors="replace")
                directory.cleanup()
                raise RuntimeError("Não foi possível iniciar o kernel: " + str(error) + "\n" + details) from error
            session = Session(manager, client, directory)
            self._sessions[project] = session
            return session

    def execute(self, project, code, *, timeout=60):
        if not isinstance(code, str) or not code.strip() or len(code) > 24000:
            raise ValueError("Informe uma célula de até 24 mil caracteres.")
        session = self._session(project)
        if not session.lock.acquire(blocking=False):
            raise ValueError("O kernel deste projeto já está executando uma célula.")
        try:
            message_id = session.client.execute(
                code, store_history=True, allow_stdin=False, stop_on_error=True
            )
            outputs, size, error, text = [], 0, False, []
            deadline = time.monotonic() + timeout
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    session.manager.interrupt_kernel()
                    self.stop(project)
                    return {
                        "stopped": "timeout",
                        "returncode": 1,
                        "output": "Tempo de execução excedido; kernel encerrado.",
                    }
                try:
                    message = session.client.get_iopub_msg(timeout=min(remaining, 1))
                except queue.Empty:
                    if not session.manager.is_alive():
                        return {
                            "returncode": 1,
                            "output": "Kernel encerrado. Reabra o DataFrame para continuar.",
                            "stopped": "kernel",
                        }
                    continue
                if message.get("parent_header", {}).get("msg_id") != message_id:
                    continue
                previous_outputs = len(outputs)
                kind, content = message["msg_type"], message["content"]
                if kind == "status" and content.get("execution_state") == "idle":
                    break
                if kind == "stream":
                    value = content.get("text", "")
                    text.append(value)
                    outputs.append({"type": "stream", "text": value})
                elif kind in {"display_data", "execute_result"}:
                    # Only inert MIME values are forwarded; HTML is sanitized in
                    # the renderer and scripts are never evaluated.
                    data = {
                        key: value
                        for key, value in content.get("data", {}).items()
                        if key
                        in {
                            "text/plain",
                            "text/markdown",
                            "text/html",
                            "image/png",
                            "image/jpeg",
                        }
                    }
                    outputs.append({"type": "display", "data": data})
                    if "text/plain" in data:
                        text.append(str(data["text/plain"]) + "\n")
                elif kind == "error":
                    error = True
                    value = (
                        str(content.get("ename", "Error"))
                        + ": "
                        + str(content.get("evalue", ""))
                    )
                    text.append(value)
                    outputs.append({"type": "error", "text": value})
                if len(outputs) != previous_outputs:
                    size += len(json.dumps(outputs[-1], ensure_ascii=False))
                if size > 2 * 1024 * 1024:
                    session.manager.interrupt_kernel()
                    self.stop(project)
                    return {
                        "stopped": "output",
                        "returncode": 1,
                        "output": "Saída excedeu 2 MB; kernel encerrado.",
                    }
            # Consume the matching shell reply as well as IOPub output, so
            # long-lived sessions do not accumulate one unread reply per cell.
            try:
                while True:
                    reply = session.client.get_shell_msg(timeout=5)
                    if reply.get("parent_header", {}).get("msg_id") == message_id:
                        break
            except queue.Empty:
                pass
            session.executions += 1
            return {
                "output": "".join(text),
                "outputs": outputs,
                "returncode": int(error),
                "execution_count": session.executions,
                "session": project,
            }
        finally:
            session.lock.release()

    def has_session(self, project):
        with self._lock:
            session = self._sessions.get(project)
            return session is not None and session.manager.is_alive()

    def status(self):
        with self._lock:
            return [
                {
                    "project": key,
                    "executions": value.executions,
                    "alive": value.manager.is_alive(),
                }
                for key, value in self._sessions.items()
            ]

    def stop(self, project):
        with self._lock:
            session = self._sessions.pop(project, None)
        if session is not None:
            session.client.stop_channels()
            session.manager.shutdown_kernel(now=True)
            session.directory.cleanup()
        return {"stopped": True}

    def close(self):
        with self._lock:
            self._closed = True
            projects = list(self._sessions)
        for project in projects:
            self.stop(project)

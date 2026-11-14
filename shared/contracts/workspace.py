"""Workspace access boundary. Modules consume this contract, not shell internals."""

from typing import Protocol, Callable, Any


class WorkspaceContext(Protocol):
    config: Any
    code_tools: Any
    dataset_exchange: Any
    resource_workspace: Any
    datasets: Any
    token: str


_provider: Callable[[], WorkspaceContext] | None = None


def bind_workspace(provider: Callable[[], WorkspaceContext]) -> None:
    global _provider
    _provider = provider


def workspace() -> WorkspaceContext:
    if _provider is None:
        raise RuntimeError("Workspace has not been configured.")
    return _provider()

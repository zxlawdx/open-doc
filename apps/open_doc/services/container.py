"""Compatibility shim for the pre-architecture service container import path."""

from apps.open_doc.application.context import (
    ApplicationContext as Services,
    configure,
    get_context,
)


def services() -> Services:
    return get_context()


__all__ = ["Services", "configure", "services"]

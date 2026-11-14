"""Compatibility imports; dependency composition belongs to config."""
from config.composition import ApplicationContext, configure, get_context
__all__ = ["ApplicationContext", "configure", "get_context"]

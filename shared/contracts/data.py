"""Explicit callable boundary used by the shell during incremental migration."""

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class DataTools:
    worksheet: Callable
    export_csv: Callable


@dataclass(frozen=True)
class CodeTools:
    run_python: Callable
    environments: Callable
    clear_analysis_cache: Callable

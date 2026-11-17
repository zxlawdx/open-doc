"""Fail release builds if the bundled Vela runtime differs from the reviewed revision."""

from __future__ import annotations

import inspect
import json
from importlib import metadata
from pathlib import Path

from vela.core.app import VelaApp

EXPECTED_COMMIT = "48e0b912bff1a8cd61ef77fb348cb2ab11a9dcce"


def check() -> None:
    parameters = inspect.signature(VelaApp.__init__).parameters
    if "resource_directory" not in parameters:
        raise RuntimeError(
            "VelaApp does not support resource_directory; the Open Doc installer "
            "would crash on startup."
        )

    distribution = metadata.distribution("vela-framework")
    origin = distribution.read_text("direct_url.json")
    if not origin:
        raise RuntimeError("Vela must be installed from the pinned Git revision.")
    source = json.loads(origin)
    actual = source.get("vcs_info", {}).get("commit_id", "")
    if actual != EXPECTED_COMMIT:
        raise RuntimeError(
            f"Incorrect Vela runtime: expected {EXPECTED_COMMIT}, got {actual!r}."
        )
    print(f"Verified Vela runtime {actual} at {Path(inspect.getfile(VelaApp)).resolve()}")


if __name__ == "__main__":
    check()

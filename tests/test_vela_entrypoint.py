"""The Open Doc entrypoint must honor the layout created by vela startproject.

These subprocess tests deliberately launch manage.py through runpy from a
foreign working directory. They also supply a conflicting third-party 'config'
package: the project-local config/wsgi.py and config/settings.py must win.
No Vela runtime is reimplemented here; a tiny CLI spy only inspects imports.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("command", ["runapp", "collectstatic"])
def test_manage_cli_finds_project_config_without_reimplementing_vela(
    tmp_path: Path, command: str
) -> None:
    fake = tmp_path / "fake-packages"
    cli = fake / "vela" / "cli"
    cli.mkdir(parents=True)
    (fake / "vela" / "__init__.py").write_text("")
    (cli / "__init__.py").write_text("")
    (fake / "vela" / "apps.py").write_text("class AppConfig: pass")
    (cli / "collectstatic.py").write_text("def collect_static(*, asset_config=None): return {}")
    (fake / "config").mkdir()
    (fake / "config" / "__init__.py").write_text("# shadow package")
    (fake / "config" / "wsgi.py").write_text("# unwanted wsgi")
    (fake / "config" / "settings.py").write_text("# unwanted settings")

    (cli / "commands.py").write_text(
        """
import importlib.util
import sys

class CommandRunner:
    def execute(self, argv):
        print("CLI_COMMAND=" + ",".join(argv))
        for name in ("config.wsgi", "config.settings"):
            print(name + "=" + str(importlib.util.find_spec(name).origin))
        print("PREFS_EARLY=" + str("apps.open_doc.services.preferences_service" in sys.modules))
        return 0
""",
        encoding="utf-8",
    )
    env = {
        **os.environ,
        "PYTHONPATH": str(fake),
        "PYTHONUTF8": "1",
    }
    # A Python -c entrypoint starts outside the repository. In contrast with
    # python manage.py, runpy does NOT auto-insert the script directory.
    script = (
        "import runpy,sys;"
        f"sys.argv=[{str(ROOT / 'manage.py')!r}, {command!r}];"
        f"runpy.run_path({str(ROOT / 'manage.py')!r},run_name='__main__')"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "CLI_COMMAND=" + command in result.stdout
    assert "config.wsgi=" + str(ROOT / "config" / "wsgi.py") in result.stdout
    assert "config.settings=" + str(ROOT / "config" / "settings.py") in result.stdout
    assert "PREFS_EARLY=False" in result.stdout


def test_manager_is_thin_vela_dispatcher():
    source = (ROOT / "manage.py").read_text(encoding="utf-8")
    assert "from vela.cli.commands import CommandRunner" in source
    assert "from apps.open_doc.services.preferences_service" not in source
    assert "sys.path.insert(0, str(BASE_DIR))" in source


def test_outdated_vela_is_reported_instead_of_fake_missing_wsgi(tmp_path: Path) -> None:
    fake = tmp_path / "old-framework"
    cli = fake / "vela" / "cli"
    cli.mkdir(parents=True)
    (fake / "vela" / "__init__.py").write_text("")
    (cli / "__init__.py").write_text("")
    (cli / "commands.py").write_text(
        "class CommandRunner:\n"
        "    def execute(self, argv): raise AssertionError('CLI antigo não deve executar')\n"
    )
    env = {**os.environ, "PYTHONPATH": str(fake), "PYTHONUTF8": "1"}
    script = (
        "import runpy,sys;"
        f"sys.argv=[{str(ROOT / 'manage.py')!r}, 'runapp'];"
        f"runpy.run_path({str(ROOT / 'manage.py')!r},run_name='__main__')"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode != 0
    assert "Vela Framework instalado é antigo ou incompatível" in result.stderr
    assert "Reinstale apenas a versão do Vela" in result.stderr
    assert "vela-framework @ git+" in result.stderr

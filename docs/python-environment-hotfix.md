# Python environment hotfix

The reported Windows machine has not been accessed. Python 3.14 patch differences are not established as the cause.

Confirmed defects in main at 65b18c0:

* Frozen interpreter discovery only checked python3/python on PATH; it ignored the Windows launcher and manual selection.
* Environment lookup assumed Scripts/python.exe on Windows. A successful venv using bin/python.exe was subsequently reported as a generic creation failure. A regression test reproduces this layout mismatch. Whether this explains the reported computer requires its new diagnostics.
* Creation subprocess errors were not exposed to the client with stage, command, environment and original stderr.
* NotebookService intercepted the first pip line and installed into the project venv independently of an already-running system kernel. Additional source lines were executed separately.

The shared environment service now discovers/probes concrete interpreters, supports manual persisted base selection before environment creation, recognizes both Windows layouts, validates/reuses environments and preserves damaged directories. Jupyter starts in a project venv and prepares its dependencies automatically. Shell pip is routed through IPython's native pip magic in the active kernel. Source strings and whole cells remain intact. Fresh kernel setup includes the existing data-workspace dependencies to preserve DataFrame and SQL operations. Existing project venvs retain their packages.

The library dialog exposes discovery, base selection, interpreter location and copyable diagnostics. Switching the base of an existing venv is deliberately refused in this emergency fix; broader selection belongs to the embedded-runtime follow-up.

Local validation: 46 Python tests passed, one real-kernel test skipped because this executor refuses ZeroMQ sockets (EPERM). Four library UI tests passed. collectstatic built successfully. Native Linux/Windows CI must execute the real-kernel test before merge, including Python 3.14.

On the affected Windows machine: create a new project, open Libraries, Detect interpreters, copy version/location, install pandas, run both `%pip install pandas` and `!pip install pandas`, then print `sys.executable` and create a DataFrame. On failure use Copy diagnostics; do not delete the existing environment. This verifies the installed build rather than an unrelated command-shell Python.

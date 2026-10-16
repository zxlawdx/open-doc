"""Real availability/language diagnostics; does not claim a recognition test."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.open_doc.ink.windows_ink import WindowsInkBackend

if __name__ == "__main__":
    print(json.dumps(WindowsInkBackend().diagnostics(), ensure_ascii=False, indent=2))

"""Physical-only event logger alias. Records metadata on a blank canvas, no documents."""

from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("qa_tablet.py")), run_name="__main__")

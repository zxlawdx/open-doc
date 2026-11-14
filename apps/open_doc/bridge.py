"""Compatibility module alias for the bridge now owned by config."""
import sys
from config import bridge as _bridge

sys.modules[__name__] = _bridge

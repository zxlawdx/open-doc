import json
from .validation import validate


def serialize(model):
    return json.dumps(
        validate(model), ensure_ascii=False, allow_nan=False, separators=(",", ":")
    )


def load(value):
    return validate(json.loads(value))

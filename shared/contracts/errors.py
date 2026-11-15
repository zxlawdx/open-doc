class RevisionConflict(ValueError):
    """An editor publication used a stale revision."""


class ServiceUnavailable(RuntimeError):
    """A recoverable service failure with a safe, public explanation."""

    def __init__(self, message: str, *, code: str):
        super().__init__(message)
        self.code = code

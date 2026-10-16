"""Fixed layout is distinct from the editable rich document."""

VERSION = "opendoc-fixed-v1"


def create(kind, source_sha256, surfaces):
    return {
        "version": VERSION,
        "source_kind": kind,
        "source_sha256": source_sha256,
        "surfaces": surfaces,
    }

from bottle import BaseRequest

from apps.open_doc.infrastructure.vela_compat import configure_request_body_limit


def test_legacy_request_limit_adapter_only_increases_limit(monkeypatch):
    monkeypatch.setattr(BaseRequest, "MEMFILE_MAX", 1024)
    configure_request_body_limit(4096)
    assert BaseRequest.MEMFILE_MAX == 4096
    configure_request_body_limit(2048)
    assert BaseRequest.MEMFILE_MAX == 4096


def test_legacy_request_limit_rejects_invalid_values():
    for value in (0, -1, True):
        try:
            configure_request_body_limit(value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid body limit accepted: {value!r}")

from shared.contracts.errors import ServiceUnavailable
from shared.services.http import _handle


def test_service_failure_is_actionable_without_exposing_private_diagnostics():
    def fail():
        try:
            raise RuntimeError('/private/kernel/secret.log')
        except RuntimeError as cause:
            raise ServiceUnavailable('Não foi possível iniciar o kernel Python.', code='kernel_startup_failed') from cause
    response = _handle(fail)
    assert response.status == 503
    assert response.body['code'] == 'kernel_startup_failed'
    assert response.body['retryable']
    assert 'kernel Python' in response.body['error']
    assert 'secret' not in str(response.body)
    assert 'gravar' not in str(response.body)


def test_unexpected_service_failure_does_not_claim_document_persistence():
    def fail():
        raise RuntimeError('internal sensitive information')
    response = _handle(fail)
    assert response.status == 500
    assert 'concluir a operação' in response.body['error']
    assert 'internal' not in str(response.body)


def test_kernel_startup_failure_stops_channels_even_when_shutdown_fails(tmp_path, monkeypatch):
    import sys
    from pathlib import Path
    from unittest.mock import Mock
    from uuid import uuid4
    import jupyter_client
    from apps.code.services import kernels

    client = Mock()
    client.wait_for_ready.side_effect = RuntimeError('private startup details')
    manager = Mock()
    manager.blocking_client.return_value = client
    manager.shutdown_kernel.side_effect = RuntimeError('cleanup also failed')
    monkeypatch.setattr(jupyter_client, 'KernelManager', lambda **kw: manager)
    monkeypatch.setattr(kernels, 'run_external', lambda *a, **kw: None)
    monkeypatch.setattr(kernels, 'external_python', lambda: Path(sys.executable))
    import pytest
    with pytest.raises(ServiceUnavailable, match='iniciar o kernel') as error:
        kernels.KernelSessions(tmp_path)._session(str(uuid4()))
    assert error.value.code == 'kernel_startup_failed'
    client.stop_channels.assert_called_once()
    manager.shutdown_kernel.assert_called_once()
    assert not Path(manager.start_kernel.call_args.kwargs['cwd']).exists()

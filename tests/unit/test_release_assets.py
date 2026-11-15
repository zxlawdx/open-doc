import hashlib
import pytest
from tools.verify_release_assets import verify


def test_release_gate_rejects_missing_or_damaged_platform_asset(tmp_path):
    for suffix in ('Windows-x64-Portable.zip','Windows-x64-Setup.exe','Linux-x64.tar.gz','Linux-amd64.deb'):
        name='Open-Doc-1.0.1-'+suffix
        data=('validated package '+suffix).encode()
        (tmp_path/name).write_bytes(data)
        (tmp_path/(name+'.sha256')).write_text(hashlib.sha256(data).hexdigest()+'  '+name+'\n')
    assert len(verify(tmp_path,'1.0.1')) == 4
    target=tmp_path/'Open-Doc-1.0.1-Windows-x64-Setup.exe'
    target.write_bytes(b'truncated')
    with pytest.raises(ValueError,match='checksum mismatch'):verify(tmp_path,'1.0.1')
    target.unlink()
    with pytest.raises(ValueError,match='asset set'):verify(tmp_path,'1.0.1')

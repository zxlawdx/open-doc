"""Verify the complete Windows/Linux asset set before replacing a release."""
import argparse
import hashlib
from pathlib import Path


def verify(directory, version):
    directory = Path(directory)
    names = [f'Open-Doc-{version}-{suffix}' for suffix in (
        'Windows-x64-Portable.zip', 'Windows-x64-Setup.exe',
        'Linux-x64.tar.gz', 'Linux-amd64.deb',
    )]
    expected = set(names + [name+'.sha256' for name in names])
    if {p.name for p in directory.iterdir()} != expected:
        raise ValueError('Incomplete or unexpected release asset set')
    for name in names:
        file = directory/name
        checksum = directory/(name+'.sha256')
        if file.is_symlink() or checksum.is_symlink():
            raise ValueError('Release assets must be regular files')
        fields = checksum.read_text(encoding='ascii').strip().split()
        if len(fields) != 2 or fields[1] != name:
            raise ValueError('Invalid checksum manifest: '+name)
        digest = hashlib.sha256()
        with file.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024*1024), b''):
                digest.update(chunk)
        if file.stat().st_size == 0 or digest.hexdigest() != fields[0]:
            raise ValueError('Release checksum mismatch: '+name)
    return names


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory')
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    for name in verify(args.directory, args.version):
        print('VERIFIED', name)

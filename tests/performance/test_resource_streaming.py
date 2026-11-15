import tracemalloc

from vela.resources import ResourceStore


def test_large_stream_uses_bounded_python_buffers(tmp_path):
    class Records:
        remaining = 8_000_000

        def read(self, size):
            count = min(size, self.remaining)
            self.remaining -= count
            return b"x" * count

    resources = ResourceStore(directory=tmp_path)
    tracemalloc.start()
    snapshot = resources.publish(Records())
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert snapshot.size == 8_000_000
    assert peak < snapshot.size // 2
    resources.close()

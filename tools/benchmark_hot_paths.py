"""Wall-clock diagnostics without cProfile/tracemalloc bias; no speed assertions."""
import argparse
import json
import platform
import statistics
import tempfile
import time
from pathlib import Path

from apps.data.services.store import Datasets


def measure(records):
    with tempfile.TemporaryDirectory() as root:
        root = Path(root)
        (root / '.veladata').mkdir()
        source = root / 'data.csv'
        with source.open('w') as stream:
            stream.write('id,value\n')
            for row in range(records):
                stream.write(f'{row},{row % 100}\n')
        store = Datasets(root)
        store.initialize()
        started = time.perf_counter()
        identifier = store.import_files([source], delimiter=',')['id']
        results = {'records': records, 'import_ms': (time.perf_counter()-started)*1000}
        for name, method in [('raw_csv_ms', store.write_csv), ('analysis_csv_ms', store.write_analysis_csv)]:
            with tempfile.TemporaryFile(mode='w+', newline='', encoding='utf-8') as stream:
                started = time.perf_counter()
                assert method(identifier, stream) == records
                results[name] = (time.perf_counter()-started)*1000
        store.set_type(identifier, 'column', 1, 'integer')
        started = time.perf_counter()
        query = store.query(identifier, 'SELECT SUM(value) FROM dados')
        results['typed_sum_ms'] = (time.perf_counter()-started)*1000
        assert int(query['rows'][0][0]) == sum(row % 100 for row in range(records))
        return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--records', type=int, nargs='+', default=[1000,10000,100000,1000000])
    parser.add_argument('--repeat', type=int, default=3)
    args = parser.parse_args()
    samples = [measure(n) for n in args.records for _ in range(args.repeat)]
    print(json.dumps({'python':platform.python_version(),'implementation':platform.python_implementation(),
                      'scope':'same executor, sequential samples; no tracing, no statistical global speed claim',
                      'samples':samples,'medians':{str(n):{key:statistics.median(s[key] for s in samples if s['records']==n) for key in samples[0] if key!='records'} for n in args.records}},indent=2))

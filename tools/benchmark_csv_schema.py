"""Parametrized CSV correctness/performance; timings exclude generation and profiling."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import csv,json,time,tempfile,math
import pandas as pd
from apps.data.services.store import Datasets
from config.wsgi import create_app
from config.composition import get_context
from shared.services.preferences_service import Config


def measure(records):
    with tempfile.TemporaryDirectory(prefix='opendoc-csv-benchmark-') as directory:
        root=Path(directory);path=root/'data.csv'
        with path.open('w',newline='') as stream:
            writer=csv.writer(stream);writer.writerow(['id','Age','amount','flag','day','code'])
            writer.writerows((i,'' if i%3==0 else 20 if i%3==1 else 31,i/10,'true' if i%2 else 'false','2024-01-02',str(i).zfill(9)) for i in range(records))
        baseline_root=root/'baseline';(baseline_root/'.veladata').mkdir(parents=True)
        baseline=Datasets(baseline_root);baseline.initialize()
        started=time.perf_counter();baseline.import_files([path]);legacy_ms=(time.perf_counter()-started)*1000
        app=create_app(Config(root/'typed'));ctx=get_context()
        try:
            started=time.perf_counter();identifier=ctx.datasets.import_files([path],encoding='auto',infer_types=True)['id'];typed_ms=(time.perf_counter()-started)*1000
            started=time.perf_counter();handle=ctx.dataset_exchange.snapshot(identifier)['resource'];parquet_ms=(time.perf_counter()-started)*1000
            started=time.perf_counter();expected=pd.read_csv(path,dtype_backend='numpy_nullable',dtype={'id':'string','code':'string','Age':'Float64'},parse_dates=['day'],float_precision='round_trip');reference_ms=(time.perf_counter()-started)*1000
            started=time.perf_counter();actual=ctx.dataset_exchange.dataframe(handle['resource_id'],handle['revision']);frame_ms=(time.perf_counter()-started)*1000
            pd.testing.assert_frame_equal(actual,expected)
            sql=ctx.datasets.query(identifier,'SELECT AVG(Age) FROM dados')['rows'][0][0]
            assert math.isclose(sql,float(actual.Age.mean()))
            actual['Age']=actual.Age.fillna(actual.Age.mean());assert not actual.Age.isna().any()
            actual.groupby('flag').amount.sum();actual.amount.sum();actual.dropna()
            return {'records':records,'pandas':pd.__version__,'legacy_import_ms':round(legacy_ms,2),'typed_import_ms':round(typed_ms,2),'typed_parquet_ms':round(parquet_ms,2),'pandas_reference_ms':round(reference_ms,2),'typed_dataframe_ms':round(frame_ms,2),'equal_to_pandas':True,'dtypes':{name:str(dtype) for name,dtype in actual.dtypes.items()}}
        finally:app.close()

if __name__=='__main__':
    samples=[measure(int(value)) for value in sys.argv[1:]] if len(sys.argv)>1 else [measure(n) for n in (1000,10000,100000,1000000)]
    print(json.dumps(samples,indent=2))

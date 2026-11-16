"""CSV schema must agree across persistent tables, SQL, Arrow and Pandas."""
import io
import json
from pathlib import Path
import pandas as pd
import pytest
from apps.data.services.store import Datasets
from apps.data.services.inference import infer

@pytest.fixture
def store(tmp_path):
    (tmp_path/'.veladata').mkdir();value=Datasets(tmp_path);value.initialize();return value

def load(store,tmp_path,text,**opts):
    path=tmp_path/'source.csv';path.write_text(text,encoding='utf-8')
    identifier=store.import_files([path],encoding='auto',infer_types=True,import_options=opts)['id']
    return identifier,path

@pytest.mark.parametrize('text,kind,expected',[
 ('value,other\n1,a\n,b\n3,c\n','decimal',[1.0,None,3.0]),
 ('value\n1.25\n-2.5\n3.0\n','decimal',[1.25,-2.5,3.0]),
 ('value\n-1\n0\n2\n','integer',[-1,0,2]),
 ('value,other\ntrue,a\nfalse,b\n,c\n','boolean',[True,False,None]),
 ('value\n2024-01-02\n2024-02-03\n','date',['2024-01-02','2024-02-03']),
 ('value,other\n,a\nNA,b\nNULL,c\n','text',[None,None,None]),
 ('value\n1\ntext\n2\n','text',['1','text','2']),
 ('value\n00123\n00456\n','text',['00123','00456']),
])
def test_inference_and_sql_keep_native_scalars(store,tmp_path,text,kind,expected):
    identifier,path=load(store,tmp_path,text)
    assert store.import_schema(identifier)['schema'][0]['kind']==kind
    assert [row[0] for row in store.page(identifier,0,0)['rows']]==expected
    assert [row[0] for row in store.query(identifier,'SELECT value FROM dados')['rows']]==expected
    reopened=Datasets(tmp_path);reopened.initialize()
    assert reopened.import_schema(identifier)==store.import_schema(identifier)
    assert reopened.page(identifier,0,0)['rows']==store.page(identifier,0,0)['rows']
    stream=io.StringIO();store.write_csv(identifier,stream)
    assert list(__import__('csv').reader(io.StringIO(stream.getvalue())))==list(__import__('csv').reader(io.StringIO(text)))


def test_locale_header_and_identifier_overrides(store,tmp_path):
    identifier,_=load(store,tmp_path,'relatório\nCEP;amount;day\n00123;1.234,50;31/01/2024\n00456;-12,25;01/02/2024\n',header=2,decimal=',',thousands='.',date_format='%d/%m/%Y')
    assert store.page(identifier,0,0)['rows']==[['00123',1234.5,'2024-01-31'],['00456',-12.25,'2024-02-01']]
    assert store.query(identifier,'SELECT SUM(amount) FROM dados')['rows']==[[1222.25]]
    profile=infer([tmp_path/'source.csv'],{'header':2,'decimal':',','thousands':'.','date_format':'%d/%m/%Y','types':{'amount':'text'}})
    assert profile['rows'][0][1]=='1.234,50'


def test_invalid_override_is_reported_and_transaction_is_not_created(store,tmp_path):
    path=tmp_path/'bad.csv';path.write_text('number\n1\nbad\n')
    preview=infer([path],{'types':{'number':'integer'}})
    assert preview['errors'][0]['value']=='bad'
    with pytest.raises(ValueError,match='Conversões inválidas'):
        store.import_files([path],infer_types=True,import_options={'types':{'number':'integer'}})
    assert store.list()==[]


def test_legacy_table_is_not_silently_retyped(store,tmp_path):
    path=tmp_path/'legacy.csv';path.write_text('Age\n20\n31\n')
    identifier=store.import_files([path])['id']
    store.initialize()
    assert store.import_schema(identifier) is None
    assert store.page(identifier,0,0)['rows']==[['20'],['31']]



def test_arrow_dictionary_encoded_categorical_values_preserve_logical_types():
    import pyarrow as pa
    from apps.data.services.inference import from_arrow

    schema = pa.schema([
        pa.field("Sex", pa.dictionary(pa.int8(), pa.string())),
        pa.field("Embarked", pa.dictionary(pa.int16(), pa.large_string())),
        pa.field("Pclass", pa.dictionary(pa.int8(), pa.int64())),
        pa.field("Age", pa.float64()),
    ])
    profile = from_arrow(schema)
    assert [field["kind"] for field in profile["schema"]] == [
        "text", "text", "integer", "decimal"
    ]
    assert profile["options"]["native"] is True
    with pytest.raises(ValueError, match="Tipo Arrow não suportado"):
        from_arrow(pa.schema([("nested", pa.list_(pa.int32()))]))


def test_arrow_dataframe_matches_same_pandas_version_and_options(tmp_path):
    from config.wsgi import create_app
    from config.composition import get_context
    from shared.services.preferences_service import Config
    app=create_app(Config(tmp_path/'workspace'));ctx=get_context()
    try:
        identifier,path=load(ctx.datasets,tmp_path,'Age,price,flag,day,CEP,group,mixed,empty\n20,1.25,true,2024-01-01,00123,A,1,\n,2.50,false,2024-01-02,00456,A,x,\n31,-3.75,,2024-01-03,00789,B,2,\n')
        snapshot=ctx.dataset_exchange.snapshot(identifier)['resource']
        assert snapshot['media_type']=='application/vnd.apache.parquet'
        actual=ctx.dataset_exchange.dataframe(snapshot['resource_id'],snapshot['revision'])
        expected=pd.read_csv(path,dtype_backend='numpy_nullable',dtype={'Age':'Float64','CEP':'string','mixed':'string','empty':'string'},parse_dates=['day'])
        pd.testing.assert_frame_equal(actual,expected,check_like=False)
        assert str(actual.Age.dtype)=='Float64' and actual.Age.isna().sum()==1
        actual['Age']=actual.Age.fillna(actual.Age.mean())
        assert actual.Age.tolist()==[20.0,25.5,31.0]
        assert actual.groupby('group').Age.sum().loc['A']==45.5
        assert actual.price.sum()==0.0 and len(actual.dropna(subset=['flag']))==2
        published=ctx.dataset_exchange.publish_frame(actual,resource_id=snapshot['resource_id'],expected_revision=snapshot['revision'])
        before=ctx.dataset_exchange.snapshot(identifier,raw=True)['resource'];token=ctx.publications.token(identifier)
        ctx.publications.adopt(identifier,before,published,token)
        assert ctx.datasets.query(identifier,'SELECT SUM(Age) FROM dados')['rows']==[[76.5]]
        assert ctx.datasets.page(identifier,0,0)['rows'][1][0]==25.5
        unchanged=ctx.publications.token(identifier)
        assert ctx.datasets.edit_cell(identifier,2,0,'25.5')['changed'] is False
        assert ctx.publications.token(identifier)==unchanged
        ctx.datasets.undo(identifier)
        assert ctx.datasets.page(identifier,0,0)['rows'][1][0] is None
    finally:app.close()


def test_schema_review_is_explicit_atomic_and_undoable(tmp_path):
    from config.wsgi import create_app
    from config.composition import get_context
    from shared.services.preferences_service import Config
    from shared.contracts.errors import RevisionConflict
    app=create_app(Config(tmp_path/'workspace'));ctx=get_context()
    try:
        path=tmp_path/'old.csv';path.write_text('Age,name\n20,A\n,B\n31,C\n')
        identifier=ctx.datasets.import_files([path])['id']
        staged=ctx.dataset_imports.review(identifier)
        assert ctx.datasets.import_schema(identifier) is None
        ctx.dataset_imports.commit(staged['token'])
        assert ctx.datasets.page(identifier,0,0)['rows'][1][0] is None
        ctx.datasets.undo(identifier)
        assert ctx.datasets.import_schema(identifier) is None
        ctx.datasets.undo(identifier,redo=True)
        assert ctx.datasets.import_schema(identifier)['schema'][0]['dtype']=='Float64'
        stale=ctx.dataset_imports.review(identifier)
        ctx.datasets.edit_cell(identifier,1,0,'21')
        with pytest.raises(RevisionConflict):ctx.dataset_imports.commit(stale['token'])
    finally:app.close()


def test_real_notebook_cells_and_sql_share_nullable_frame(tmp_path):
    import os
    if os.name!='nt':
        import zmq
        context=zmq.Context();socket=context.socket(zmq.REP)
        try:
            try:socket.bind('ipc://'+str(tmp_path/'probe'))
            except zmq.ZMQError as error:
                if error.errno in (1,13):pytest.skip('Host blocks IPC; native CI executes this kernel test')
                raise
        finally:socket.close(linger=0);context.term()
    from config.wsgi import create_app
    from config.composition import get_context
    from shared.services.preferences_service import Config
    app=create_app(Config(tmp_path/'workspace'));ctx=get_context()
    try:
        identifier,_=load(ctx.datasets,tmp_path,'Age,group\n20,A\n,A\n31,B\n')
        assert ctx.notebooks.open(identifier)['returncode']==0
        changed=ctx.notebooks.execute(identifier,"assert str(df.Age.dtype)=='Float64'\ndf['Age']=df.Age.fillna(df.Age.mean())\nanswer=17")
        assert changed['returncode']==0
        assert ctx.notebooks.execute(identifier,'print(df.Age.sum(),answer)')['output'].strip()=='76.5 17'
        sql=ctx.notebooks.execute(identifier,'SELECT SUM(Age) AS total FROM dados','sql')
        assert sql['returncode']==0 and '76.5' in sql['output']
        assert ctx.datasets.cell(identifier,2,0)['value']==''
        ctx.notebooks.publish(identifier)
        assert ctx.datasets.query(identifier,'SELECT SUM(Age) FROM dados')['rows']==[[76.5]]
    finally:app.close()


def test_generated_kernel_loader_preserves_schema_without_csv_reinference(tmp_path,monkeypatch):
    from config.wsgi import create_app
    from config.composition import get_context
    from shared.services.preferences_service import Config
    app=create_app(Config(tmp_path/'workspace'));ctx=get_context();namespace={}
    try:
        identifier,_=load(ctx.datasets,tmp_path,'Age,CEP\n20,00123\n,00456\n31,00789\n')
        def execute(project,code):
            exec(compile(code,'<kernel-loader>','exec'),namespace)
            return {'returncode':0,'output':'loaded'}
        monkeypatch.setattr(ctx.kernels,'execute',execute)
        assert ctx.notebooks.open(identifier)['returncode']==0
        assert str(namespace['df'].Age.dtype)=='Float64'
        assert namespace['df'].CEP.tolist()==['00123','00456','00789']
        namespace['df']['Age']=namespace['df'].Age.fillna(namespace['df'].Age.mean())
        assert namespace['df'].Age.tolist()==[20.0,25.5,31.0]
    finally:app.close()


def test_typed_exports_preserve_numbers_nulls_booleans_and_identifiers(store,tmp_path):
    from apps.data.services.interchange import export_file
    from openpyxl import load_workbook
    identifier,_=load(store,tmp_path,'Age,amount,active,CEP,day\n20,1.5,true,00123,2024-01-01\n,-2.5,false,00456,\n')
    parquet=tmp_path/'typed.parquet';export_file(store,identifier,parquet)
    actual=pd.read_parquet(parquet,dtype_backend='numpy_nullable')
    assert str(actual.Age.dtype)=='Float64' and actual.Age.isna().tolist()==[False,True]
    assert actual.amount.tolist()==[1.5,-2.5]
    assert actual.active.tolist()==[True,False] and actual.CEP.tolist()==['00123','00456']
    xlsx=tmp_path/'typed.xlsx';export_file(store,identifier,xlsx)
    book=load_workbook(xlsx,read_only=True)
    try:
        rows=list(book.active.values)
        assert rows[1][:4]==(20,1.5,True,'00123') and rows[2][0] is None
    finally:book.close()
    from apps.data.services.interchange import import_files
    restored=import_files(store,[xlsx])
    assert restored["row_count"]==2
    assert len(store.page(restored["id"],0,0)["rows"][1])==5


def test_append_reordered_columns_validates_schema_by_name(store,tmp_path):
    identifier,_=load(store,tmp_path,'id;ano;nome\n001;2023;Ana\n')
    second=tmp_path/'second.csv';second.write_text('ano;nome;id\n2024;Bia;002\n')
    result=store.import_files([second],identifier,encoding='auto',infer_types=True)
    assert result['added']==1
    assert store.page(identifier,0,0)['rows']==[['001',2023,'Ana'],['002',2024,'Bia']]


def test_inferred_and_explicit_types_remain_distinct_after_undo(store,tmp_path):
    identifier,_=load(store,tmp_path,'id,value\n001,10\n002,20\n')
    original=store.page(identifier,0,0)
    assert original['types']['columns']['0']=='text'
    assert original['types']['explicit_columns']=={}
    store.set_type(identifier,'column',0,'text')
    assert store.page(identifier,0,0)['types']['explicit_columns']=={'0':'text'}
    store.undo(identifier)
    assert store.page(identifier,0,0)['types']['explicit_columns']=={}
    assert store.page(identifier,0,0)['schema']==original['schema']

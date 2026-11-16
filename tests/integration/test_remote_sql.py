"""Real PostgreSQL/MySQL services in CI; no user credentials are required."""
import os
import sys
import pytest
from apps.code.services.python_envs import PythonEnvironments
from apps.code.services.remote_sql import query

@pytest.mark.parametrize('kind,port',[('postgresql',5432),('mysql',3306)])
def test_real_remote_database_readonly_preview(tmp_path,monkeypatch,kind,port):
    if not os.environ.get('OPEN_DOC_DATABASE_CI'):
        pytest.skip('Requires the database CI services')
    monkeypatch.setattr(PythonEnvironments,'interpreter',lambda *args:sys.executable)
    connection={'kind':kind,'host':'127.0.0.1','port':port,'database':'opendoc','username':'opendoc','password':'opendoc-test','sslmode':'disable'}
    result=query(tmp_path,'project',connection,'SELECT 42 AS answer')
    assert result['columns']==['answer'] and result['rows']==[['42']]
    sql='SELECT generate_series(1,150) AS value' if kind=='postgresql' else 'WITH RECURSIVE sequence AS (SELECT 1 AS value UNION ALL SELECT value+1 FROM sequence WHERE value<150) SELECT value FROM sequence'
    assert query(tmp_path,'project',connection,sql)['truncated'] is True
    with pytest.raises(ValueError,match='permissões'):
        query(tmp_path,'project',connection,'CREATE TABLE forbidden_write (value INTEGER)')

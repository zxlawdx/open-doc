import json
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from apps.data.services.store import Datasets
from apps.code.services import local_runtime
from apps.code.services.notebook import NotebookService


def test_empty_program_and_transactional_delete(tmp_path):
    (tmp_path/'.veladata').mkdir()
    store=Datasets(tmp_path); store.initialize()
    project=store.create('Programa de análise')
    assert store.page(project['id'],0,0)['rows']==[]
    source=tmp_path/'t.csv';source.write_text('a,b\n1,2\n')
    dataset=store.import_files([source])
    store.edit_cell(dataset['id'],1,0,'3')
    store.delete(dataset['id'])
    assert [x['id'] for x in store.list()]==[project['id']]
    with pytest.raises(ValueError):store.page(dataset['id'],0,0)


def test_windows_children_always_hide_console_and_preserve_flags(monkeypatch):
    monkeypatch.setattr(sys,'platform','win32')
    assert local_runtime.hidden_process_options(0x200)['creationflags']==0x08000200


def test_pip_cell_uses_project_environment_without_opening_dataframe(tmp_path):
    manager=Mock();manager.install.return_value={'installed':['pandas'],'log':'ok'}
    context=SimpleNamespace(config=SimpleNamespace(root=tmp_path),code_tools=SimpleNamespace(environments=lambda root:manager,clear_analysis_cache=Mock()))
    service=NotebookService(context);service.stop=Mock();service.open=Mock(side_effect=AssertionError('must not require pandas before installing'))
    result=service.execute('project','!pip install pandas')
    manager.install.assert_called_once_with('project',['pandas'],confirm=True)
    assert result['returncode']==0 and 'pandas' in result['output']
    service.stop.assert_not_called()
    with pytest.raises(ValueError):service.execute('project','!pip uninstall pandas')


def test_frozen_completion_analyzes_project_pandas_without_executing_code(tmp_path,monkeypatch):
    from apps.code.services.python_analysis import analyze
    from apps.code.services.python_envs import PythonEnvironments
    import shared.contracts.workspace as contract
    marker=tmp_path/'executed'
    monkeypatch.setattr(contract,'workspace',lambda:SimpleNamespace(config=SimpleNamespace(root=tmp_path)))
    monkeypatch.setattr(PythonEnvironments,'interpreter',lambda *args:sys.executable)
    monkeypatch.setattr(sys,'frozen',True,raising=False)
    code=f"import pandas as pd\nfrom pathlib import Path\nPath({str(marker)!r}).touch()\npd.Dat"
    result=analyze(code,4,6,'complete','project')
    assert 'DataFrame' in {x['label'] for x in result['items']}
    assert not marker.exists()


def test_remote_sql_validates_target_before_spawning(tmp_path):
    from apps.code.services.remote_sql import query
    with pytest.raises(ValueError,match='PostgreSQL'):
        query(tmp_path,'bad',{'kind':'unknown'},'SELECT 1')
    with pytest.raises(ValueError,match='host'):
        query(tmp_path,'bad',{'kind':'postgresql'},'SELECT 1')

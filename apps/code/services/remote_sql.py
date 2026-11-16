"""Bounded remote SQL through drivers installed in the project's Python."""
import json
import subprocess
import textwrap
from .local_runtime import run_external
from .python_envs import PythonEnvironments


def query(workspace, project, connection, sql):
    if not isinstance(sql, str) or not sql.strip() or len(sql) > 12000:
        raise ValueError('Informe uma consulta de até 12 mil caracteres.')
    if not isinstance(connection, dict) or connection.get('kind') not in ('postgresql', 'mysql'):
        raise ValueError('Selecione PostgreSQL ou MySQL.')
    for key in ('host', 'database', 'username'):
        if not isinstance(connection.get(key), str) or not connection[key].strip() or len(connection[key]) > 300:
            raise ValueError('Preencha host, banco e usuário.')
    port = int(connection.get('port') or (5432 if connection['kind']=='postgresql' else 3306))
    if not 1 <= port <= 65535: raise ValueError('Porta inválida.')
    python = PythonEnvironments(workspace).interpreter(project)
    if python is None: raise ValueError('Prepare o ambiente do projeto e instale sqlalchemy e o driver do banco.')
    payload = {**connection, 'port':port, 'sql':sql}
    script = textwrap.dedent('''
        import json,sys,ssl,math
        from datetime import date,datetime
        from decimal import Decimal
        from sqlalchemy import create_engine
        from sqlalchemy.engine import URL
        data=json.load(sys.stdin)
        driver='postgresql+psycopg' if data['kind']=='postgresql' else 'mysql+pymysql'
        args={'connect_timeout':10}
        if data['kind']=='postgresql': args['sslmode']=data.get('sslmode','require')
        else:
            args.update(read_timeout=30,write_timeout=30)
            if data.get('sslmode','require')!='disable': args['ssl']=ssl.create_default_context()
        url=URL.create(driver,username=data['username'],password=data.get('password',''),host=data['host'],port=data['port'],database=data['database'])
        engine=create_engine(url,connect_args=args,pool_pre_ping=True)
        try:
            with engine.connect() as conn:
                if data['kind']=='postgresql':
                    conn.exec_driver_sql('SET TRANSACTION READ ONLY')
                    conn.exec_driver_sql("SET LOCAL statement_timeout = '30000'")
                else: conn.exec_driver_sql('START TRANSACTION READ ONLY')
                result=conn.execution_options(stream_results=True,max_row_buffer=101).exec_driver_sql(data['sql'])
                columns=list(result.keys())
                if len(columns)>200: raise ValueError('Too many columns')
                rows=[]; size=0; truncated=False; types={}
                def scalar(value,name):
                    if value is None:return None
                    types.setdefault(name,type(value).__name__)
                    if isinstance(value,(bool,int)):return value
                    if isinstance(value,float):
                        if not math.isfinite(value):raise ValueError('Non-finite result')
                        return value
                    if isinstance(value,(date,datetime)):return value.isoformat()
                    if isinstance(value,Decimal):return str(value)
                    if isinstance(value,bytes):return value.hex()
                    return str(value)[:4096]
                for index,row in enumerate(result):
                    if index>=100: truncated=True; break
                    values=[scalar(x,name) for name,x in zip(columns,row)]
                    size+=len(json.dumps(values).encode())
                    if size>1024*1024: truncated=True; break
                    rows.append(values)
                answer={'columns':columns,'rows':rows,'types':types,'truncated':truncated}
                conn.rollback()
            print(json.dumps(answer))
        except Exception:
            print(json.dumps({'error':'Falha na conexão ou consulta. Verifique endereço, credenciais, TLS e permissões de leitura.'}))
        finally: engine.dispose()
    ''')
    try:
        result = run_external([str(python), '-I', '-c', script], input=json.dumps(payload),
                              capture_output=True, text=True, timeout=40)
    except subprocess.TimeoutExpired as error:
        raise ValueError('A conexão ou consulta excedeu 40 segundos.') from error
    if result.returncode:
        raise ValueError('Instale sqlalchemy e psycopg[binary] (PostgreSQL) ou pymysql (MySQL) neste projeto.')
    data = json.loads(result.stdout)
    if data.get('error'): raise ValueError(data['error'])
    return data

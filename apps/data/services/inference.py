"""Lossless, bounded-memory CSV inference and scalar reconstruction."""
import math
import re
from datetime import datetime
from pathlib import Path
from shared.utils.tabular import delimited

NULLS = frozenset(('', 'NA', 'N/A', 'NULL', 'null', 'NaN', 'nan', 'None', '<NA>', '#N/A', '-NaN', '-nan'))
INTEGER = re.compile(r'^[+-]?\d+$')
ISO_DATE = re.compile(r'\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?')
NUMBER = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$')
KINDS = {'auto', 'text', 'integer', 'decimal', 'boolean', 'date', 'datetime'}
DTYPES = {'text':'string','integer':'Int64','decimal':'Float64','boolean':'boolean','date':'datetime64[ns]','datetime':'datetime64[ns]'}


def options(value=None):
    result = {'encoding':'auto','delimiter':'auto','decimal':'auto','thousands':'', 'header':1,'date_format':'iso','types':{}}
    result.update(value or {})
    if result['encoding'] not in ('auto','utf-8-sig','utf-8','utf-16','cp1252','latin-1'):
        raise ValueError('Encoding inválido.')
    if result['delimiter'] not in ('auto',',',';','\t','|') or result['decimal'] not in ('auto','.',',') or result['thousands'] not in ('','.',',',' '):
        raise ValueError('Separadores inválidos.')
    if result['thousands'] and result['thousands']==result['decimal']:
        raise ValueError('Decimal e milhares devem ser diferentes.')
    if type(result['header']) is not int or not 1<=result['header']<=10000:
        raise ValueError('Linha de cabeçalho inválida.')
    if result['date_format'] not in ('iso','%d/%m/%Y','%m/%d/%Y'):
        raise ValueError('Formato de data inválido.')
    if not isinstance(result['types'],dict) or any(kind not in KINDS for kind in result['types'].values()):
        raise ValueError('Tipos de coluna inválidos.')
    return result


def identifier(name):
    return name.casefold() in {'id','cpf','cnpj','cep','zip','telefone','phone'} or name.endswith(('Id','ID','_id')) or name.casefold().startswith('id_') or any(x in name.casefold() for x in ('codigo','código','postal','sku'))


def normalized_number(token, config):
    token=token.strip()
    if config['thousands']:token=token.replace(config['thousands'],'')
    if config['decimal']==',' or (config['decimal']=='auto' and ',' in token and '.' not in token):token=token.replace(',','.')
    if not NUMBER.fullmatch(token):raise ValueError('Número inválido')
    return token


def numeric(token, config):
    token=normalized_number(token,config)
    if INTEGER.fullmatch(token):
        if len(token)>21:raise ValueError('Inteiro fora do intervalo')
        return int(token)
    value=float(token)
    if not math.isfinite(value):raise ValueError('Número não finito')
    return value


def date_value(token, config):
    if config['date_format']=='iso':
        if not ISO_DATE.fullmatch(token):raise ValueError('Data ISO inválida')
        value=datetime.fromisoformat(token)
    else:value=datetime.strptime(token,config['date_format'])
    if not 1678<=value.year<=2261:raise ValueError('Data fora do intervalo datetime64[ns]')
    return value


def parse(value, field, config):
    if value is None:return None
    if not isinstance(value,str):return value
    if value in NULLS and not config.get('native',False):return None
    if value=='' and field['kind']!='text':return None
    kind=field['kind']
    if kind=='text':return value
    if kind=='boolean':
        if value.strip().casefold() not in ('true','false'):raise ValueError('Booleano inválido')
        return value.strip().casefold()=='true'
    if kind in ('date','datetime'):
        parsed=date_value(value.strip(),config)
        return parsed.date().isoformat() if kind=='date' else parsed.isoformat()
    number=numeric(value,config)
    if kind=='integer':
        if number!=int(number) or not -(2**63)<=number<2**63:raise ValueError('Inteiro inválido')
        return int(number)
    result=float(number)
    if not math.isfinite(result):raise ValueError('Decimal fora do intervalo')
    return result


def infer(paths, config=None, *, limit=None):
    config=options(config); names=None; stats=[]; sample=[]; errors=[]; count=0
    for path in map(Path,paths):
        with delimited(path,config['encoding'],config['delimiter'],header_row=config['header']) as (header,reader):
            if names is None:
                names=header;stats=[{'seen':set(),'missing':0,'leading':False,'large':False,'identifier':identifier(name)} for name in names]
            if set(header)!=set(names):raise ValueError('As colunas dos arquivos não correspondem.')
            order=[header.index(name) for name in names]
            for row in reader:
                if not row:continue
                if len(row)!=len(header):raise ValueError(f'{path.name}: registro com número de campos incorreto na linha {reader.line_num}.')
                values=[row[index] for index in order];count+=1
                if len(sample)<20:sample.append(values)
                for index,value in enumerate(values):
                    state=stats[index]
                    if value in NULLS:state['missing']+=1;continue
                    token=value.strip(); category='text'
                    if state['identifier'] and config['types'].get(names[index],'auto')=='auto':
                        state['seen'].add('text');continue
                    if token.casefold() in ('true','false'):category='boolean'
                    else:
                        try:
                            number=numeric(token,config)
                            normalized=token.replace(config['thousands'],'') if config['thousands'] else token
                            category='decimal' if any(x in normalized.lower() for x in ('.',',','e')) else 'integer'
                            state['leading'] |= bool(re.match(r'^[+-]?0\d',token))
                            state['large'] |= abs(number)>2**53
                            if not -(2**63)<=number<2**63 or not math.isfinite(float(number)):category='text'
                        except (ValueError,OverflowError):
                            try:date_value(token,config);category='datetime' if 'T' in token or re.search(r'\d \d{2}:',token) else 'date'
                            except ValueError:pass
                    state['seen'].add(category)
                    override=config['types'].get(names[index],'auto')
                    if override not in ('auto','text'):
                        try:parse(value,{'kind':override},config)
                        except ValueError:
                            if len(errors)<20:errors.append({'row':count,'line':reader.line_num+config['header']-1,'column':names[index],'value':value[:120],'type':override})
                if limit and count>=limit:break
        if limit and count>=limit:break
    if names is None:raise ValueError('Selecione um arquivo CSV.')
    schema=[]
    for name,state in zip(names,stats):
        seen=state['seen']; mixed=len(seen)>1 and not (seen<= {'integer','decimal'} or seen<= {'date','datetime'})
        kind=next(iter(seen)) if len(seen)==1 else 'decimal' if seen and seen<= {'integer','decimal'} else 'datetime' if seen and seen<= {'date','datetime'} else 'text'
        protected=identifier(name) or state['leading'] or (state['large'] and (state['missing'] or 'decimal' in seen))
        if protected:kind='text'
        if kind=='integer' and state['missing']:kind='decimal'  # mean/fillna compatibility
        override=config['types'].get(name,'auto')
        if override!='auto':kind=override
        schema.append({'name':name,'kind':kind,'dtype':DTYPES[kind],'nullable':True,'missing':state['missing'],'mixed':mixed,'identifier':bool(protected),'inferred':override=='auto'})
    rows=[]
    for row in sample:
        converted=[]
        for value,field in zip(row,schema):
            try:converted.append(parse(value,field,config))
            except ValueError:converted.append(value)  # preview reports errors; import rejects them
        rows.append(converted)
    return {'columns':names,'schema':schema,'rows':rows,'row_count':count,'errors':errors,'options':config,'sampled':limit is not None}


def from_arrow(arrow_schema):
    import pyarrow as pa
    fields=[]
    for field in arrow_schema:
        # Pandas categorical columns are Parquet/Arrow dictionary-encoded.
        # The dictionary index (often int8) is not the column's logical type:
        # classify its values, not the compression representation.
        value_type = field.type
        while pa.types.is_dictionary(value_type):
            value_type = value_type.value_type
        kind = ('integer' if pa.types.is_integer(value_type) else 'decimal' if pa.types.is_floating(value_type) or pa.types.is_decimal(value_type)
                else 'boolean' if pa.types.is_boolean(value_type) else 'date' if pa.types.is_date(value_type) else 'datetime' if pa.types.is_timestamp(value_type) else 'text')
        if not (kind!='text' or pa.types.is_string(value_type) or pa.types.is_large_string(value_type) or pa.types.is_null(value_type)):
            raise ValueError('Tipo Arrow não suportado na tabela: '+str(field.type))
        fields.append({'name':field.name,'kind':kind,'dtype':DTYPES[kind],'nullable':True,'inferred':False})
    return {'schema':fields,'options':{**options(),'encoding':'utf-8-sig','delimiter':',','decimal':'.','native':True}}

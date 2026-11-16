"""User-confirmed import previews with bounded, application-owned file tokens."""
import json
import tempfile
from pathlib import Path
from threading import RLock
from uuid import uuid4
from .inference import infer, options
from . import history
from shared.contracts.errors import RevisionConflict


class ImportSessions:
    def __init__(self, context):
        self.context=context;self._pending={};self._lock=RLock()

    def stage(self, paths, identifier=None, config=None, *, temporary=None, review=False, version=None):
        paths=[Path(path).resolve() for path in paths]
        if not paths or any(path.suffix.lower() not in ('.csv','.tsv') for path in paths):
            raise ValueError('A prévia configurável aceita CSV/TSV.')
        with self._lock:
            while len(self._pending)>=4:
                token=next(iter(self._pending));self.cancel(token)
            token=uuid4().hex
            self._pending[token]={'paths':paths,'id':identifier,'options':options(config),'temporary':temporary,'review':review,
                                  'version':version if review else self.context.publications.token(identifier) if identifier else None}
        return self.preview(token)

    def preview(self, token, config=None):
        with self._lock:
            item=self._pending.get(token)
            if item is None:raise ValueError('Prévia expirada. Selecione o arquivo novamente.')
            if config is not None:item['options']=options(config)
            try:result=infer(item['paths'],item['options'],limit=500)
            except (ValueError,UnicodeError) as error:
                with item['paths'][0].open('rb') as stream: raw=stream.read(16384).decode('utf-8',errors='replace')
                result={'columns':[],'schema':[],'rows':[],'row_count':0,'errors':[{'row':0,'column':'Arquivo','value':str(error)}],'options':item['options'],'sampled':True,'raw_lines':raw.splitlines()[:20]}
            return {**result,'token':token,'files':[p.name for p in item['paths']],'review':item['review']}

    def review(self, identifier):
        version=self.context.publications.token(identifier)
        temporary=tempfile.TemporaryDirectory(prefix='opendoc-type-review-')
        path=Path(temporary.name)/'dataset.csv'
        with path.open('w',encoding='utf-8-sig',newline='') as stream:
            self.context.datasets.write_csv(identifier,stream)
        return self.stage([path],identifier,{'encoding':'utf-8-sig'},temporary=temporary,review=True,version=version)

    def commit(self, token):
        with self._lock:
            item=self._pending.get(token)
            if item is None:raise ValueError('Prévia expirada.')
            store=self.context.datasets
            if item['review']:
                profile=infer(item['paths'],item['options'])
                if profile['errors']:raise ValueError('Conversões inválidas: '+json.dumps(profile['errors'],ensure_ascii=False))
                with store.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    if self.context.publications.token(item['id'],db)!=item['version']:
                        raise RevisionConflict('O dataset mudou durante a prévia. Revise os tipos novamente.')
                    before=store.import_schema(item['id'],db)
                    after={'schema':profile['schema'],'options':profile['options']}
                    history.apply_patch(db,item['id'],{'import_schema':after})
                    history.remember(db,item['id'],'import-schema',{'import_schema':before},{'import_schema':after})
                result={'id':item['id'],'added':0,'row_count':profile['row_count'],'schema':profile['schema'],'reviewed':True}
            else:
                config=item['options']
                result=self.context.data_tools.import_files(store,item['paths'],item['id'],encoding=config['encoding'],delimiter=config['delimiter'],infer_types=True,import_options=config)
            self.cancel(token)
            return result

    def cancel(self, token):
        with self._lock:
            item=self._pending.pop(token,None)
            if item and item['temporary']:item['temporary'].cleanup()
        return {'cancelled':True}

    def close(self):
        for token in list(self._pending):self.cancel(token)

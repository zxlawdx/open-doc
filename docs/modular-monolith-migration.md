# Migração incremental para aplicações Vela

Este PR é uma etapa funcional, não a arquitetura final solicitada. Não deve ser
mesclado como conclusão da migração completa.

## Estado implementado

| Local | Responsabilidade efetivamente extraída |
| --- | --- |
| `config/wsgi.py` | Um VelaApp; registro oficial de Open Doc legado, Dados e Código |
| `config/composition.py` | Construção de dependências e publicação do contexto apenas após inicialização |
| `config/bridge.py` | Bridge nativa; aliases antigos preservam imports existentes |
| `apps/data/app.py` | AppConfig de Dados, com serviços e rotas próprias |
| `apps/data/services/` | Tabelas SQLite, conversões, histórico, snapshots de planilha e intercâmbio de recursos |
| `apps/code/app.py` | AppConfig de Código, com análise Python, execução e ambientes por projeto |
| `shared/contracts/` | Acesso ao workspace e interfaces de ferramentas injetadas pela composição |
| `shared/services/workspace.py` | Persistência de sessão com abas/referências, configurações e estado por módulo |
| `shared/services/http.py` | Validação de sessão e tratamento de erros HTTP compartilhados |
| `shared/utils/tabular.py` | Leitura delimitada e conversão escalar reutilizáveis |
| `tests/integration/` | Recursos, DataFrames, sessão persistente e subprocessos Python |

URLs existentes, modelos de arquivos, templates e assets visuais foram mantidos.
Não há cópia do ResourceStore no Open Doc. O Vela está fixado em uma revisão Git
reproduzível em requirements.txt. O diretório de recursos pertence ao workspace,
com ciclo de vida gerenciado pelo único VelaApp.

## Integração disponível

`POST /api/open_doc/dataset`, com a sessão existente e operação
`resource-snapshot`, recebe o ID de uma tabela e devolve apenas metadados de um
snapshot nativo. A exportação usa um arquivo temporário e leitura incremental,
sem materializar a tabela inteira em JSON.

No backend, `context.dataset_exchange.dataframe(resource_id, revision)` retorna
um DataFrame e `publish_frame(frame, resource_id=..., expected_revision=...)`
publica explicitamente uma nova versão Parquet. A versão original e a tabela
SQLite permanecem isoladas. A adoção da nova versão pela tabela visível ainda
precisa de implementação; não existe sincronização implícita.

Pandas e PyArrow são opcionais no processo hospedeiro. Instale os extras
`tabular` da revisão fixada do Vela para utilizar essas operações. Bibliotecas
instaladas nos ambientes de projeto não são automaticamente instaladas no host.

`POST /api/open_doc/workspace`, também autenticado pelo token de sessão, suporta
`load` e `save`. O salvamento exige `expected_revision`, `tabs`, `settings` e
`modules`. Recursos são referenciados por ID/revisão; aplicações precisam estar
registradas. A publicação usa controle de concorrência do Vela e emite apenas
metadados no EventBus. A ligação desse endpoint ao estado de abas da interface
legada continua pendente.

## Python local e runtime empacotado

A criação de processos externos remove PYTHONHOME/PYTHONPATH e variáveis internas
do empacotamento, restaura LD_LIBRARY_PATH quando aplicável e filtra o diretório
embutido do PATH. No Windows empacotado, o diretório de busca de DLLs é restaurado
após o spawn, inclusive quando ele falha. Um Python externo é procurado no PATH;
o executável congelado do Open Doc não é usado como interpretador. Ambientes de
projeto existentes continuam preferenciais. A instalação requer ação explícita.

Testes executam subprocessos reais em Linux e simulam restauração da busca de
DLLs; isso não substitui validar a execução Python em um executável Windows real.
Análise Jedi no aplicativo congelado e kernels persistentes continuam pendentes.

## Validação e desempenho

Baseline após preparar assets: 402 testes Python aprovados, 2 ignorados.
A etapa de migração inclui novos testes de integração; a contagem final está no
PR. Os 314 testes frontend passaram sem alterações nos arquivos visuais.

Execute `PYTHONPATH=../vela:. python tools/benchmark_data_resources.py` para medir
1k, 10k, 100k e 1M registros. Resultados locais estão em
`docs/data-resource-benchmark-linux.json`. Com tracemalloc ligado, 1M registros:
importação SQLite ~13,65 s; snapshot CSV nativo ~8,69 s; pico de alocação Python
~2,11 MB. São etapas distintas, não uma comparação antes/depois ou benchmark da
interface. RSS, cache do sistema e bibliotecas nativas não são medidos.

Importação percorre O(n) registros, com inserções indexadas SQLite e batches de
até 1000 linhas/1 MiB. Snapshot percorre O(n) registros, com buffering limitado,
mas `write_analysis_csv` ainda carrega metadados de tipos por célula: o limite de
memória pode crescer O(t) com a quantidade de overrides. Materializar um DataFrame
continua O(n) em memória. Nenhuma promessa de zero-copy ou melhoria global de
performance é feita por esta etapa.

## Trabalho obrigatório ainda não concluído

- Extrair Home, Documentos, Planilhas, Apresentações, PDF e Templates do shell
  legado, incluindo suas interfaces/rotas e contratos. Remover apps/open_doc ao
  final, com cobertura de regressão.
- Completar convenções internas de views/models/templates/static por aplicação
  quando suas implementações forem migradas, sem criar diretórios decorativos.
- Ligar abas, sessões e configurações da interface ao workspace compartilhado.
- Publicar e adotar transformações do notebook na tabela por ação explícita;
  integrar SQL/Planilhas com os mesmos handles.
- Implementar kernels persistentes, gerenciamento de sessões, visualizações e
  execução de células com experiência equivalente ao escopo solicitado.
- Completar quotas/retenção, profiling de CPU/RSS/I/O/renderização/inicialização,
  benchmarks antes/depois e validação GUI/build Windows/Linux do Open Doc.
- Migrar o restante dos testes por categoria e eliminar aliases transitórios
  apenas depois de atualizar todos os consumidores.

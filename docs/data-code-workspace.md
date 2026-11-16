# Dados e Código: projetos e notebooks

Esta mudança parte do merge `2d5a3dc9`. A release existente continua disponível enquanto o PR é validado.

## Interface

A central contém atalhos coloridos para Documentos, Planilhas, Apresentações, PDF, Dados, Código e Templates. Cada aplicação registra sua rota pelo AppConfig (`/documents`, `/spreadsheets`, `/presentations`, `/pdf`, `/data`, `/code`, `/templates`). A renderização compartilhada pertence a `shared/services`, sem imports privados entre aplicações. O ciclo oficial de desmontagem aguarda as gravações de preferências, notebook e editor.

Dados permite criar programas Python independentes de datasets (ipykernel é suficiente; Pandas/Arrow só são necessários para DataFrames), importar tabelas e alternar projetos por abas. Cada projeto conserva suas células. A exclusão é confirmada na interface e remove tabela, fontes, tipos e histórico em uma transação SQLite; recursos previamente publicados e referenciados por Planilhas são preservados. Abas de recursos excluídos saem da sessão global.

O painel duplicado “Python local” fica fora da interface. As células do notebook são o ponto de edição Python; bibliotecas ficam em uma janela própria. Operações exibem progresso indeterminado e estado ocupado, sem inventar percentuais.

Filtros oferecem coluna, condição e valor. “Remover filtros” volta à tabela original. Condições: igual, contém, vazio/ausente e preenchido. Consultas geradas escapam identificadores/valores; não modificam a tabela original.

## Python e autocomplete

`!pip install pandas` e `%pip install pandas` instalam no ambiente do projeto. Até cinco especificações PyPI por comando, incluindo versões e extras, como `psycopg[binary]`. URLs e argumentos arbitrários de pip não são aceitos. A instalação é uma ação explícita do usuário; não ocorre ao abrir o app. A sessão existente é preservada e os caches de importação/análise são invalidados.

O autocomplete usa Jedi no Python do projeto dentro dos executáveis. O código analisado não é executado. `Ctrl+Espaço` solicita sugestões; `pd.Dat` sugere `DataFrame`. A superfície de texto ocupa a altura visual do editor, permitindo posicionar o cursor também na área vazia.

Os processos Windows são iniciados com `CREATE_NO_WINDOW`, preservando a restauração da busca de DLLs do aplicativo. O bootstrap também cobre filhos criados por venv/ensurepip, magics do IPython e ferramentas de análise. O smoke empacotado verifica `GetConsoleWindow()==0` no Python externo, kernel e subprocesso do kernel.

## SQL remoto

Na área SQL, selecione PostgreSQL ou MySQL/MariaDB e informe host, porta, database, usuário, senha e TLS. Instale os drivers no notebook:

```python
!pip install sqlalchemy psycopg[binary] pymysql
```

O seletor “Destino SQL” aplica-se ao editor SQL e às células SQL. Os drivers são opcionais e pertencem ao ambiente do projeto. As credenciais não são salvas em notebooks, recursos, preferências ou logs; o campo de senha é limpo ao trocar de projeto.

A conexão atual é de leitura: transação read-only imposta no servidor e rollback ao terminar. A prévia usa cursor/streaming, até 100 linhas, 200 colunas e 1 MiB de texto, com valores truncados a 4096 caracteres. Há timeout de conexão e limite de 40 segundos no processo. O botão “Voltar à prévia”/“Remover filtros” restaura os dados locais. Escrita remota e armazenamento de credenciais não fazem parte desta entrega.

## Validação

- Local: 421 testes Python aprovados, 7 skips de ambiente/plataforma/serviços externos; 325 testes frontend aprovados.
- Qt local: criação, alternância e preservação de dois programas, clique nativo na área vazia, autocomplete Pandas, filtro/remoção e exclusão passaram.
- O CI inclui o mesmo QA Qt em Windows/Linux, screenshots e smoke empacotado com autocomplete e ausência de console.
- Um job separado inicia PostgreSQL 16 e MySQL 8 e verifica consulta real, truncamento e rejeição de escrita. Os testes são pulados localmente quando os serviços não estão disponíveis; não são apresentados como aprovação local desses bancos.

O filtro local continua limitado a 100 resultados de consulta; navegação da tabela é paginada. A criação de projeto é O(1); exclusão é O(n + h), proporcional às linhas e metadados do projeto, sem carregar o dataset em Python. O custo de análise depende do código/bibliotecas; o worker possui timeout de 15 segundos. Não foi acrescentado um executor ou cache paralelo.

## Referências utilizadas

- Python subprocess/CREATE_NO_WINDOW: https://docs.python.org/3/library/subprocess.html
- IPython %pip no kernel atual: https://ipython.readthedocs.io/en/stable/interactive/magics.html
- CodeMirror completion sources/startCompletion: https://codemirror.net/docs/ref/
- SQLAlchemy streaming/yield_per: https://docs.sqlalchemy.org/en/20/core/connections.html
- Navegação entre aplicativos: https://support.microsoft.com/en-us/office/lifecycle/lc-account/get-started-with-my-microsoft-365-apps

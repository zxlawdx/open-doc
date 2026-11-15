# Correções e performance após a comparação visual

Baseline: `84f7f898`. Python utilizado: CPython 3.12.14. As três amostras por
escala foram executadas sequencialmente no mesmo executor, sem cProfile ou
tracemalloc durante a medição. Dados brutos: `hot-paths-before-after.json`.

| Operação em 1 milhão de registros | Mediana antes | Mediana depois |
| --- | --- | --- |
| Importação CSV | 2336.57 ms | 2301.57 ms |
| Exportação CSV original | 1505.44 ms | 1516.15 ms |
| Snapshot CSV para análise | 2501.54 ms | 1583.27 ms |
| SUM de coluna explicitamente inteira | 1611.25 ms | 1411.90 ms |

A importação e exportação original ficaram próximas; não são apresentadas como
ganho. O caminho de análise evita conversões por célula quando não há tipos
explícitos. A consulta usa diretamente o tipo da coluna quando não há overrides
de células, eliminando a subconsulta correlacionada desnecessária. Os overrides
continuam prevalecendo e os CSVs sem tipagem mantêm os mesmos bytes.

Complexidades permanecem O(n) para escrita/varredura. O lote de leitura continua
limitado, sem materializar uma tabela de um milhão de linhas em JSON na UI. O
estado de tipos explícitos mantém seu custo proporcional aos metadados existentes.
Não foi reduzida a durabilidade de SQLite ou do ResourceStore para melhorar números.

## Renderização e escrita de sessão

O workspace recriava as abas e publicava a sessão mesmo quando id, aplicativo,
nome e seleção não mudavam. Agora ignora essas capturas redundantes; os editores
continuam salvando seus próprios conteúdos. Alterar o nome ou a seleção ainda
persiste a sessão. Também preserva metadados públicos anexados à aba.

No diagnóstico JSDOM de 1000 capturas sem alteração, com 20 abas, o tempo caiu
~904.72 → 0.75 ms, reconstruções DOM 1000 → 0 e escritas de sessão 1 → 0.
Isso mede especificamente trabalho eliminado, não a velocidade global do editor.
O teste de regressão verifica foco preservado e renomeação persistida. Os QAs Qt
continuam sendo a validação de renderização, desenho e navegação reais.

## Falhas adicionais corrigidas

- Instalação e remoção têm mensagens distintas, inclusive durante a operação.
- Uma instalação concluída depois de trocar de projeto não apaga os inputs do
  novo projeto. Respostas atrasadas da listagem também são descartadas.
- Falhas de inicialização de kernel possuem contrato público, HTTP 503, código
  `kernel_startup_failed` e orientação para consultar o log. Detalhes privados
  ficam no log; a resposta não afirma que houve falha ao salvar texto.
- Canais de um cliente Jupyter parcialmente iniciado são fechados antes da
  limpeza. Falhas de limpeza não substituem a causa original.
- Workers preservam o código e a indicação de repetição de erros do serviço.
- Preferências pendentes ou com falha mantêm a proteção de fechamento. O hook
  oficial de desmontagem aguarda a fila existente; o QA de reinicialização só
  encerra forçadamente a janela depois da confirmação durável de tema e zoom.
- O debounce de conteúdo usa temporizador separado do checkpoint da aba ativa,
  evitando cancelar a recuperação de sessão ao editar logo após abrir um arquivo.
- A reconstrução da release exige os quatro pacotes e seus SHA-256. O fluxo
  substitui assets com `--clobber`, preservando a release existente durante os
  uploads, e só muda a tag após completar os uploads. A API GitHub não oferece
  troca atômica de todo o conjunto de assets.

## Técnicas avaliadas e fontes primárias

O aplicativo já usa CPython. JSON, CSV, SQLite, Arrow e Qt executam partes
importantes em código nativo. Nesta rodada, os ganhos vieram de evitar trabalho
repetido e consultas por célula, sem acrescentar compilação obrigatória.

Cython/extensões C continuam opções para um futuro hot loop Python confirmado
pelo profiler. Não foram acrescentados neste patch: não acelerariam diretamente
o layout JavaScript/Qt, nem substituiriam a redução de I/O e chamadas já evitadas.
Trocar para CPython free-threaded também exigiria validar todas as extensões e
seu custo; não é uma melhoria automática para este aplicativo.

- Python, profiling e distinção entre profiler/benchmark: https://docs.python.org/3.12/library/profile.html
- Python, extensões nativas e ferramentas como Cython: https://docs.python.org/3.12/extending/
- Python, requisitos e custos de free-threading: https://docs.python.org/3.13/howto/free-threading-python.html
- SQLite, WAL e durabilidade: https://sqlite.org/wal.html
- SQLite, planejamento e PRAGMA optimize: https://sqlite.org/pragma.html
- Arrow, leitura Parquet, lotes e limites do memory mapping: https://arrow.apache.org/docs/python/parquet.html
- Renderização, tamanho do DOM e leituras/escritas de layout: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing

A paginação, carregamento sob demanda, workers e virtualização existentes foram
preservados. Não foi introduzido cache ou executor paralelo. Os números são
amostras locais; os jobs nativos Windows/Linux e pacotes validam compatibilidade.

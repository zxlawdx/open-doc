# Diagnóstico inicial da suíte de dados

O PR #67 está aberto. O workflow Vela Qt cross-platform validation, execução 450, terminou com sucesso. O primeiro incremento de planilhas deriva da branch desse PR para reutilizar a Central.

O Vela hospeda uma página de trabalho QtWebEngine, entrega assets locais e liga a interface ao Python por API e ponte desktop. Documentos de texto usam o modelo rico e o serviço Editor. PDF e PPTX usam o serviço de documentos fixos e seus respectivos leitores e editores. A biblioteca agrega metadados e mantém os controladores de edição montados. O SQLite do workspace já oferece revisões e armazenamento de snapshots deduplicados. Planilhas reutilizam esse banco e o histórico, com tabela própria e acesso separado dos editores existentes.

A revisão Vela fixada pelo Open Doc (`0d35abc`) contém build e assistente gráfico. O checkout inspecionado (`2edd98a`) também contém `standalone_installer.py`, com Inno Setup e empacotamento Linux. A fase de instalação deve testar essa atualização e validar os instaladores em máquinas limpas antes de alterar o pin. A política de empacotamento do runtime e a instalação do Python de projetos devem ser separadas.

## Dependências e referências

- XLSX usa openpyxl (MIT), com limites de importação e preservação dos recursos suportados. O recálculo fica separado do codec. defusedxml (PSF-2.0) protege a leitura de XML. A documentação do grafo do HyperFormula serve como referência para um recálculo incremental futuro. [Grafo de dependências](https://handsontable.com/docs/hyperformula/guide/dependency-graph.html) CSV e TSV usam o módulo padrão. [openpyxl](https://openpyxl.readthedocs.io/)
- Para o próximo PR, comparar CodeMirror 6 e Monaco no QtWebEngine real antes de adotar o editor. Avaliar Pyright (MIT) no interpretador selecionado, sem importar módulos do usuário para sugerir símbolos. [CodeMirror](https://codemirror.net/) · [Pyright](https://github.com/microsoft/pyright)
- Usar venv por projeto e processos explícitos para pip e execução. Um subprocesso herda permissões do usuário. Adicionar notebooks e integração de dados após definir o contrato do executor local.
- A API Colab descreve runtimes conectáveis por protocolos Jupyter. A extensão oficial e a CLI são referências de fluxo. A fase remota precisa de conta elegível, OAuth desktop e execução autorizada para validar o transporte. [API](https://developers.google.com/colab/api/reference/rest/v1beta/runtimes) · [Extensão](https://github.com/googlecolab/colab-vscode) · [CLI](https://github.com/googlecolab/google-colab-cli)

A ordem de integração é planilhas, editor e LSP, ambientes e pip, instalador, notebooks, análise, Colab e experimentos. A grade convencional e a futura camada analítica devem ter limites separados.

## Planilhas, primeiro incremento

A grade cria somente as células da área visível e mantém os cabeçalhos à vista. Cada pasta contém até 20 abas esparsas, com 10 mil linhas e 100 colunas por aba, 50 mil entradas de valor e estilo e 5 MB por snapshot. O armazenamento compartilhado registra versões transacionalmente e recusa revisões desatualizadas. O editor carrega seus scripts sob demanda. Os formatos de documento existentes conservam seus controladores.

O motor calcula sob demanda, com cache por edição, limites de avaliação e detecção de ciclos. Suporta aritmética, referências entre abas e SOMA, MÉDIA, MÍNIMO e MÁXIMO, incluindo os nomes XLSX equivalentes. O recálculo por grafo, o restante das funções, formatos de células além de negrito, operações estruturais e assistente avançado de importação continuam pendentes. CSV e TSV usam UTF-8 e exportam a aba ativa. O XLSX reconstitui o subconjunto suportado e não preserva todos os recursos de pastas externas. Fórmulas externas ou não permitidas tornam-se texto. O histórico registra os salvamentos e permite restaurar uma versão como nova revisão.

### Desempenho

Teste local do codec CSV com duas colunas sintéticas, medido com `tracemalloc`. O pico representa alocações Python durante o teste e não o consumo total do aplicativo.

| Linhas | Importação | Exportação | Pico |
|---|---:|---:|---:|
| 1.000 | 68 ms | 47 ms | 0,57 MiB |
| 10.000 | 681 ms | 433 ms | 4,04 MiB |
| 100.000 | Rejeitado em 328 ms | — | 2,14 MiB |
| 500.000 | Rejeitado em 299 ms | — | 2,14 MiB |

### Checklist manual no Linux Mint e Windows

1. Abra o app e entre em **Planilhas**. Crie uma pasta em branco e, separadamente, uma cópia de um template.
2. Digite valores em A1 e B1, use `=SOMA(A1:B1)` em C1 e confira o resultado. Navegue com setas, Tab e Enter. Selecione um intervalo com Shift e teste copiar e colar.
3. Aplique negrito, desfaça e refaça. Crie uma aba e referencie uma célula da primeira.
4. Salve, volte à Central, reabra por **Recentes**, faça outra edição e restaure uma versão pelo **Histórico**.
5. Importe CSV UTF-8 e TSV contendo `00123`. Confira o identificador, abra a cópia em **Importados** e verifique que a origem segue intacta.
6. Exporte XLSX, reimporte e confira as abas, o negrito e as fórmulas suportadas. Exporte CSV ou TSV e confira que o conteúdo corresponde à aba ativa.
7. Abra DOCX, PPTX e PDF pela Central para confirmar a troca entre os editores.

Capturas da [galeria](images/workbook-mvp/templates.png) e do [editor](images/workbook-mvp/editor.png). O teste reproduzível está em `tools/qa_workbook.py`.

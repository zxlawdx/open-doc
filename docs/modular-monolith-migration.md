# Monólito modular do Open Doc

Os oito módulos são aplicações nativas registradas no mesmo `VelaApp`. O namespace
`apps.open_doc` e seus aliases foram removidos. Não há implementação paralela de
ResourceStore, EventBus, Lifecycle ou executor no Open Doc.

| Aplicação | Implementações reais |
| --- | --- |
| Home | Shell, biblioteca, navegação, sessões e abas globais |
| Documentos | Editor e persistência DOCX, parser/exportadores OOXML, UI de texto |
| Planilhas | Workbook, fórmulas, gráficos, objetos, importação/exportação e tabelas por referência |
| Apresentações | Leitura/importação/exportação PPTX e edição/renderização de slides |
| PDF | Validação, leitura, edição nativa, exportação e navegação PDF |
| Dados | Tabelas virtualizadas SQLite, tipos, SQL, histórico, conversões e intercâmbio |
| Código | Análise Python, ambientes por projeto, notebooks e kernels Jupyter persistentes |
| Templates | Catálogo, modelos pessoais e prévias |

`config/` é a composição das dependências e a bridge. Contratos e modelos de
intercâmbio ficam em `shared/contracts`; operações comuns a formatos distintos
ficam em `shared/services`. A composição injeta adaptadores PDF/PPTX e ferramentas
de planilhas, evitando imports privados entre aplicações. Templates e scripts de
edição foram movidos para seus apps; o shell compõe contribuições públicas e
carrega os scripts sob demanda. Testes são organizados por categoria.

## Sessão e edição

A interface usa o endpoint autenticado de workspace para manter abas e arquivo
ativo entre inicializações. A troca pela barra global salva o editor anterior e
interrompe a navegação quando há erro de persistência. Fechar abas com alterações
pendentes exige salvá-las. Conflitos de sessão preservam as abas locais, recuperam
a revisão remota e exibem erro; não há sobrescrita silenciosa.

Sessões, cadernos e suas referências são recursos nativos versionados. O salvamento
da sessão e a reconciliação de pins são uma única transação do Vela. O histórico
de sessão/cadernos retém dez versões; blobs possuem quota de 10 GiB e retenção de
vinte versões, preservando versões referenciadas por pins. O quota limita blobs,
não o tamanho de bases SQLite, ambientes Python ou arquivos de usuário.

## Fluxo de Dados e notebook

1. Importe CSV/TSV, XLSX ou Parquet pela área de Dados.
2. Abra Ferramentas/Código e use o preset para instalar Pandas, Arrow, ipykernel e
   DuckDB no ambiente do projeto. A instalação continua sendo uma ação explícita.
3. Use **Abrir como DataFrame**. `df` contém a tabela, isolada do original.
4. Execute células Python e SQL (`SELECT ... FROM df`), ou edite células Markdown.
   Células do mesmo projeto compartilham kernel; projetos distintos têm processos
   separados. Saídas incluem texto, tabelas HTML sanitizadas e PNG/JPEG limitados.
5. Use **Publicar df na tabela**. O recurso recebe uma nova revisão, e a adoção na
   tabela acontece em transação SQLite, com validação do token da tabela. Edições
   concorrentes são rejeitadas. Desfazer/refazer restaura os snapshots anteriores.
6. Use **Abrir em Planilhas por referência**. Se a tabela já possui um recurso
   Parquet publicado e ainda está na mesma revisão, o mesmo handle é reutilizado.
   A planilha não recebe um milhão de células em JSON: mostra páginas de cinquenta
   linhas/vinte colunas. Essa contribuição é um snapshot de leitura isolado;
   transformações são feitas no notebook e publicadas explicitamente.

Planilhas comuns também podem executar células no kernel do projeto. Seus
snapshots pequenos continuam sujeitos aos limites existentes de 50 mil células.
Notebooks preservam suas fontes como recursos versionados. Encerrar o kernel
remove variáveis em memória; recuperar as fontes do caderno não desserializa
objetos Python nem promete recuperar um processo encerrado.

A importação/exportação XLSX usa modo de leitura/escrita incremental; Parquet usa
batches. Nenhum desses fluxos serializa o dataset inteiro na bridge. A construção
de `df` materializa o DataFrame no kernel e requer memória proporcional aos dados
decodificados; não é uma promessa de zero-copy.

## Python empacotado

O build preserva também os metadados de entry points de `jupyter_client` via
`BUILD_COPY_METADATA`; sem eles, o provisionador do kernel não é resolvido
corretamente no executável congelado.

O executável congelado nunca é usado como interpretador. O aplicativo seleciona o
Python externo/venv do projeto, remove variáveis de runtime embutido e restaura a
busca de DLLs Windows imediatamente depois de criar o processo. Isso evita que o
Python externo procure `python312.dll` no runtime do Open Doc.

O comando explícito `--vela-project-test` executa, **dentro do pacote**, criação de
venv, instalação das quatro bibliotecas, células Python/SQL, publicação/desfazer e
roundtrips XLSX/Parquet. Ele grava JSON de evidências em
`OPEN_DOC_NOTEBOOK_SMOKE_REPORT`. O workflow de pacotes exige esse teste nos dois
sistemas; não é executado durante a abertura normal do programa.

## Evidências e limites de validação

Execução local Linux: 410 testes Python aprovados e 317 frontend aprovados. Dois
casos Jupyter são ignorados somente quando uma tentativa real de bind retorna
EPERM/EACCES: este executor bloqueia sockets TCP/IPC do Jupyter. Outros dois casos
já eram ignorados. Os testes de roundtrip/adopção/desfazer executaram Pandas e
Arrow reais. Os kernels e o fluxo completo são obrigatórios no CI nativo; aprovação
local não substitui o resultado desses jobs nem o teste do executável Windows.

Os JSONs de benchmark/profile ficam nesta pasta. `data-baseline-comparable-linux`
e `data-after-comparable-linux` executam o mesmo benchmark na revisão bd572de e
na migração, usando o mesmo Vela. Para 1M registros, importação foi 13.611 →
13.616 s, snapshot CSV 8.779 → 8.748 s e pico Python ~2.11 MB: paridade, sem
alegação de ganho estatístico. São diagnósticos únicos com tracemalloc ligado.

`modular-runtime-profile-linux.json` inclui cProfile e medições de 1k/10k/100k/1M.
No caso de 1M, página backend ~1.18 ms, consulta limitada ~0.86 ms e snapshot
Parquet ~7.89 s. A importação perfilada levou ~28.53 s; cProfile/tracemalloc
acrescentam custo. A primeira medição de snapshot inclui o import de Arrow (~25 MB
de alocações Python); as seguintes ficaram em ~2.15 MB. Inicialização backend fria
nesse processo foi ~430 ms; instâncias posteriores com imports quentes ~15–21 ms.
Isso não é tempo de abertura da janela Qt. Renderização e navegação reais usam os
QA nativos e artefatos do CI.

Complexidades: importação e exportação percorrem O(n) linhas, com lotes limitados;
SQLite adiciona o custo de seus índices. Página SQLite usa a chave composta de
linhas, O(log n + p); consultas dependem do plano (LIMIT pode parar cedo,
agrupamentos/ordenações podem percorrer toda a tabela). Parquet pula row groups e
decodifica batches até o offset local. Reutilizar um recurso já publicado transfere
O(1) metadados, sem nova cópia de payload. Materializar df é O(n) memória; snapshots
usam buffers limitados. Overrides de tipos e metadados de histórico podem crescer
com a quantidade de células tipadas, e não foram declarados O(1).

O trabalho só deve ser considerado pronto após os jobs nativos do head final
passarem. O PR Vela #28 foi mesclado externamente durante esta execução; os commits
posteriores continuam em sua branch original e são fixados por SHA no Open Doc.
Não houve merge automático nem criação de PR substituto.

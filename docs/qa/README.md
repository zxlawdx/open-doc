# Open Doc QA

A linha de base desta execução foi a `main` em `ce46a82`. A primeira correção de
paginação e Enter foi verificada em `4d402c1`, do PR #62. O teste de recuo
usa esse commit com o complemento de Tab desta revisão. O Vela
`2edd98a` foi testado separadamente. O Open Doc usou o Vela fixado nas
dependências em `0d35abc`.

## Reprodução

Com Python 3.12, Node 22 ou mais recente e as bibliotecas Qt da plataforma:

```sh
python -m pip install -r requirements-dev.txt
python manage.py collectstatic --yes
python -m pytest -q
npm test
python -u tools/qa_docx_list.py docs/images/stabilization/docx-list
python -u tools/qa_stabilization.py
```

Em Linux sem sessão gráfica, exporte `QT_QPA_PLATFORM=offscreen` e
`QT_OPENGL=software`. Em ambientes descartáveis executados como root, o Qt
pode exigir `QTWEBENGINE_DISABLE_SANDBOX=1`. Use apenas as amostras geradas
pelo teste nesse ambiente. As dependências Linux estão no workflow
`runtime-windows.yml`.

## Matriz desta execução

| Cenário | Oráculo | Resultado | Evidência |
|---|---|---|---|
| DOCX, lista com marcadores | Importar DOCX de exemplo, ativar lista, Enter e digitar. Os dois textos têm marcador. | FAIL na main, PASS no PR #62 | [Antes](evidence/ce46a82/docx-list/screenshot-before.png) · [Depois](evidence/4d402c1/docx-list/screenshot-after.png) · [Log da main](evidence/ce46a82/docx-list/logs.txt) · [Log do PR](evidence/4d402c1/docx-list/logs.txt) |
| DOCX, lista numerada e saída | Teclas Qt criam itens 1 e 2. Enter no item vazio remove a lista somente nesse item. | PASS local no PR #62 | [Log](evidence/4d402c1/docx-list/logs.txt) |
| DOCX, recuo | Tab e Shift+Tab no início do item mudam o nível 0 → 1 → 0. Texto idêntico. | FAIL no teste JS em 4d402c1, PASS em JS e Qt após correção | [Captura Qt](evidence/4d402c1-plus-tab/docx-nesting/screenshot-after.png) · [Log Qt](evidence/4d402c1-plus-tab/docx-nesting/logs.txt) |
| DOCX, 100/500/1.000 Enter e Backspace | 101/501/1.001 blocos após Enter, uma página e um bloco após Backspace e exclusão total. Editor continua focado e editável. | PASS em Ubuntu 24.04, QtWebEngine 5.15.19, PR #62 | [Log](evidence/4d402c1/docx-pagination/logs.txt) |
| PDF, edição, exportação, reabertura e anotação | Verificações de conteúdo e visualização de `qa_pdf_native.py`. | PASS no workflow do PR #62 | [CI](https://github.com/zxlawdx/open-doc/actions/runs/42478826040) |
| PPTX, texto, formas, tabela e tinta | Renderização em três resoluções, persistência e exportação de `qa_pptx.py`. | PASS no workflow do PR #62 | [CI](https://github.com/zxlawdx/open-doc/actions/runs/42478826040) |
| Suítes do Open Doc | Python 272 aprovados, 2 skips da suíte. JavaScript 209 aprovados com a regressão de recuo. | PASS local | `python -m pytest -q` e `npm test` |
| Suíte do Vela | 160 aprovados no checkout 2edd98a. | PASS local | `PYTHONPATH=. python -m pytest -q` |

No Qt, o ciclo de 100/500/1.000 operações levou respectivamente 2,8/11,5/35,2 s.
São observações desta execução, sem limiar de desempenho ou comparação
entre máquinas. As capturas de listas foram feitas a 1366 × 768 e escala 1.

## Causa e escopo

A lista do DOCX é um parágrafo do modelo com metadados de numeração e um
marcador visual. Na linha de base, Enter seguia a divisão nativa do parágrafo,
o que deixava o item seguinte sem metadados de lista. O PR #62 aplica a
divisão ao modelo e restaura o caret depois da renderização.

O atalho de Tab passava pelo código genérico que insere um nó de tabulação.
O complemento detecta o início lógico do item, altera seu nível em uma
transação do documento e preserva os runs. O recuo respeita a faixa OOXML
de 0 a 8 e as definições de níveis disponíveis em listas importadas.

O workflow verde do commit 4d402c1 cobre runners Ubuntu e Windows e
publica capturas dos dois ambientes. Linux Mint em máquina limpa, ABNT2
físico, leitores de tela, matriz de DPI/temas, instaladores offline,
fuzzing, cobertura de linhas e branches, comparação visual longitudinal
da paginação e inspeção exaustiva dos comandos continuam pendentes.
A regressão abaixo mede a presença e as dimensões do papel durante a
repaginação do DOCX.

## Seleção parcial entre páginas no DOCX

- Abra um DOCX com texto antes e depois de uma quebra de página. Selecione
  o fim do primeiro parágrafo e o início do segundo. Backspace ou Delete
  deve apagar o trecho selecionado e posicionar o cursor entre as duas
  partes preservadas. Desfaça e refaça pelo teclado.
- O teste JavaScript verifica também a seleção invertida, uma seleção entre
  fragmentos do mesmo hyperlink e o conteúdo depois de salvar e reabrir.
  O teste Qt importa um DOCX criado pelo próprio script e usa teclas reais.
- As pontas da seleção precisam estar em parágrafos do corpo contendo
  texto, hyperlinks ou tabulações. Seleções que atravessam tabelas,
  finais de seção, blocos opacos ou blocos com tinta ancorada são
  protegidas. Objetos inline nas pontas também impedem a operação.
- [Seleção antes](evidence/cross-page-selection/cross-page-before.png) ·
  [Documento depois](evidence/cross-page-selection/cross-page-after.png) ·
  [Log Qt](evidence/cross-page-selection/qt.log).


## Quadros durante a repaginação do DOCX

O teste de estresse existente do Qt agora coleta uma amostra da geometria
do papel em cada callback de `requestAnimationFrame`, durante Enter,
Backspace e Ctrl+A seguido de Backspace. A regressão exige amostras de
antes e depois das teclas em cada fase, ao menos uma página presente
e a primeira e a última folhas com as dimensões de referência. A
tolerância de 1 pixel CSS cobre arredondamento de tamanho A4.

Resultados locais no Ubuntu 24.04, QtWebEngine 5.15.19, com a mesma
sonda nas duas revisões:

| Revisão do editor | Enter/Backspace | Amostras | Amostras sem página | Maior intervalo |
|---|---:|---:|---:|---:|
| ce46a82, antes do PR #62 | 100 | 229 | 81 | 50 ms |
| 419f683, após os PRs #62 e #63 | 100 | 172 | 0 | 50 ms |
| 419f683 | 500 | 408 | 0 | 167 ms |
| 419f683 | 1.000 | 591 | 0 | 383 ms |

Na revisão antiga, a reconstrução removia as folhas e só repaginava
em uma tarefa posterior. O primeiro quadro sem folha no traço veio
após 25 Backspaces. O PR #62 agrupou reconstrução e paginação na
mesma tarefa. Esta etapa inclui a medição no teste nativo executado
pelo CI. Os traços completos de cada lote são publicados com as
capturas em `docs/images/stabilization/docx-stress-*-frames.json`.

A sonda observa a geometria do DOM antes da pintura. O intervalo entre
callbacks mede a cadência observada, sem equivalência direta à latência
de entrada ou aos quadros físicos do monitor. O lote de 1.000 ainda
mostrou uma pausa entre callbacks de 383 ms nesta execução.

[Traço antigo](evidence/pagination-frames/before-100.json) ·
[Traço atual](evidence/pagination-frames/after-100.json) ·
[Resumo](evidence/pagination-frames/summary.json)

## Enter incremental e Backspace depois de uma lista

O Enter com cursor recolhido em um parágrafo vazio serializa apenas os
dois blocos se ambos continuarem vazios na mesma página. Dividir texto,
substituir uma seleção ou editar fragmentos mantém a serialização lógica
completa. A comparação de identidades dos blocos intactos usa conjuntos.
A verificação de alterações não salvas dispensa a posição do cursor.

Em um teste comparativo com 1.000 Enter reais no QtWebEngine local, o
documento chegou aos mesmos 1.001 parágrafos e 44 páginas nas duas
revisões. O lote levou 17,4 s na base e 9,6 s com a mudança. As
serializações do DOM inteiro caíram de 1.000 para uma. O maior
intervalo entre callbacks caiu de 716 para 300 ms nesta comparação.
Os tempos são medições locais e variam com o ambiente.

Backspace em um parágrafo vazio após sair de uma lista retorna ao
fim do item anterior. A regressão Qt testa marcadores e numeração
com teclas reais, mantém o marcador e verifica a posição do cursor.
O histórico restaura a linha vazia com Ctrl+Z.

[Resultados](evidence/docx-enter-performance/results.txt) ·
[Cursor após Backspace](evidence/docx-enter-performance/backspace-after-list.png)

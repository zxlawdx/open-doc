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
Asserções de paginação comprovam os estados observados pelo teste, sem
medição quadro a quadro de piscadas.

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

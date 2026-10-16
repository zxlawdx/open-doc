# Teclado, tinta e histórico no Vela/Qt

HEAD inicial: `592f4c0496242b9d03486603c1cb54ef1e6b1ba4`.
HEAD de código e QA validado: `0a4505eccccb08216b14ed138b29a057a2cdfa91`.
O commit documental posterior não altera a implementação validada.

O aplicativo continua usando VelaApp, BaseBridge, templates, API local autenticada
e collectstatic. Esta rodada não troca o framework nem modifica os renderers de
PDF/PPTX; adapta os recursos compartilhados de tinta e reconhecimento.

## Causas e correções

| Contrato | Evidência e causa | Correção |
| --- | --- | --- |
| DOM → modelo | No Qt, `Open Doc teclado 123` aparecia no DOM, mas `blocks` estava vazio antes de qualquer undo. O documento vazio não tinha parágrafo inicial e `contents()` ignorava texto solto ao enumerar apenas elementos. | Parágrafo inicial editável, normalização de texto/inline solto e IDs estáveis antes de serializar/paginar. |
| Composição → layout | O teste estendido de acentos falhou quando restaurava o bookmark em todo input. Isso interrompia composição. Havia também dois caminhos de invalidação: input cru e evento sem bloco. | Restaurar seleção apenas se a normalização realmente mudou o DOM; adiar o processamento durante composição; um evento semântico com bloco/motivo; debounce de 450 ms para typing. |
| Bookmark do cursor | `cloneContents()` copiava todo o prefixo do documento a cada captura de posição. | Medir o texto do Range sem clonar o DOM; regressão proíbe cloneContents no input local. |
| Digitação local → serialização | O caminho paginado clonava todas as páginas para reconstruir o documento lógico. | Clonar apenas o bloco lógico afetado e seus fragmentos; preservar as referências dos outros blocos. Operações estruturais ainda podem reconstruir a visão lógica. Backspace local usa o mesmo caminho rápido. |
| Undo → DOM | O patch anterior aceitava apenas até 16 parágrafos sem listas; tabela/lista voltava ao render completo. | Reconciliação por IDs para parágrafos, listas, tabelas, inserções e remoções locais; preservar imagens não alteradas, scroll e bookmark; repaginar só quando necessário, a partir da página afetada. |
| IDs → persistência | Após muitos Enter, o DOM e o texto do modelo pareciam corretos, mas o save retornava `Identificador de nó inválido/duplicado`. O DOM nativo copiava o ID do run; a serialização local só verificava IDs dentro do próprio bloco. | Reservar os IDs de blocos não alterados e reparar colisões somente nos blocos novos/alterados. Regressão mantém o bloco antigo por identidade e verifica unicidade global: falha antes (8 IDs únicos para 9 nós), passa depois. |
| Stylus → tinta/UI | Código permitia propagação, captura sem proteção e cancelamento genérico em lostpointercapture. Não havia janela de supressão de clique. A sequência de hardware do usuário não foi capturada aqui. | preventDefault/stopPropagation no stroke, capture/release protegidos, estado committed antes do release e supressão de click/auxclick por 350 ms. Cursor continua com seus eventos normais. |
| Disponibilidade → conversão | O botão não consultava capacidades; disponibilidade do Windows Ink considerava apenas imports. | Botão começa desabilitado, consulta o backend e mostra motivo; diagnóstico enumera reconhecedores e distingue PyWinRT ausente de idioma Português ausente. Erro/resultado vazio mantém a tinta. |

Histórico registra tipo, IDs de blocos, superfícies de tinta e alterações estruturais.
Continua limitado por snapshots; não é uma implementação de histórico por deltas.
O tamanho usado pelo orçamento de memória fica em cache por conteúdo imutável,
evitando serializar novamente todos os snapshots antigos a cada tecla.
Undo de mudanças de seções ou substituição ampla com ordem incompatível ainda pode
renderizar tudo. O caminho normal local não usa esse fallback.

Salvar continua sem `load()` da resposta. A regressão assíncrona segura uma resposta
de save A, digita B, libera A e verifica DOM/modelo e persistência final de B.
O teste Python também rejeita gravação com revisão antiga.

## Validação reproduzível

```bash
npm test
python -m pytest -q
python tools/audit_css.py
python -m black --check --line-length 88 apps config tools tests main.py manage.py launcher.py
python tools/qa_input.py
python tools/qa_stabilization.py
python tools/qa_ink.py
python tools/qa_pptx.py
python tools/qa_desktop.py
python tools/qa_windows_ink.py
```

- Local: 60 testes JS aprovados; 90 Python aprovados e um ignorado. Onze testes JS
  e cinco Python adicionados nesta rodada. No CI Linux e Windows: 60 JS, 89 Python e dois
  ignorados (DOCX privado não fornecido e reconhecimento Windows real indisponível).
- Qt Linux real: PyQt 5.15.11, QtWebEngine 5.15.19 / Chromium 87, Python 3.12.14.
- `qa_input.py`: teclas ASCII QTest e composição Unicode QInputMethodEvent; frase
  acentuada, Enter, Backspace, Delete, espaço, Shift e Ctrl+B. Esperas de 100, 300,
  600, 1200 e 2500 ms entre verificações de DOM **e** modelo, antes de undo.
- Autosave real de 30 segundos e reabertura em processo separado. DOCX gerado com
  mais de 20 páginas: primeira, página 15, última, listas numerada/bullet, célula,
  imagem próxima e parágrafo fragmentado; teclas rápidas a 30 ms e lentas a
  450/550 ms; dez undos; digitação até gerar novas páginas.
- Contador de render completo durante typing/undo/redo local: **zero**. Imagens
  mantêm identidade. No mesmo teste de tabela, carregando os seis adapters JS do HEAD inicial, o
  contador antes é **1** e depois **0** (JSDOM); o Qt final também exige zero.
  Não foi medido um contador de baseline para todas as outras operações.
- Regressões Vela reais: atalhos, abrir/salvar/exportar, troca de formatos, seleção,
  clipboard, menus, layout em três resoluções; tinta PDF e PPTX e reabertura.
- Evidências Linux: [log local](evidence/input-linux-qt-2026-10-16.txt) e
  [CI Linux](evidence/input-linux-ci-2026-10-16.txt), com Python 3.12.15 no runner.

Um primeiro ensaio de overflow enviava milhares de teclas sem intervalo e não foi
usado como evidência de aprovação. O teste de aceitação usa teclas espaçadas em
30 ms e linhas inseridas com Enter nativo para forçar transbordamento em ambas as plataformas. Não há
benchmark de latência ou garantia de desempenho para rajadas sem intervalo.

## Limites de reconhecimento e hardware

| Categoria | Resultado |
| --- | --- |
| Synthetic pen QA | JSDOM e Qt: tinta, undo/redo, preservação, captura indisponível e lostcapture após commit; clique/auxclick sintético suprimido. |
| Physical pen QA | Não executado. Nenhuma mesa física disponível; modelo, pressão e sequência real de PointerEvents permanecem sem validação. |
| Fake recognizer QA | Executado separadamente: retorno revisável, fonte, inserção nativa e preservação em erro. |
| Real Windows Ink QA | Diagnóstico real de disponibilidade; reconhecimento de escrita pelo motor real não comprovado. |

`python tools/qa_tablet_events.py` abre uma superfície em branco e registra somente
metadados de eventos, pressão, tilt, botões, capture, click/auxclick e cancelamento.
Não registra conteúdo do documento. Usar esse logger no equipamento do usuário
antes de atribuir uma sequência específica de eventos ao driver/tablet.

A checagem de persistência do QA observa o conteúdo canônico e captura rejeições
assíncronas de save. A rejeição por ID duplicado foi reproduzida de verdade antes
da correção; a verificação isolada Qt de Enter + digitação + save passou depois.

No Linux o diagnóstico informa `Windows Ink requer Windows`, nenhum reconhecedor.
No Windows Server do CI, PyWinRT não está instalado: backend indisponível,
nenhum reconhecedor/idioma comprovado. O CI publica seu próprio diagnóstico. Não confundir motor falso com Windows
Ink real nem eventos sintéticos com caneta física. A solicitação de idioma pt-BR
não significa que esse idioma esteja instalado.

## CI Linux e Windows aprovado

[Execução 38952665248](https://github.com/zxlawdx/open-doc/actions/runs/38952665248)
aprovada nos dois jobs para o HEAD funcional acima. Ambos executaram build limpo,
60 testes JS, 89 Python com dois skips, novo QA de retenção e reabertura, e os
quatro QAs de regressão do aplicativo Vela/Qt.

Windows Server: Python 3.12.10, PyQt 5.15.11, QtWebEngine 5.15.2 / Chromium 83.
Linux CI: Python 3.12.15, PyQt 5.15.11, QtWebEngine 5.15.19 / Chromium 87.
O alvo dos bundles continua Chromium 83.

[Log Windows](evidence/input-windows-ci-2026-10-16.txt) e
[log Linux](evidence/input-linux-ci-2026-10-16.txt) incluem versões, marcadores,
contagens e diagnóstico de backend. Capturas estão nos artefatos dessa execução.
A publicação final acrescenta somente documentação ao código aprovado.

# Pesquisa de referências de editores

Verificação em 15/10/2026 (America/Manaus). Fontes primárias: API pública
GitHub (metadados/licença), READMEs e manifests. Nenhum código dos projetos
foi incorporado. Arquivamento do mirror não significa abandono do upstream.
Datas abaixo são observações do repositório, não prova de manutenção futura.

| Repositório | Arquivado na API | Licença | Último push observado |
|---|---|---|---|
| [zxlawdx/Vela-framework](https://github.com/zxlawdx/Vela-framework) | não | MPL-2.0 | 2026-09-24 |
| [franciscop/modern-editor](https://github.com/franciscop/modern-editor) | sim | MIT | 2017-01-13 |
| [webodf/Wodo.TextEditor_release](https://github.com/webodf/Wodo.TextEditor_release) | não | AGPL declarada no README; conferir distribuição | 2015-09-04 |
| [guardian/scribe](https://github.com/guardian/scribe) | sim | Apache-2.0 | 2020-03-08 |
| [ONLYOFFICE/DesktopEditors](https://github.com/ONLYOFFICE/DesktopEditors) | não | AGPL-3.0 | 2026-10-13 |
| [facebook/lexical](https://github.com/facebook/lexical) | não | MIT | 2026-10-15 |
| [webodf/WebODF](https://github.com/webodf/WebODF) | não | AGPL declarada no README; conferir distribuição | 2020-02-04 |
| [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | não | MIT | 2026-10-14 |
| [ProseMirror/prosemirror](https://github.com/ProseMirror/prosemirror) | sim | MIT | 2026-04-01 |
| [webodf/Kotype](https://github.com/webodf/Kotype) | não | AGPL declarada no README; conferir distribuição | 2015-06-19 |
| [nossas/slate-editor](https://github.com/nossas/slate-editor) | sim | MIT | 2021-09-16 |
| [mhurhangee/docx-editor](https://github.com/mhurhangee/docx-editor) | não | Apache-2.0 | 2026-06-26 |
| [ianstormtaylor/slate](https://github.com/ianstormtaylor/slate) | não | MIT | 2026-10-16 |
| [ONLYOFFICE/web-apps](https://github.com/ONLYOFFICE/web-apps) | não | AGPL-3.0 | 2026-10-15 |
| [samwillis/premirror](https://github.com/samwillis/premirror) | não | MIT | 2026-03-29 |

## Leitura e implicações

- **mhurhangee/docx-editor**: README declara cópia preservada e não mantida
  após desaparecimento do original em junho de 2026. Core Apache-2.0 v1.9.0
  separa parser/serializer OOXML, adapters React/Vue e layout/ProseMirror.
  Lição: fidelidade DOCX precisa de modelo canônico e partes preservadas;
  converter para Markdown não é round-trip OOXML. Não adotar mirror parado.
- **WebODF**: ODF renderizado em HTML/CSS, build CMake/Closure Compiler,
  produtos library/Wodo/collab distintos. AGPL declarada no README. Separar
  engine e UI; não importar stack antigo nem prometer fidelidade Office.
- **Kotype**: Wodo.CollabTextEditor + Node/MongoDB, formato ODF nativo, manutenção
  incremental de partes não editadas. README adverte sobre renderização/edição
  parciais. Dependências bower/fluxos de 2015 não são base adequada ao Vela.
- **Wodo.TextEditor_release**: distribuição de editor client-side WebODF;
  AGPL, releases antigos. Separação de componente é útil, pacote não adotado.
- **guardian/scribe**: deprecated/arquivado. BROWSERINCONSISTENCIES.md descreve
  foco, seleção e comandos bold/formatBlock/listas, HTML normalizado diferente
  entre browsers. Decisão: centralizar seleção/comandos e testar no Qt real.
- **nossas/slate-editor**: arquivado, MIT, React + Slate com toolbar e plugins
  instaláveis. Boa separação de plugins; grande matriz de serialização/estado.
  Não confundir o wrapper arquivado com o projeto Slate atual.
- **franciscop/modern-editor**: arquivado/MIT, README atribui descontinuação
  à dificuldade de construir sobre contenteditable. É evidência de risco do
  engine próprio, não prova de que toda implementação desse tipo falhará.
- **samwillis/premirror**: MIT, ProseMirror como fonte de verdade; snapshot,
  measure, composer, fragmentos, widow/orphan, React 19/Vite. Layout separado
  do conteúdo é a referência positiva. Não portar camada inteira sem prova
  no Chromium do Qt 5.15, testes de seleção e migração do modelo.
- **ONLYOFFICE/web-apps e DesktopEditors**: AGPL-3.0; Readme.md do web-apps
  descreve explicitamente engine Document Server, UI e Integration API. Frontend de suíte e
  integração desktop separados. Referência visual de hierarquia/menu/toolbar,
  não fonte de código. Não incorporar código AGPL ao produto MIT.
- **[GenOffice](https://github.com/genspark-ai/genoffice)**: Apache-2.0,
  repositório ativo na consulta. README e package.json descrevem monorepo de
  apps e engines separados, Electron e build Node >=22.12. README reivindica
  preservação byte a byte de partes não tocadas. Essa reivindicação não foi
  validada por testes locais. Útil: distinguir engine de formato, visual e
  shell. Não substituir Vela por Electron nem importar suíte inteira.
- **ProseMirror**: mirror GitHub arquivado, README informa mudança para
  [code.haverbeke.berlin](https://code.haverbeke.berlin/prosemirror/prosemirror).
  MIT, módulos separados. Não classificá-lo como engine abandonado.
- **Tiptap**: core MIT v3.30.3 no manifest consultado, framework agnostic sobre
  ProseMirror; extensões e recursos pagos devem ser avaliados individualmente.
- **Slate**: MIT, framework customizável, serialização e plugins sob controle
  do app. Migração exigiria testes de seleção/history e pacote React de UI.
- **Lexical**: MIT, estado imutável/history, core agnóstico. README informa
  Chrome 86+ (Firefox 115+/Safari 15+); suporte declarado não substitui prova
  de build e de APIs reais no QtWebEngine distribuído.

## Fontes específicas

Os links de repositório da tabela apontam para README/licença/manifests.
Leituras adicionais: [Scribe inconsistências](https://github.com/guardian/scribe/blob/master/BROWSERINCONSISTENCIES.md),
[Eigenpal core](https://github.com/mhurhangee/docx-editor/blob/main/packages/core/package.json),
[Tiptap core](https://github.com/ueberdosis/tiptap/blob/main/packages/core/package.json),
[Lexical core](https://github.com/facebook/lexical/blob/main/packages/lexical/package.json),
[GenOffice manifest](https://github.com/genspark-ai/genoffice/blob/main/package.json).

Vela foi comparado com a revisão fixada 175d54f e o README atual da main.
O projeto usa VelaApp, config.settings, registro de app, views/API descobertas,
BaseBridge, template engine e collectstatic; esse contrato será preservado.


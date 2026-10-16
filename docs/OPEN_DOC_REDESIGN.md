# Open Doc — redesign e consolidação

Baseline: `fdf46aabc8655cc65061f5804e2cce2bb7e776f1` (main).
Release: 0.3.0. O HEAD de encerramento é registrado no histórico do repositório.
Nenhum reset foi feito; a implementação continua o código e o banco existentes.

## Antes e problemas

A interface anterior usava branding de protótipo, sidebar com fases futuras,
roxo/teal, fonte e preview divididos. A estrutura Vela estava integrada, mas a
experiência era de notas e não de documentos. Comandos e UI estavam concentrados;
CSS manual e saída compilada tinham a mesma fonte. A migração do produto ainda
não existia. O baseline passou 23 testes Python/10 JS, o que não demonstrava
adequação visual nem cobertura completa de seleção/clipboard no Qt.

[Baseline real 1366](images/open-doc/baseline-1366.png).

## Decisões e implementação

- Nome Open Doc em janela, templates e documentação; app `apps/open_doc`,
  APIs `/api/open_doc/`, bridge `OpenDocBridge` e factories JS OpenDoc.
- Layout de processador de documentos: header 36 px, menu 28, toolbar 40,
  régua 22, status 24; navegador 228 px. Papel branco com largura A4,
  mesa neutra, azul apenas em ações/foco, cantos retos e sombras discretas.
- Tema light/dark/system e zoom 50–150 persistem; papel segue branco.
- Menu clássico com ações reais, setas, Escape, fechamento externo e foco.
- Editor visual padrão. Markdown e preview são vistas avançadas exclusivas.
- Outline deriva de headings reais e navega para o título; busca literal local.
- Home mostra título/data/tipo reais do SQLite e arquivos importados.
- Sem avatar, compartilhar, colaboração, metas, telemetria ou painel falso.
- Fonte/tamanho/cor/alinhamento/sublinhado não são controles expostos porque
  o modelo Markdown não preserva tais atributos de forma garantida.

## Engine, paginação e referências

A [pesquisa](EDITOR_REFERENCE_RESEARCH.md) examinou os projetos indicados:
Eigenpal mirror, WebODF, Kotype, Wodo, Scribe, slate-editor, modern-editor,
Premirror, ONLYOFFICE, GenOffice, ProseMirror, Tiptap, Slate, Lexical e Vela.
Licenças/estado e fontes primárias estão registrados. Referências são de
arquitetura e UX; não foram importadas dependências ou código desses engines.

A [decisão do engine](EDITOR_ENGINE_DECISION.md) mantém Markdown/SQLite e
melhora contenteditable. execCommand fica exclusivamente em editor_commands.js,
com Selection Range/bookmarks. history.js oferece undo/redo limitado e agrupado;
recovery.js migra storage sem apagar uma entrada antes da cópia válida.
O renderer é contínuo, com largura A4, altura mínima e régua informativa.
Não há contagem fictícia de páginas nem promessa de equivalência ao Word/PDF.

## Componentes e cleanup

| Camada | Arquivos principais |
|---|---|
| Dados/migração | app/workspace.py, app/config.py, app/editor.py |
| Integração Vela | config/wsgi.py, apps/open_doc, app/bridge.py, app/router.py |
| Templates | base, menus, toolbar, sidebar, editor e home em apps/open_doc/templates |
| Lifecycle/arquivos | app.js |
| Editor/seleção/histórico | editor.js, editor_commands.js, history.js |
| Recovery | recovery.js |
| Navegação/tema/layout | navigation.js, theme.js, paper_layout.js |
| CSS fonte | ui/styles/tokens, shell, menus, toolbar, document e home |
| Build/estáticos | tools/build_css.py, tools/sync_frontend.py |
| QA real | tools/qa_desktop.py, tools/qa_capture.cjs |

Removidos o namespace antigo de apps, o CSS anterior, elementos de fases,
assets de screenshots redundantes e dependências python-pptx/pdf2image sem uso.
As cópias geradas de estáticos antigos são limpas na sincronização; ui é a
única fonte visual versionada. O manifest e o bundle do shell vêm do Vela.

## Branding/dados

`~/VelaWriter/` é copiado para `~/OpenDoc/` somente quando o destino não existe.
O original fica intacto. O SQLite é copiado pela API backup, incluindo WAL
commitado. Notas, documentos, exports e settings seguem na cópia. Se ambos
existem, não há merge/overwrite; o resultado é registrado em migration.json.
Banco inválido não publica migração parcial; symlinks exigem intervenção manual.
O nome físico writer.sqlite3 fica por compatibilidade, sem alterar o schema.
Cache antigo vela-writer-recovery é lido/migrado para open-doc-recovery.
Testes cobrem cópia, coexistência, WAL, falha, defaults e persistência do tema.

## Matriz final

| Recurso | Estado | Evidência |
|---|---|---|
| Branding/namespace | TESTED | teste de templates + janela Qt |
| Workspace e recovery legado | TESTED | testes de migração/JS |
| Novo, renomear, recentes e sessão | TESTED | Python, JS, smoke Qt |
| Salvar/autosave/revisões/conflito | TESTED | testes antigos preservados e Qt |
| Recovery, salvar cópia | TESTED | SQLite/cache e regressões |
| Menus e atalhos | TESTED | DOM, teclado Qt real |
| Seleção/bold/italic/undo/redo | TESTED | Range + comandos na janela Qt |
| Clipboard Ctrl+A/C/X/V | TESTED em Qt Linux offscreen | QTest no focusProxy; conteúdo validado |
| Ctrl+Z/Y/Shift+Z/S | TESTED em Qt Linux offscreen | QTest e estado salvo |
| Preview sanitizado/tabelas | TESTED | regressões JS |
| PDF/DOCX/Markdown | TESTED | arquivos exportados, relidos e smoke Qt |
| Outline/busca/zoom/tema | TESTED | JS + renderer Qt |
| Importação de arquivos | TESTED serviço; PARTIAL físico | validação/cópia testadas; diálogo não operado fisicamente |
| Régua e folha contínua | IMPLEMENTED/TESTED | medidas do renderer, sem handles falsos |
| Paginação Word/OOXML round-trip | UNSUPPORTED | não expostos como implementados |
| Windows/hardware real | PARTIAL | ainda não testados nesta sessão |

## Validação executada

- 29 testes Python, 18 testes JavaScript aprovados.
- Black 88 colunas, compileall e sintaxe JS verificados.
- build_css e collectstatic --no-tailwind executados.
- Runtime real VelaApp/BaseBridge, servidor e janela Qt/PyQt5.
- Tema claro e escuro, 1366×768 / 1600×900 / 1920×1080.
- app ocupa a viewport inteira, sem overflow horizontal global em todas.
- Zoom 150% não gera overflow global; scroll permanece no canvas.
- Novo/recentes, salvar, PDF/DOCX/MD e fechamento testados.
- Qt offscreen emite aviso de primary-selection clipboard não suportada;
  copiar/recortar/colar do clipboard normal foi validado por conteúdo.
- Nenhum documento do usuário foi usado: capturas usam fixture temporária
  identificada como Documento de validação.

## Capturas reais QtWebEngine/Vela

| Tela | 1366 | 1600 | 1920 |
|---|---|---|---|
| Claro | [PNG](images/open-doc/editor-light-1366.png) | [PNG](images/open-doc/editor-light-1600.png) | [PNG](images/open-doc/editor-light-1920.png) |
| Escuro | [PNG](images/open-doc/editor-dark-1366.png) | [PNG](images/open-doc/editor-dark-1600.png) | [PNG](images/open-doc/editor-dark-1920.png) |

[Home](images/open-doc/home-light-1366.png) · [Menu Arquivo](images/open-doc/file-menu-1366.png).

## Limitações restantes

Sem edição direta de DOCX/PDF, layout paginado determinístico, tipografia
arbitrária, colaboração ou nuvem. Paste rico vira texto simples. Undo é limitado
por quantidade/memória e não substitui versionamento persistente. Recovery tem
janela de 600 ms. PDFs usam fonte latina; CJK/emoji completos não são garantidos.
Busca é literal e oferece até 30 destinos. O engine legado continua exigindo
regressões no WebView. Validação nativa foi em Linux/Qt offscreen; não houve
Windows, caneta/mesa digitalizadora ou teste físico do seletor de importação.


### Compatibilidade de lifecycle no Qt 5.15

O renderer real ignorava EventListenerOptions.signal, mesmo que o teste DOM
moderno aceitasse a opção. compat.js detecta esse comportamento e instala
remoção explícita no abort do controller somente quando necessário.
O QA navega novamente pela rota Vela e aplica formatação depois do remount,
validando teardown no Chromium real. Há teste JS do caminho de compatibilidade.

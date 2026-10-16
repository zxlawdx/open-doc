# Contribuindo com Open Doc

Use Python 3.10+; dependências em requirements-dev.txt. Node serve apenas ao
build e aos testes. Rode pytest, os testes Node, Black (88 colunas) e o QA Qt
antes de alterar o engine. Veja comandos completos no README.

## Contratos

- Preserve VelaApp, registro de apps/open_doc, template engine, BaseBridge,
  collectstatic e lifecycle. Nenhuma janela/servidor paralelo.
- Fontes visuais em ui/templates, ui/static/js e ui/styles. main.css é gerado;
  edite arquivos de ui/styles e rode python tools/build_css.py.
- Cópias apps/open_doc/static e staticfiles não são fontes/versionadas.
- Menu/toolbar visível exige handler, serialização preservada e teste.
- Documentos antigos, revisões, recuperação e backups não podem ser descartados.
- execCommand fica somente no adapter editor_commands.js; seleção/history
  precisam de teste no Qt real, pois DOM tests não equivalem ao WebView.
- Listeners/timers/observers devem ser removidos ao desmontar a view Vela.
- Markdown é canônico; recursos que exijam modelo estruturado precisam de
  migração versionada e teste de notas existentes.
- CSS é composto por tokens, shell, menus, toolbar, documento e home. Sem CDN,
  gradientes decorativos, icon fonts remotas ou controles fictícios.
- API de alteração exige credencial da bridge. Caminhos de exportação são
  decididos pelo backend. Nunca aceite um caminho arbitrário do frontend.

Commits em português; um arquivo criado por commit. Leia o conteúdo remoto
antes de sobrescrever. Não versione banco, dados pessoais, segredos ou builds.

## QA

Testes Python e JS não substituem a sessão Qt. Verifique 1366×768, 1600×900 e
1920×1080, claro/escuro, menus por teclado, seleção/foco após comandos,
recuperação, save concorrente, notas grandes, zoom e encerramento.
Use tools/qa_desktop.py e tools/qa_capture.cjs para capturas do renderer real.
O workspace temporário do smoke não contém documentos do usuário.
Registro completo e limitações em OPEN_DOC_REDESIGN.md.

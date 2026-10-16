# Contribuindo com Open Doc

Use Python 3.10+; dependências em requirements-dev.txt. Node serve apenas ao
build e aos testes. Rode pytest, os testes Node, Black (88 colunas) e o QA Qt
antes de alterar o engine. Veja comandos completos no README.

## Contratos

- Preserve VelaApp, registro de apps/open_doc, template engine, BaseBridge,
  collectstatic e lifecycle. Nenhuma janela/servidor paralelo.
- Fontes visuais em apps/open_doc/templates, apps/open_doc/static/js e apps/open_doc/styles. main.css é gerado;
  edite arquivos de apps/open_doc/styles e rode python tools/build_css.py.
- apps/open_doc/static contém assets versionados; staticfiles é saída gerada. Nunca edite main.css manualmente.
- Menu/toolbar visível exige handler, serialização preservada e teste.
- Documentos antigos, revisões, recuperação e backups não podem ser descartados.
- execCommand fica somente no adapter editor_commands.js; seleção/history
  precisam de teste no Qt real, pois DOM tests não equivalem ao WebView.
- Listeners/timers/observers devem ser removidos ao desmontar a view Vela.
- Documentos ricos usam opendoc-rich-v1; preserve migração, recovery e Markdown legado.
- CSS segue STYLE_ORDER em tools/build_css.py: fundamentos, componentes, documento, estados e responsividade. Rode tools/audit_css.py. Sem CDN,
  gradientes decorativos, icon fonts remotas ou controles fictícios.
- API de alteração exige credencial da bridge. Caminhos de exportação são
  decididos pelo backend. Nunca aceite um caminho arbitrário do frontend.

Commits em português; um arquivo criado por commit. Leia o conteúdo remoto
antes de sobrescrever. Não versione banco, dados pessoais, segredos ou builds.

## QA

Testes Python e JS não substituem a sessão Qt. Verifique 720×600, 900×650, 1280×720, 1366×768, 1600×900 e
1920×1080, claro/escuro, menus por teclado, seleção/foco após comandos,
recuperação, save concorrente, notas grandes, zoom e encerramento.
Use tools/qa_desktop.py e tools/qa_capture.cjs para capturas do renderer real.
O workspace temporário do smoke não contém documentos do usuário.
Registro completo e limitações em OPEN_DOC_REDESIGN.md.

QA visual responsivo: `python tools/qa_styles.py`. Arquitetura, capturas e limites
em [OPEN_DOC_STYLES.md](OPEN_DOC_STYLES.md).

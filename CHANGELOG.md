# Changelog

Formato baseado em Keep a Changelog. Versões da aplicação seguem SemVer.

## [0.3.0] - 2026-10-15

### Alterado

- Produto renomeado para Open Doc, app Vela apps/open_doc e API /open_doc.
- Interface refeita como processador de documentos: papel branco, menu clássico,
  toolbar compacta, estrutura, busca, documentos recentes, status e zoom.
- Tema claro/escuro/sistema persistente; Markdown passa a ser opção avançada.
- CSS fonte separado do bundle; comandos/seleção/history e módulos de UI separados.

### Adicionado

- Migração não destrutiva do workspace legado, com backup SQLite e relatório.
- Compatibilidade de recovery storage, export Markdown e histórico limitado.
- Régua informativa, QA real Qt e capturas light/dark nas três resoluções.

### Corrigido

- Seleção/foco após toolbar, undo/redo, preferências antigas e assets coletados.
- Removidos branding antigo, recursos futuros cenográficos e dependências sem uso.

## [0.2.0] - 2026-10-15

### Adicionado

- Editor Markdown e texto rico com preview local sanitizado.
- Notas persistentes em SQLite, sessão e controle otimista de revisões.
- Autosave de 30 segundos, recuperação persistente e atalhos de teclado.
- Exportação PDF Unicode e DOCX com estrutura Markdown.
- Testes de backend, frontend e verificação no QtWebEngine real.

### Corrigido

- Inicialização agora usa VelaApp.run e o CLI oficial do Vela.
- Registro de apps, views, templates e BaseBridge segue o contrato do framework.
- Estáticos e shell offline usam o collectstatic e o pipeline Tailwind do Vela.
- Compatibilidade de marked.js e altura da janela com QtWebEngine 5.15.
- Confirmação de fechamento usa o mecanismo nativo sem bloquear a thread Qt.

## [0.1.0] - 2026-10-15

### Adicionado

- Fundação do workspace, importação por tipo, preferências e scaffold da UI.

# Auditoria Open Doc

Baseline: `fdf46aabc8655cc65061f5804e2cce2bb7e776f1`, main, working tree
limpo antes da intervenção. 23 testes Python e 10 JS passaram. Aplicação
executada pelo VelaApp/QtWebEngine; captura baseline-1366.png registrada.

| Área | Implementação real | UI anterior | Handler/API | Teste baseline | Estado |
|---|---|---|---|---|---|
| Novo/renomear | SQLite, UUID, título | Sidebar/input | document/new/save | Python e JS | WORKING |
| Salvar/autosave | Transação, revisão, 30s | Botão/atalho | document/save | Python e JS | WORKING |
| PDF | fpdf2, Unicode, tabelas | Botão | document/export | Python + Qt | WORKING |
| DOCX | python-docx, tokens | Botão | document/export | Arquivo relido | WORKING |
| Importar | Cópia exclusiva e assinatura | Seletor nativo | BaseBridge | Serviço testado; diálogo não físico | PARTIAL |
| Recuperação | SQLite + cache do WebView | Banner | document/recovery | Python e JS | WORKING |
| Sessão/recente | Documento ativo e lista SQLite | Biblioteca | document/open | Python | WORKING |
| Rico | contenteditable, Turndown, execCommand | Modo secundário | editor.js | DOM e alternância Qt | PARTIAL |
| Preview | marked + DOMPurify | Divisão predominante | editor.js | JS e Qt | WORKING |
| Seleção/undo | Dependência do browser, sem adapter | Toolbar | execCommand | Sem cobertura nativa suficiente | PARTIAL |
| Vela | VelaApp, BaseBridge, registro de app | Shell blank | config/wsgi | Lifecycle real | WORKING |
| Tema/zoom/outline | Ausentes | Ausentes | Ausentes | Ausentes | BROKEN para o novo escopo |

Problemas: identidade inadequada; recursos futuros expostos; CSS misturando
fonte e saída Tailwind; responsabilidades concentradas; rich editor em segundo
plano; sem navegação estrutural; workspace/namespace antigos. Nenhum engine
OOXML ou paginação fiel foi implementado: não podem ser reivindicados.

## Classificação da busca global

- Branding em templates, README, APP_TITLE e docstrings: migrar para Open Doc.
- apps/writer, APIs /writer, classes WriterBridge/WriterEditor: migrar open_doc.
- VelaWriter e vela-writer-recovery: manter somente para compatibilidade de dados.
- writer.sqlite3: preservar nome físico como compatibilidade do banco existente.
- Changelog e baseline: documentação histórica; não representam a UI final.
- Fases/NO HORIZONTE, cards, gradientes e CSS antigo: remover da interface.
- Palavra inglesa writer em licenças de fontes: texto legal, não branding.

Matriz final e novas validações serão consolidadas em OPEN_DOC_REDESIGN.md.

# Open Doc

Open Doc é um editor de documentos desktop local-first construído com o Vela Framework.
O editor visual abre numa folha branca, com menus clássicos, estrutura de títulos,
busca local e ferramentas de formatação. Sem conta, nuvem ou CDN.

![Open Doc no Vela/Qt — tema claro](docs/images/open-doc/editor-light-1366.png)

## Executar

Requer Python 3.10+, Git, dependências Qt e uma sessão gráfica.

```powershell
git clone https://github.com/zxlawdx/open-doc.git
cd open-doc
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py collectstatic --no-tailwind
python manage.py runapp
```

Para atualizar um clone existente, use `git pull origin main` antes de instalar.
No Linux/Mint, ative com `source .venv/bin/activate`. QtWebEngine precisa das
bibliotecas gráficas do sistema (Xtst, NSS, X11, xkbcommon, EGL e áudio).
`python main.py` usa o mesmo bootstrap oficial Vela.

## Recursos reais

- Criar, renomear, reabrir e listar documentos recentes a partir do SQLite.
- Editor visual padrão; código Markdown e preview sanitizado em Exibir.
- Títulos, negrito, itálico, listas, citações, código e links HTTP/HTTPS/mailto.
- Seleção preservada na toolbar; desfazer/refazer com histórico limitado.
- Salvamento manual, Ctrl+S e autosave a cada 30 segundos.
- Revisões transacionais, conflitos sem sobrescrita e salvar como cópia.
- Recuperação SQLite após pausa de digitação de 600 ms e cache auxiliar local.
- Biblioteca: importação de cópias PDF/DOCX/PPTX/Markdown/TXT; Markdown e TXT
  podem ser abertos como documentos editáveis. Os originais são preservados.
- Exportar PDF, DOCX e Markdown para `~/OpenDoc/exports/`.
- Outline de títulos navegável e busca textual local.
- Zoom real entre 50% e 150%, régua informativa e temas claro/escuro/sistema.
- Confirmação nativa de fechamento se houver alterações pendentes.

Ctrl+N cria, Ctrl+O importa, Ctrl+F localiza, Ctrl+B e Ctrl+I formatam,
Ctrl+Z desfaz, Ctrl+Y ou Ctrl+Shift+Z refaz. Copiar, colar, recortar e selecionar
usam os atalhos do sistema. Menus têm navegação por setas, Escape e foco visível.

## Layout e limites

A folha tem largura A4 (794 px a 100%) e altura mínima A4. O texto cresce em
**fluxo contínuo**: não há divisão artificial em páginas nem contador fictício.
A régua informa centímetros/margens; não oferece handles arrastáveis.
O dark mode escurece a interface e mantém o papel branco.

Markdown continua sendo o formato canônico. Fonte arbitrária, tamanho, cor,
sublinhado e alinhamento não são expostos porque o modelo não os preserva
com fidelidade. `contenteditable`/execCommand continuam encapsulados num adapter;
a dívida técnica está documentada. Não há edição direta ou round-trip OOXML.

Os exportadores preservam estrutura básica, títulos, listas, tabelas, código,
negrito e itálico. Não se promete fidelidade Word nem correspondência exata de
páginas entre a tela e o PDF. Imagens remotas não são carregadas; na exportação,
referências a imagens viram texto alternativo. HTML bruto é limitado/sanitizado.
A fonte PDF cobre português e caracteres latinos; CJK/emoji completos exigem
fontes adicionais. Colagem rica é convertida em texto simples nesta versão.
Busca é literal e mostra até 30 resultados navegáveis, além do total encontrado.

## Dados e migração segura

O diretório padrão é `~/OpenDoc/`, com `documents/`, `notes/`, `drawings/`,
`exports/` e `.veladata/`. O banco mantém o nome físico `writer.sqlite3` por
compatibilidade: ele contém documentos, sessão ativa, revisões e recuperação.
Preferências ficam em `.veladata/settings.json`.

Se existe `~/VelaWriter/` e `~/OpenDoc/` ainda não existe, a aplicação copia os
dados e usa a API de backup SQLite para preservar conteúdo commitado em WAL.
**O diretório antigo não é removido.** Se ambos existem, usa OpenDoc sem mesclar
ou sobrescrever; registre/resolva a migração antes de remover qualquer backup.
Resultado em `.veladata/migration.json`. Falhas não publicam workspace parcial;
links simbólicos no legado exigem cópia manual dos dados sem links.

O cache aceita temporariamente a chave antiga `vela-writer-recovery:` e migra
para `open-doc-recovery:`. A recuperação SQLite não depende da porta escolhida
pelo Vela. Forçar encerramento nos últimos 600 ms pode perder as teclas mais
recentes; Ctrl+S aguarda a persistência atual. Para backup, feche o app e copie
OpenDoc inteiro. A API é local e exige token para alterações.

## Arquitetura Vela

`manage.py` delega ao CommandRunner do framework. `config/wsgi.py` instancia
VelaApp com `config.settings`, registra `apps.open_doc`, descobre views/API e
executa o lifecycle oficial. OpenDocBridge estende BaseBridge. Templates usam
`render_template` do Vela e layout blank, ocupando toda a WebView.

Não há servidor ou janela paralela. `ui/` é a fonte; sync_frontend prepara
`apps/open_doc/static/` e executa o collectstatic oficial. As cópias e staticfiles
são geradas/ignoradas. `ui/styles/` separa tokens, shell, menus, toolbar, papel
 e home; `main.css` é somente saída de build, incluindo utilitários do shell Vela.

## Desenvolvimento e validação

```powershell
python -m pip install -r requirements-dev.txt
npm ci
python -m pytest -q
node --test tests/editor.test.cjs
python -m black --check --line-length 88 app apps config tools tests main.py manage.py
node --check ui/static/js/app.js
python tools/build_css.py
python manage.py collectstatic --no-tailwind
python manage.py runapp
```

CSS e vendors já estão versionados; Node não é necessário para usar o app.
`python tools/qa_desktop.py` executa smoke test com workspace temporário e
capturas reais pelo QtWebEngine; requer Node 22+ para CDP local. Nunca exponha
a porta de debugging no uso normal. O script usa a janela criada pelo VelaApp.

Validação desta entrega: **29 testes Python + 17 testes JS**; smoke real em
Linux/Qt/PyQt5, seleção + bold/italic, undo/redo, salvar, exportações relidas,
recentes, novo documento e encerramento. Capturas light/dark em 1366×768,
1600×900 e 1920×1080, sem overflow global. Windows/hardware físico e o diálogo
nativo de importação interativo permanecem sem validação física.

## Documentação

- [Auditoria e baseline](docs/OPEN_DOC_AUDIT.md)
- [Pesquisa de referências](docs/EDITOR_REFERENCE_RESEARCH.md)
- [Decisão do engine](docs/EDITOR_ENGINE_DECISION.md)
- [Redesign, matriz de regressão e capturas](docs/OPEN_DOC_REDESIGN.md)
- [Contribuição](docs/CONTRIBUTING.md)

## Licenças

Aplicação MIT; Vela MPL-2.0. Inter/JetBrains Mono SIL OFL. marked/Turndown MIT;
DOMPurify Apache-2.0/MPL-2.0. Licenças preservadas junto aos vendors.
Nenhum código de ONLYOFFICE/WebODF/engines pesquisados foi incorporado.

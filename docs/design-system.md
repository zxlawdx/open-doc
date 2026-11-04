# Open Doc — identidade visual inspirada em Ofício Aberto

## Escopo

Esta implementação adapta a linguagem visual das **oito telas de referência**
fornecidas pelo usuário (Início, DOCX, PDF, PPTX para mobile/web) ao **Open Doc**,
que continua sendo uma aplicação desktop baseada no **Vela Framework**.

Os exemplos HTML originais são protótipos estáticos. Seus estados de Nextcloud,
inteligência artificial, assinatura ICP-Brasil, edição avançada PPTX, OCR por
câmera e colaboração remota não são interpretados como funcionalidades
implementadas. O aplicativo exibe o estado real de armazenamento **local**.

## Componentes e responsabilidades

| Componente | Local | Responsabilidade |
| --- | --- | --- |
| Tokens semânticos | `styles/tokens.css` + `styles/oficio_design.css` | Cores, tipografia, dimensões, elevação e contraste claro/escuro |
| CSS de componentes | `styles/oficio_design.css` | Cabeçalho, quickbar, biblioteca, ícones, formulários e PDF |
| CSS responsivo | `styles/responsive.css` | Breakpoints de desktop, janela estreita e navegação compacta |
| Biblioteca | `templates/home.html` + `design_system.js:LibraryView` | Pesquisa, filtros e ícones sobre arquivos **reais** |
| Criação rápida | `QuickCreateMenu` | Abre/fecha popover acessível e delega criação/importação existentes |
| Editor e PDF/PPTX | `DocumentChrome` | Visualização de modos e ferramentas, sem substituir comandos de negócio |
| Composer | `DesignSystem` | Inicializa os controllers e isola apresentação do modelo |
| Backend/runtime | `config/wsgi.py`, `vela.cli`, `apps/open_doc` | **Inalterados**: abertura, salvamento, exportação e processos reais |

`app.js` continua sendo o ponto de montagem no WebView Vela e delega todos
os comandos já existentes para `OpenDocEditor`/`OpenDocDocumentKinds`.
`design_system.js` usa classes para gerenciar apenas aspectos visuais, sem
persistência redundante. Eventos são registrados com `AbortSignal` e o
observer é liberado ao desmontar a página.

## Ícones e operação offline

Todos os ícones ficam no sprite SVG local
`apps/open_doc/static/icons.svg`. A tipografia Inter vem dos assets locais.
Não existe importação de Google Fonts, CDN Tailwind ou scripts remotos.

A geração das classes de CSS de apresentação está em
`tools/build_css.py`, que usa o build do Vela. Para o computador corporativo
sem Node/npm, a base Tailwind compilada e versionada é preservada no
`static/css/main.css`. Após atualizar:

```powershell
git pull --ff-only origin main
python tools/offline_assets.py prepare
python manage.py runapp
```

Para mudanças no Tailwind e em dependências JS, utilize o build normal em
ambiente autorizado com Node.js; alterações apenas nos módulos CSS têm
suporte no processo offline.

## Regras de projeto

- Nunca renderizar listas fictícias ou indicadores de sincronização inexistentes.
- Preservar seletores `data-action`, `data-new`, `data-import`,
  `data-command`, `data-export`, `data-ink-mode`.
- Nunca modificar `VelaApp`, `startproject`, `config/wsgi.py` ou o roteamento
  para aplicar o tema.
- Utilizar HTML semântico, ARIA, navegação por teclado e `:focus-visible`.
- Testar filtro/pesquisa e modo página/fluxo em `tests/design_system.test.cjs`.
- Sempre executar as suítes JS/Python e smoke Qt em Windows e Linux.

## Funcionalidades ainda fora deste redesenho

O protótipo descreve recursos que devem ser tratados em tickets separados:
OCR de câmera, edição nativa avançada de elementos PPTX, colaboração
remota/Nextcloud, assinatura digital ICP-Brasil e assistente de IA local.
O redesenho **não inventa operações** para esses botões.

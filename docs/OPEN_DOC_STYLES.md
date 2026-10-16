# Refatoração dos styles — Open Doc

HEAD inicial: `66fc2bae0221a6a7f1d53c3d8e4a563827e140ed`.
O HEAD final é identificado no commit de encerramento e na entrega. Este relatório
trata somente da camada visual; os serviços, modelos, persistência e runtime Vela
foram preservados.

## Arquitetura e build

Antes havia seis arquivos, com resets, navegação, statusbar e header misturados em
shell.css; document.css acumulava chrome, páginas, conteúdo e popovers. Toolbar
continha definições conflitantes de altura/wrap. Havia aliases inexistentes
`--panel-bg` e `--text`, com fallback claro nos menus de página/tabela.

Agora `apps/open_doc/styles` possui ordem explícita:

| Grupo | Arquivos |
|---|---|
| Fundamentos | tokens.css, base.css |
| Layout | shell.css, header.css, navigator.css, workspace.css, statusbar.css |
| Componentes | menus.css, dialogs.css, toolbar.css, home.css, library.css |
| Documento | pages.css, document-content.css |
| Política e estados | states.css, responsive.css, utilities.css |

`document.css` foi removido. Cada componente tem uma definição principal;
variantes de estado e viewport são intencionais. Source é legível, uma declaração
por linha. `main.css` é gerado exclusivamente por `tools/build_css.py`, seguido do
collectstatic oficial. Não se edita staticfiles nem se substitui o bundle do shell.

Os tokens cobrem superfícies, texto, bordas, ação principal/hover/active, danger,
cores imutáveis do papel, fontes, escalas tipográfica/espacial, controles, larguras,
alturas, raios, sombras, foco, motion, layers, dimensões padrão e intervalo de páginas.
Tokens antigos foram migrados, incluindo referências em estilos gerados pelo JS.
`tools/audit_css.py` detecta referências sem declaração, mesmo com fallback.
Há teste que injeta um token inexistente para verificar a detecção.

As cores dos componentes não dependem de hardcodes claros. O dark mode só altera
tokens de tema; papel, tinta e realces de conteúdo mantêm valores próprios. Os
valores tipográficos/espaciais específicos do conteúdo Word continuam explícitos
em document-content.css para preservar as métricas anteriores do documento.

## Comportamento responsivo

| Viewport | Política |
|---|---|
| ≥1440 | Toolbar em uma linha preferencial, grupos indivisíveis |
| 1100–1439 | Compactação leve de larguras/gaps; scroll se necessário |
| 900–1099 | Uma faixa com scroll horizontal controlado |
| <900 | Faixa compacta com scroll; páginas preservam dimensões lógicas |
| ≤959 | Navegador de 180px; idioma/modo cedem espaço na statusbar |
| ≤719 | Padding reduzido, menubar com scroll, metadata secundária oculta |
| ≤479 | Nome do produto cede ao ícone; título ativo permanece visível |
| Altura ≤640 | Espaçamento vertical compacto da biblioteca/navegação |

Breakpoints centralizados: 1439, 1199, 959, 719 e 479px; altura 640px.
`prefers-reduced-motion` elimina as transições de controles. Não há requisito de
@layer, nesting, :has, container queries ou subgrid. Os estilos foram executados
no QtWebEngine 5.15 / Chromium 87.

Em 720×600 e 900×650 a toolbar não cria múltiplas linhas e a folha usa scroll do
canvas. Em 1366×768 e 1920×1080 os controles cabem na faixa, com espaço distribuído
entre grupos explícitos. Também foram medidas 1280×720 e 1600×900. Nas seis
resoluções não houve overflow global do body/root, dropdown ou diálogo fora da
janela; título ativo, Página X de Y e zoom permaneceram dentro dos limites.
480/640px receberam verificação adicional de bounds, sem prioridade de redesign móvel.

## Componentes

- **Home:** largura máxima de 1040px, margens previsíveis e espaçamento vertical
  adaptativo. Mantém a biblioteca do produto, sem novos cards ou hero promocional.
- **Biblioteca:** grid ícone / informação flexível / tipo / ação. Títulos longos
  usam ellipsis, com nome completo em title; metadata não empurra o menu.
- **Ações de documento:** trigger de 30px e superfície própria com Renomear,
  Duplicar, separador e Excluir em danger. Continua usando os handlers existentes.
  Fecha ao clicar fora, escolher ação, rolar ou pressionar Escape; setas/Home/End
  navegam os itens e Escape devolve foco ao trigger.
- **Popovers:** menus principais, documentos, página e tabela compartilham tokens,
  item heights, borda, sombra e estados. `popovers.js` mede a superfície real,
  limita às bordas e inverte verticalmente quando necessário. A posição é fixed
  para escapar do clipping dos contêineres com scroll. `data-align` registra a
  escolha de alinhamento. Redimensionamento fecha menus de documentos e reencaixa
  os demais.
- **Header:** status possui slot de largura estável e ellipsis; título ocupa a
  área flexível e nunca é ocultado. Busca fica à direita.
- **Toolbar:** grupos history, paragraph, basic-inline, lists, link, font,
  font-size, decoration, colors, alignment, spacing, indent e table. Preservados
  todos os contratos data-* de comandos, inputs, seleção e toolbar.
- **Navigator:** estados expandido/colapsado, conteúdo com scroll próprio e
  controles de localizar/substituir normalizados. Sem overlay novo.
- **Páginas:** proporção e medidas de Section não mudam com a janela. Sem cortes
  de conteúdo para simular responsividade. Sombra/gap/chrome separados da tipografia.
- **Statusbar:** grupos esquerdo/direito, prioridade a página e zoom; depois modo,
  palavras e idioma. Metadados cedem espaço segundo a largura.
- **Dialogs:** largura e altura limitadas ao viewport, scroll interno para page
  setup e gerenciamento de fontes. Foco visível e controles coerentes com menus.

Usos de !important ficam restritos ao padding de integração do Vela e ao contrato
[hidden], ambos comentados. O foco possui fallback :focus e variante :focus-visible.

## Validação

- **68 testes Python**, incluindo estrutura, tokens, ordem de build e detecção de
  token ausente, além das regressões de persistência/DOCX/exportação/fontes.
- **35 testes JS**, incluindo bounds/inversão de popovers e navegação/fechamento
  das ações da biblioteca; seleção, toolbar, páginas e history continuam cobertos.
- Black 88; audit_css; sintaxe de app/menus/page_menu/pagination/popovers.
- Build CSS e collectstatic oficial; main.css contém exatamente os fontes na
  ordem declarada após o bundle compilado.
- **QA Vela/Qt real:** matriz de seis resoluções, claro/escuro, Home, ações de
  documento abertas, editor longo, Arquivo, configuração de página e toolbar.
  Renomear/duplicar/excluir executados na biblioteca; menus de página/tabela perto
  das bordas medidos dentro da janela.
- QA funcional completo: importação DOCX, fontes, formatação, célula editada por
  QTest, save/export/reopen, segunda instância, Ctrl+Enter, undo/redo, clipboard,
  paginação longa com tabelas e preservação do DOM anterior no reflow.
  O documento DOCX fornecido pelo usuário também passou pelo round-trip.

As capturas são do Qt real em workspace temporário com documentos sintéticos,
sem dados pessoais. Os seletores nativos têm somente sua escolha substituída no
QA funcional; a aplicação continua usando bridge e runtime reais.

## Capturas

| Largura | Home | Ações | Editor | Arquivo | Dialog | Escuro |
|---|---|---|---|---|---|---|
| 720 | [Home](images/open-doc/styles-home-720.png) | [Menu](images/open-doc/styles-home-menu-720.png) | [Editor](images/open-doc/styles-editor-720.png) | [Arquivo](images/open-doc/styles-file-menu-720.png) | [Dialog](images/open-doc/styles-dialog-720.png) | [Escuro](images/open-doc/styles-dark-home-menu-720.png) |
| 900 | [Home](images/open-doc/styles-home-900.png) | [Menu](images/open-doc/styles-home-menu-900.png) | [Editor](images/open-doc/styles-editor-900.png) | [Arquivo](images/open-doc/styles-file-menu-900.png) | [Dialog](images/open-doc/styles-dialog-900.png) | [Escuro](images/open-doc/styles-dark-home-menu-900.png) |
| 1280 | [Home](images/open-doc/styles-home-1280.png) | [Menu](images/open-doc/styles-home-menu-1280.png) | [Editor](images/open-doc/styles-editor-1280.png) | [Arquivo](images/open-doc/styles-file-menu-1280.png) | [Dialog](images/open-doc/styles-dialog-1280.png) | [Escuro](images/open-doc/styles-dark-home-menu-1280.png) |
| 1366 | [Home](images/open-doc/styles-home-1366.png) | [Menu](images/open-doc/styles-home-menu-1366.png) | [Editor](images/open-doc/styles-editor-1366.png) | [Arquivo](images/open-doc/styles-file-menu-1366.png) | [Dialog](images/open-doc/styles-dialog-1366.png) | [Escuro](images/open-doc/styles-dark-home-menu-1366.png) |
| 1600 | [Home](images/open-doc/styles-home-1600.png) | [Menu](images/open-doc/styles-home-menu-1600.png) | [Editor](images/open-doc/styles-editor-1600.png) | [Arquivo](images/open-doc/styles-file-menu-1600.png) | [Dialog](images/open-doc/styles-dialog-1600.png) | [Escuro](images/open-doc/styles-dark-home-menu-1600.png) |
| 1920 | [Home](images/open-doc/styles-home-1920.png) | [Menu](images/open-doc/styles-home-menu-1920.png) | [Editor](images/open-doc/styles-editor-1920.png) | [Arquivo](images/open-doc/styles-file-menu-1920.png) | [Dialog](images/open-doc/styles-dialog-1920.png) | [Escuro](images/open-doc/styles-dark-home-menu-1920.png) |

Também há capturas individuais de [páginas](images/open-doc/styles-editor-pages.png),
[DOCX importado](images/open-doc/styles-imported-docx-1366.png),
[menu de página](images/open-doc/styles-page-menu.png) e
[menu de tabela](images/open-doc/styles-table-menu.png).
Os estados dark-editor e dark-menu também estão registrados nas seis larguras.

## Limitações

O QA nativo foi executado no Linux, com Qt5.15. A aparência do seletor nativo,
renderização de fontes e dimensões de controles podem variar no Windows; a
validação física nessa plataforma permanece necessária. Janelas estreitas usam
scroll horizontal deliberado na toolbar e no canvas; não há reorganização móvel
ou deformação das páginas. Os limites de fidelidade DOCX/PDF e paginação descritos
em OPEN_DOC_VELA_PHASE2.md permanecem os mesmos; esta entrega não altera essas regras.

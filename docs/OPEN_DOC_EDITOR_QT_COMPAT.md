# Compatibilidade e funcionalidade do editor Qt

Base: `a91ac26a6bf6b59420b292b69536783b3a3ba3d8` (main).
As correções de SQLite/Windows e sincronização tolerante ao OneDrive foram preservadas.
Este patch cobre a tela existente; não altera o desenho, o framework Vela,
a migração, o formato canônico Markdown ou os controles disponíveis.

## Causa raiz

O erro relatado no Windows, `outline.replaceChildren is not a function`, ocorre
na chamada síncrona inicial de `OpenDocNavigation.create()`. Antes deste patch,
essa chamada precedia os bindings centrais de clique, select, diálogos e menus.
Uma exceção interrompia o restante de `mount()`. O editor já existia e tinha seus
próprios atalhos de teclado: por isso Ctrl+B funcionava enquanto os botões não.

`compat.js` agora instala `Element.replaceChildren` somente quando ausente,
usando fragmento, nós/texto e remoção de filhos. As quatro utilizações em
navegação, busca, recentes e diálogos ficam cobertas. O teste remove a API antes
de carregar o app inteiro. Não se presume que toda versão de Qt careça dela.

## Inicialização e seleção

Primeiro carregam compatibilidade e dependências essenciais, bootstrap e editor.
Depois são ligados captura de seleção, comandos, select, diálogos e atalhos.
Menus, tema, zoom e navegação são carregados e criados separadamente; uma falha
auxiliar é registrada em `console.error` e `OpenDocApp.failures`, sem interromper
os demais módulos. O status mostra aviso curto por até quatro segundos e retorna
ao estado anterior; um novo estado de salvamento substitui o aviso imediatamente.
Falhas essenciais continuam visíveis e são registradas no console.

A captura ocorre em pointerdown/mousedown antes da mudança de foco. Botões da
barra evitam roubar o foco; o select nativo continua livre para abrir. O adapter
existente restaura o Range para executar o comando e usa bookmarks na história.
A sincronização de estilo não altera o select enquanto ele tem foco. Links
preservam a seleção durante o modal, validam o endereço e não alteram o documento
quando cancelados ou inválidos.

Dois problemas adicionais foram encontrados pelos cliques: Desfazer só habilitava
após o debounce de renderização; agora os controles de história atualizam na
alteração. O comando de código gera `<pre>` sem `<code>` no Chromium, que o
Turndown descartava como formatação. Uma regra específica preserva esse bloco
em cercas Markdown, inclusive quando seu conteúdo contém crases.

## APIs auditadas e ambiente real

QA executado em Linux, PyQt 5.15.11, Qt 5.15.14, pacote PyQtWebEngine 5.15.7,
pywebview 6.2.1, VelaApp real. O renderer informa QtWebEngine/5.15.19 e
Chrome/87.0.4280.144. Modo offscreen/software; sandbox desabilitada apenas no
ambiente de teste. Não houve teste físico em Windows/OneDrive.

A auditoria de DOM usa um iframe limpo, sem os polyfills da aplicação.

| API | Qt Linux medido | Tratamento/verificação |
| --- | --- | --- |
| EventListenerOptions.signal / AbortSignal | signal ignorado | Detecção comportamental e remoção explícita ao abortar; remount testado |
| Element.replaceChildren | Presente neste renderer | Fallback por detecção para o ambiente relatado; ausência reproduzida no app completo em JSDOM |
| Array.at | Ausente nativamente | Fallback já existente antes de carregar marked, mantido |
| append, prepend, replaceWith, toggleAttribute | Funções presentes | Sem novos polyfills; não há usos de prepend/replaceWith/toggleAttribute no código da aplicação |
| Selection e Range | Presentes | Seleção, restauração em comandos/modal e bookmarks de undo/redo no Qt |
| document.execCommand | Presente | Mantido apenas no adapter; testes Qt usam o mecanismo real |

## Validação

- Python: 29 testes aprovados, incluindo persistência, migração e integração Vela.
- Node: 22 testes aprovados. Três novos testes montam `app.js` completo com bridge,
  fetch e módulos; removem replaceChildren, acionam botões/select/menu e injetam
  uma falha na navegação para provar que comandos essenciais continuam ativos.
  JSDOM não tem mecanismo de edição: seu execCommand é modelado explicitamente;
  a prova do mecanismo nativo é feita separadamente no Qt.
- Regressão adicional de `<pre>` verifica cercas e reabertura como código.
- Black 88, `node --check` em app/compat/editor/editor_commands/navigation/menus,
  QA de captura, e collectstatic oficial `--no-tailwind` aprovados.
- Qt real: boot/remount, listeners abortados, status sem TypeError/undefined/
  is-not-a-function, e ausência de falhas auxiliares.

| Controles | Evidência Qt |
| --- | --- |
| Negrito, Desfazer, Refazer | Seleção → eventos reais de mouse CDP → Markdown com ** → undo remove → redo restaura |
| Barra: itálico, listas, citação, código | mousedown/click nos elementos; conteúdo canônico verificado |
| Select normal/H1/H2/H3 | mousedown, foco, change no select real do Qt; bloco resultante verificado |
| Link | Clique abre modal; confirmar preserva seleção e gera Markdown; cancelar/inválido não criam link |
| Arquivo/Editar/Exibir/Inserir/Formatar/Ferramentas/Ajuda | Abertura/fechamento por cliques; comandos de edição, modos e diálogos acionados |
| Navegador, outline e busca | Alternar, clicar título, pesquisar e clicar resultado seleciona o texto |
| Zoom e tema | Botão +, reset do menu e tema pelo modal; medidas/estado conferidos |
| Teclado Qt via QTest | Ctrl+A/B/I/C/X/V/Z/Y/Shift+Z/S; edição, clipboard padrão e salvamento |
| Persistência e exportação | Salvamento e arquivos PDF/DOCX/MD não vazios; recentes e novo documento |

Os testes ampliados de controles usam eventos DOM sobre a UI montada no Qt;
a sequência crítica negrito/undo/redo e o menu/modal têm também eventos reais
de mouse via protocolo CDP. O teste do select despacha change e não automatiza
o popup nativo do sistema. A importação com seletor de arquivo do Windows não
foi repetida nesta correção. O Qt offscreen emite avisos de clipboard primário
não suportado; os atalhos do clipboard padrão passam. Há um aviso Python
preexistente de depreciação de `cgi` em WebOb.

Capturas reais: `images/open-doc/editor-functional-1366.png`,
`editor-functional-1600.png` e `editor-functional-1920.png`.
Também foram verificadas as três larguras nos temas claro/escuro, folha de 794px,
zoom até 150% e ausência de overflow horizontal global.

Não foram introduzidos controles de tipografia que o Markdown não representa.

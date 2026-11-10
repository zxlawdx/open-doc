# Auditoria integral do Open Doc

Baseline `b3b4b54`, branch `main`. O escopo inclui runtime Qt, bridge, editores, preferências, build e documentação.

## Zoom e aparência

A Central escondia a barra de status, e o zoom existente era ligado diretamente ao layout DOCX. O leitor PDF/PPTX e a grade de planilhas mantinham controles próprios. A preferência de tema já era persistida, mas o acesso não estava disponível de forma consistente no cabeçalho, e os módulos de Planilhas e Dados filtravam os comandos antes de chegar ao seletor de aparência.

### Comportamento integrado

| Contexto | Alvo de Ctrl++, Ctrl+−, Ctrl+0 e Ctrl+roda | Faixa |
| --- | --- | --- |
| Central, Dados e código em tela inteira | Interface | 50%–200% |
| DOCX | Página e régua | 50%–150% |
| PDF e PPTX | Página ou slide, com os ajustes de largura e página inteira do leitor | 25%–300% |
| Planilha, inclusive com código em painel dividido | Grade | 50%–200% |

A barra inferior apresenta a porcentagem, o seletor, os botões de ajuste e o retorno a 100%. O controlador compartilhado lê o contexto e delega ao layout existente de cada editor. As preferências da interface, do DOCX e da planilha são independentes. O leitor PDF mantém a posição e o zoom por arquivo na sessão de leitura. O PPTX continua abrindo ajustado à janela. A edição de texto em andamento em um slide tem prioridade sobre o redesenho do canvas.

A engrenagem no cabeçalho abre **Configurações · Aparência**. O menu **Ferramentas → Aparência** e o acesso na Central chamam o mesmo seletor. Claro, Escuro e Automático usam o serviço global e a configuração do workspace. Automático usa o esquema informado pelo WebView e reage à mudança quando o ambiente expõe esse sinal. O contraste da interface usa os tokens semânticos existentes, inclusive no CodeMirror, nos menus e nos controles. O papel e as cores explícitas de células, PDFs e slides são tratados como parte do documento.

### Evidências e execução

- `npm test` cobre as variantes de eventos de teclado para `+`, `=`, `-`, tecla Shift e teclado numérico, a roda, a troca de contexto e o modo automático. A suíte Python cobre preferências antigas, limites e persistência.
- `python tools/qa_appearance_zoom.py <pasta-de-saída>` abre o runtime Vela/Qt, envia atalhos Qt, percorre a Central e os editores, e reabre o aplicativo em um segundo processo com o mesmo workspace. O roteiro registra imagens em claro e escuro a 80%, 100% e 150%.
- O workflow **Vela Qt cross-platform validation** executa o mesmo roteiro em Windows e Linux e publica as capturas nos artefatos `windows-qt-screenshots` e `linux-qt-screenshots`.
- Os critérios de [contraste, foco, teclado e redimensionamento da WCAG 2.2](https://www.w3.org/TR/WCAG22/) orientam os controles compartilhados. Uma avaliação de conformidade de todas as telas e dos layouts físicos de teclado permanece pendente.

## Estrutura, dependências e contratos

O [mapa de arquitetura](../ARCHITECTURE.md) segue os pontos de entrada reais. `main.py` e `launcher.py` chegam ao Vela por `config/wsgi.py`. O HTML recebe os partials da Central e dos editores. `app.js` monta o workspace e liga o frontend a HTTP local e à bridge. A camada de aplicação coordena modelos, SQLite, arquivos e adaptadores de formatos. O Vela gera os assets e inicia o mesmo runtime em código-fonte e nos binários.

A inspeção AST encontrou 88 módulos Python e 96 dependências internas estáticas no escopo de módulo, sem ciclos nesse recorte. Imports locais e dependências JavaScript carregadas no runtime ficam fora dessa métrica. `tests/test_architecture.py` verifica que os modelos canônicos e a aplicação podem ser importados sem Vela, Bottle e WebView.

| Princípio | Constatação | Ação ou limite |
| --- | --- | --- |
| Responsabilidade única | `app.js` reúne montagem, rotas, comandos e diálogos. `slide_editor.js` reúne canvas, apresentação, seleção e edição. | Zoom e tema possuem fronteiras próprias. A separação do canvas e do inspetor PPTX exige preservar os contratos de seleção e exportação e permanece pendente. |
| Aberto a extensão | Os adaptadores de arquivo separam formatos. Adicionar um formato ainda exige registrar capacidades na aplicação e atualizar o roteamento da Central. | O zoom delega aos editores existentes. A auditoria não introduziu registro genérico de plugins. |
| Substituição | A fachada de documentos oferece métodos opcionais com capacidades diferentes. PDF, PPTX e DOCX não suportam as mesmas operações de edição. | A cobertura testa as capacidades reais de cada formato. O contrato de zoom se limita a leitura e atualização da escala. |
| Segregação | Comandos de tabela, tinta e texto dependem de partes distintas da fachada. | Os controles compartilhados dependem de um alvo ativo de zoom, sem acessar a serialização do editor. |
| Inversão | O contexto injeta serviços na aplicação. A composição antiga publicava o contexto antes de inicializar as planilhas e os dados. | O contexto passa a ser publicado após inicialização bem-sucedida, com regressão que injeta falha e verifica a preservação do contexto anterior. |

### Fluxos verificados

| Área | Fronteira e cobertura | Risco ou limite observado |
| --- | --- | --- |
| Central | `design_system.js`, catálogo, recentes e arquivos importados. Testes de cópias independentes e token da listagem. | O roteiro testa navegação e geometria. A escala nativa do Windows exige validação específica. |
| DOCX | `editor.js`, modelo rico, paginação e operações lógicas. Testes de listas, seleção, quebra de página, histórico, round-trip e estresse Qt. | Paginação longa ainda produz picos de frame. |
| PPTX | Renderizadores de preview e canvas editável, comandos de objetos e exportador OOXML. Testes de transformação, gráfico, transição, equação e preservação de objetos. | Radon atribuiu complexidade 122 a `SlideModelValidator.validate_element`, 102 a `SlideDeckExporter._patch_original_shape` e 95 a `_shape_element`. Refatorar esse caminho demanda comparar arquivos de referência. |
| PDF | PDF.js, miniaturas e anotações semânticas no frontend. Backend de edição e exportação grava cópias. | A edição nativa depende do texto, da fonte e do conteúdo do PDF. |
| Planilhas e Dados | Grade virtual, tipos, fórmulas, pivôs, importação e SQLite. Testes de volume, conversão, fórmulas e consulta. | O controle de zoom da planilha opera sobre a grade. O painel de código em tela inteira opera sobre a interface. |
| Código | CodeMirror e cadernos compartilhados. SQL usa autorização SQLite e limite de execução. Python usa processo separado, tempo limite e teto de saída. | Python executa código confiável com as permissões do usuário. O modo isolado do interpretador não oferece isolamento do sistema operacional. |

## Achados e alterações

| Prioridade | Local | Achado | Impacto e estado |
| --- | --- | --- | --- |
| P0 | `requirements.txt` | O Pillow 12.3 instalado estava na faixa afetada por alertas de decodificação de imagens. | Atualizado para Pillow 13, com validação de importação e exportação. O preparo pelo código-fonte passa a exigir Python 3.11+. |
| P1 | `api.py`, `app.js` | `GET /open_doc/files` retornava metadados de documentos sem o token do workspace. | Usa a credencial de sessão dos demais endpoints e impede cache da resposta. O teste cobre token ausente, inválido e válido. |
| P1 | `header.css`, `home.css`, `navigator.css` | Os recortes fornecidos do Windows mostram texto encostado nos ícones. A marca e a sidebar dependiam de `gap` em flex, recurso ausente em versões antigas do Chromium. | Grade com coluna e espaçamento explícitos, ícones alinhados e dimensões por token. A matriz Qt mede pelo menos 8 px entre ícone e rótulo. |
| P1 | `app.js`, `editor.js`, `fixed_document.js`, `slide_editor.js` | Listeners podiam atuar sobre um editor oculto e o Ctrl+F em PPTX também chegava à rota da aplicação. | Comandos respeitam o contexto, o foco e o consumo do evento. Ctrl+F busca na Central quando ela está ativa e preserva a escala no leitor. |
| P1 | `zoom.js`, `theme.js`, layouts e estilos dos módulos | A barra da Central era ocultada e o tema ficava inacessível em módulos com roteamento próprio. | Controle único, persistência e rotas acessíveis. Preferência independente de escala e aparência do arquivo. |
| P1 | `application/context.py` | Uma falha ao abrir o armazenamento podia deixar um contexto incompleto publicado. | Publicação após inicialização, com regressão. |
| P2 | `math_gallery.js`, `equation_assistant.js`, `slide_editor.js` | Mapa duplicado de campos editáveis de equações. | Mapa compartilhado por DOCX e PPTX, preservando os renderizadores e a serialização próprios. |
| P2 | README e ajuda | A instalação, os recursos de planilhas e os limites de edição PDF estavam dispersos ou desatualizados. | Instruções separadas por sistema, requisitos de desenvolvimento, limites de execução e ajuda atualizados. |
| P3 | Serviços e editores grandes | A concentração de responsabilidades dificulta revisão e testes de partes isoladas. | Mapeada nesta auditoria. A próxima separação deve começar por um fluxo com dados de referência e paridade mensurada. |

O risco em Pillow e a exigência de Python 3.11+ foram verificados nas [notas oficiais do Pillow 13](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html). O `pip-audit --local --skip-editable` passou a informar zero alertas para o ambiente testado após atualizar Pillow e pip. O Vela fixado via Git aparece como não auditável pelo índice PyPI. `npm audit --omit=dev` retornou zero alertas de dependências de produção. As verificações por catálogo têm escopo de versões e não constituem teste de exploração.

## Usabilidade e acessibilidade

| Heurística | Avaliação |
| --- | --- |
| Visibilidade do estado | A barra exibe a escala e o valor acessível. Dados e Planilhas mantêm os indicadores de operação próprios. |
| Correspondência com o uso | A Central escala a interface. Os editores aplicam zoom à página, ao slide ou à grade. |
| Controle e liberdade | Retorno a 100% por botão ou Ctrl+0. Escape fecha aparência e devolve o foco. |
| Consistência e padrões | O cabeçalho e o menu Ferramentas abrem a mesma preferência. A sidebar usa dimensões compartilhadas. |
| Prevenção de erros | Zoom e tema não entram na serialização. Atalhos de edição respeitam visibilidade do editor e diálogos. |
| Reconhecimento | A engrenagem tem nome acessível e tooltip. O rótulo do seletor anuncia o alvo de zoom. |
| Flexibilidade | Atalhos, roda e controles de interface oferecem caminhos equivalentes. |
| Design visual | Espaçamento e tokens semânticos preservam a hierarquia visual em tema claro e escuro. |
| Diagnóstico e recuperação | Os fluxos de conflito, salvamento de cópia e recuperação continuam separados. Mensagens de importação continuam sendo um ponto de revisão por formato. |
| Ajuda | A ajuda local explica zoom, aparência e limites da edição PDF. |

Referências [heurísticas de Nielsen](https://www.nngroup.com/articles/ten-usability-heuristics/) e [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## Medições

| Medida | Baseline | Auditoria |
| --- | --- | --- |
| Cobertura Python de linhas em `apps/open_doc` | 83%, 7.053 linhas executáveis | 83%, 7.061 linhas executáveis |
| Testes Python | 332 passaram, 2 ignorados | 333 passaram, 2 ignorados |
| Testes JavaScript | 236 cenários antes dos novos testes de zoom e tema | 238 cenários |
| Duplicação lexical | Um clone de 11 linhas na amostra de UI, CSS, serviços e aplicação | Zero clones na mesma amostra após centralizar os campos de equação |

O estresse Qt no Linux exercitou Enter e Backspace repetidos no DOCX, seguido de exclusão em bloco e retomada da edição. O heap é o valor reportado pelo WebView ao fim de cada etapa, sujeito ao coletor de lixo. O tempo inclui a automação de entrada.

| Ciclos | Tempo | Heap JS | Maior intervalo entre frames |
| --- | ---: | ---: | ---: |
| 100 | 3,12 s | 32,2 MB | 67 ms |
| 500 | 9,44 s | 96,4 MB | 133 ms |
| 1.000 | 20,88 s | 70,5 MB | 216 ms |

### Runtime, empacotamento e limites

- **Linux local.** O roteiro Qt validou a Central e todos os módulos em claro e escuro, com três níveis de zoom e reabertura em outro processo. A sidebar passou em 1280×720, 1366×768, 1600×900, 1920×1080 e 2560×1440, com DPR emulado de 1, 1,25, 1,5 e 2 na janela de 1280×720. As capturas anteriores e posteriores usam a mesma revisão de Qt/Linux para permitir comparação visual.
- **Linux compilado.** `python manage.py buildapp --gui qt5 --icon build/open-doc.png --installer` gerou o bundle local. `node tools/smoke_release.mjs dist/Open-Doc/Open-Doc` confirmou a abertura do executável congelado.
- **Windows e empacotamento de distribuição.** A matriz de runtime e o workflow de pacotes do PR são as verificações de plataforma. A escala de sistema, o teclado físico, o modo maximizado nativo e a mesa digitalizadora precisam de verificação em equipamento real. A avaliação WCAG é focada nos controles revistos.

## Validação manual

1. Abra a Central. Use Ctrl++, Ctrl+−, Ctrl+0 e Ctrl+roda. Confira o indicador e o acesso à engrenagem com a janela estreita.
2. Na engrenagem, selecione Escuro. Abra um DOCX, um PDF, um PPTX e uma planilha. Confira a interface e compare as cores do conteúdo com o arquivo original.
3. No DOCX, acesse Ferramentas → Aparência. Selecione Claro, volte à Central e confira a mudança. Alterne para Automático e altere o tema do sistema se o WebView expuser essa configuração.
4. Em PDF e PPTX, ajuste o zoom e use Ctrl+F. Confira que a busca abre na área ativa e preserva a escala. Na Central, confira que Ctrl+F foca a busca da biblioteca.
5. Na planilha, digite uma fórmula e amplie antes de confirmar. Confira o texto digitado. Abra Código e alterne entre tela dividida e inteira para verificar o alvo de zoom.
6. Feche e reabra o aplicativo. Confira tema, zoom da Central e o zoom da grade ao reabrir uma planilha.
7. Repita no Windows com teclado ABNT2, teclado internacional e teclado numérico, em escala nativa de 100%, 125%, 150% e 200% quando disponível. A matriz automatizada emula DPR e dimensões, enquanto a verificação manual cobre o comportamento do sistema e do teclado físicos.

## Digitação após usar a caneta no DOCX

A digitação comparava o estado salvo e calculava o tamanho do histórico
serializando o documento rico a cada edição. A serialização incluía a tinta,
mesmo quando apenas um trecho de texto mudava. A comparação agora ignora
subárvores compartilhadas, e o histórico reaproveita a contagem de tamanho das
partes imutáveis. Desfazer e refazer texto também reaproveitam os traços intactos.

O roteiro `python tools/qa_docx_ink_typing.py` desenha 112 traços com pressão e
inclinação em um DOCX de 14 páginas e depois digita pelo teclado do Qt. Valida
desfazer, refazer, salvar e reabrir. A CI roda o roteiro em Windows e Linux. Para
a reprodução local, `OPEN_DOC_INK_QA_PDF` aponta para um PDF cuja extração de
texto serve de base para a estrutura do DOCX de teste.

| Tempo síncrono por tecla no Qt/Linux | Antes | Após a correção |
| --- | ---: | ---: |
| Mediana | 277,1 ms | 10,0 ms |
| Percentil 95 | 509,1 ms | 16,4 ms |
| Maior valor | 596,0 ms | 25,6 ms |
| Serializações de toda a tinta durante a digitação | 28 | 0 |

Medição com 27 teclas e cerca de 3,24 MB de tinta. Os eventos de caneta são
simulados no WebView. O roteiro não mede a latência do driver físico da mesa.

A segunda otimização atualiza diretamente o trecho do modelo quando o navegador
insere texto em um trecho simples e a alteração do DOM corresponde ao evento.
Edições estruturais, seleções e alterações inesperadas seguem o serializador
completo. No mesmo roteiro com 27 teclas, as chamadas ao serializador de bloco
caíram de 27 para 1, a mediana síncrona de 9,8 para 3,3 ms e o p95 de 13,3 para
9,1 ms. O callback do próximo frame também é registrado para diagnosticar
atrasos fora do evento de entrada. Em Qt offscreen, esse valor depende do
agendamento do renderizador e não mede a apresentação física em tela.

### Cache de apresentação da tinta

A primeira versão do cache compunha os traços concluídos em Canvas nas páginas
visíveis do DOCX no modo Cursor. A revisão mantém essa camada também durante
a escrita. O SVG exibe o traço ativo e volta a exibir a tinta completa durante
o uso da borracha ou quando a página fica fora do cache. O limite é de 6 milhões de pixels
por editor e 2,5 milhões por página. A escala do Canvas acompanha o zoom e a
densidade de tela até 2×. A representação de pontos, a edição e a exportação
continuam vetoriais.

O mesmo roteiro alternou três execuções SVG e três Canvas no Qt/Linux com o
caderno de 14 páginas, 112 traços e 27 teclas. Os valores de p95 até o próximo
callback de frame foram 131,5, 103,7 e 97,6 ms em SVG e 35,3, 74,7 e 54,5 ms
com Canvas. São medições offscreen do agendamento do renderizador. O teste
também verifica pixels do cache, reaproveitamento durante a digitação, prévia
SVG ao selecionar a caneta, mudança de zoom e persistência dos traços.

Referências técnicas [otimização de Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas),
[Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
e [Path2D](https://developer.mozilla.org/en-US/docs/Web/API/Path2D).

#### Tinta ativa e atualização incremental

O código do Xournal++ mostra dois níveis de atualização. O
`StrokeToolView` usa uma máscara para pintar os segmentos novos do traço
em andamento. O `RenderJob` pode recompor apenas um retângulo do buffer da
página. A separação entre tinta ativa e finalizada também aparece no Android
Ink. A discussão do Stack Overflow sobre linhas semitransparentes explica
por que uma prévia separada evita acumular opacidade sobre o mesmo traço.

No Open Doc, o cache Canvas fica sob o SVG. Durante o gesto, o SVG exibe
a prévia. Ao soltar a caneta, a composição adiciona apenas o contorno
finalizado ao Canvas se a versão da página ainda corresponde ao cache.
Exclusões, desfazer e zoom invalidam a imagem quando necessário. O teste
Qt verifica que adicionar um marca-texto a uma página aquecida faz uma
chamada de preenchimento, reaproveita o mesmo Canvas, mantém a prévia
visível e permite desfazer o traço.

O algoritmo do traço ativo ainda usa o contorno atual. A máscara incremental
do Xournal++ e a redução de trabalho por ponto do tldraw são referências para
um teste específico da latência durante o gesto. Os resultados divulgados
por esses projetos medem seus próprios renderizadores.

Fontes [Xournal++ StrokeToolView](https://github.com/xournalpp/xournalpp/blob/d762a94/src/core/view/overlays/StrokeToolView.cpp),
[Xournal++ RenderJob](https://github.com/xournalpp/xournalpp/blob/d762a94/src/core/control/jobs/RenderJob.cpp),
[benchmark do Xournal++](https://github.com/xournalpp/xournalpp/issues/4662),
[Stack Overflow](https://stackoverflow.com/questions/6629386/clear-line-on-html5-canvas),
[Android Ink](https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/ink-api-modules)
e [tldraw](https://tldraw.dev/blog/tldraw-sdk-5.2).

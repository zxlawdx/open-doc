# Planilhas, Dados e tabela dinâmica

Validação local em 9 de novembro de 2026, horário de Manaus. Aplicativo Open Doc executado pelo Vela com PyQt 5.15.11 e QtWebEngine 5.15.19 em Linux, em modo offscreen. Os PNGs preservam o tamanho da captura, com paleta compactada para versionamento. A captura é do conteúdo da WebView.

## Diagnóstico

- **Tabela dinâmica.** A implementação anterior colocava um painel lateral dentro do corpo da grade e alternava entre posicionamentos absoluto e fixo. O desktop usava `left: 50%` mais translação de meia largura, com overrides por faixa de viewport e uma sombra para simular o fundo modal. Essa combinação era sensível à origem do bloco de posicionamento. O recorte da captura do Windows foi registrado pelo solicitante. A revisão base `6ef1e3c` ficou centralizada no Qt Linux deste ambiente, portanto a causa específica do deslocamento naquele Windows ainda precisa ser confirmada. O diálogo nativo passa à camada superior da WebView, com as bordas calculadas no viewport local e teste adicional com um ancestral transformado.
- **Central.** A classificação XLSX já chegava no registro. A renderização forçava a etiqueta DOC para todos os itens locais, usava o ícone de texto para XLSX e deixava o rodapé do editor anterior visível.
- **Planilhas e Dados.** Os comandos estavam dispersos e a faixa oferecia apenas rolagem horizontal. O editor de código compartilhado já fornecia CodeMirror e completude contextual. O espaço efetivo de edição estava limitado pela altura do conteúdo e pela largura fixa do painel.

## Evidências

| Tela | Antes | Depois |
| --- | --- | --- |
| Tabela dinâmica | [Windows do solicitante](antes-windows-pivot.png) · [Qt Linux na main](antes-qt-pivot.png) | [1280 × 720](depois-pivot-1280x720.png) · [1366 × 768](depois-pivot-1366x768.png) · [1600 × 900](depois-pivot-1600x900.png) · [1920 × 1080](depois-pivot-1920x1080.png) · [2560 × 1440](depois-pivot-2560x1440.png) · [640 × 720](depois-pivot-split.png) |
| Planilhas | [Windows do solicitante](antes-windows-planilhas.png) | [1280 × 720](depois-editor-1280x720.png) · [1366 × 768](depois-editor-1366x768.png) · [1600 × 900](depois-editor-1600x900.png) · [1920 × 1080](depois-editor-1920x1080.png) · [2560 × 1440](depois-editor-2560x1440.png) · [Faixa expandida a 640 px](depois-editor-overflow.png) |
| Dados e SQL | [Windows do solicitante](antes-windows-dados.png) | [1280 × 720](depois-dataset-sql-1280x720.png) · [1366 × 768](depois-dataset-sql-1366x768.png) · [1600 × 900](depois-dataset-sql-1600x900.png) · [1920 × 1080](depois-dataset-sql-1920x1080.png) · [2560 × 1440](depois-dataset-sql-2560x1440.png) · [640 × 720](depois-dataset-sql-split.png) |
| Central | [Windows do solicitante](antes-windows-central.png) | [1280 × 720](depois-central-1280x720.png) · [1366 × 768](depois-central-1366x768.png) · [1600 × 900](depois-central-1600x900.png) · [1920 × 1080](depois-central-1920x1080.png) · [2560 × 1440](depois-central-2560x1440.png) |

Escala emulada pelo protocolo de depuração do QtWebEngine em [125%](depois-pivot-scale-1.25.png), [150%](depois-pivot-scale-1.5.png) e [200%](depois-pivot-scale-2.png). Essas capturas têm o mesmo viewport lógico de 1366 × 768. A largura de 640 px testa a disposição de tela dividida. Windows com dois monitores físicos, redimensionamento pelo gerenciador de janelas e DPI misto dependem da reprodução manual.

## Código e cobertura

- `templates/workbook.html`, `static/css/workbook_v2.css`, `static/icons.svg` e `static/js/grid_workspace.js` definem a faixa, grupos, overflow, ícones locais e divisores de painel.
- `workbook.js`, `workbook_types.js` e `spreadsheets/{store,files}.py` implementam comandos, tipos e formatação com desfazer/refazer e persistência. Os estilos suportados fazem ida e volta em XLSX.
- `workbook_pivot_ui.js` usa `showModal()`. `workbook_pivot.js` calcula subtotais opcionais para o primeiro campo de Linhas quando há pelo menos dois agrupamentos. Métricas são calculadas sobre os registros originais, inclusive para médias e contagens.
- `datasets.js`, `datasets/store.py` e `code_editor.js` reaproveitam a paginação, o CodeMirror e os serviços SQL/Python. Filtros de igualdade usam a mesma conversão de tipo do SQLite. Ordenação, frequências, vazios e valores únicos geram consultas de leitura. O histórico de scripts é por projeto na sessão.
- `app.js` e `design_system.js` corrigem a Central e a navegação para abrir ou criar uma planilha a partir do editor.
- `tests/workbook_pivot_v2.test.cjs` compara cinco agregações com reduções independentes de arrays em 5, 100 e 9.999 registros, mais o cabeçalho para a maior faixa. Os testes Python incluem ingestão paginada de 1,1 milhão de registros no modo Dados e ida e volta de estilos em XLSX.
- `tools/qa_workbook.py` e `tools/qa_datasets.py` executam o Open Doc real, verificam ações e produzem as capturas. Os testes do diálogo verificam centralização, hit testing das ações, acesso às zonas por rolagem, foco, cancelamento e criação de resultado.

## Roteiro no Windows e no Linux Mint

1. Na branch do PR, execute `python manage.py collectstatic --yes` e `python main.py` com o ambiente do projeto ativo.
2. Na Central, abra um PDF e volte pelo botão Open Doc. Entre em **Planilhas**, crie uma cópia de **Orçamento doméstico**, volte a **Recentes** e confirme **XLSX**, **Planilha local** e ausência do rodapé de PDF. Reabra a planilha pelo item.
3. Dê duplo clique em B2, altere 1500 para 2000 e pressione Enter. O saldo deve virar 520. Teste Tab, Esc, Ctrl+Z e Ctrl+Y. Selecione duas células arrastando, formate em **Início** e use o botão direito para marcar um tipo. Teste um valor incompatível e confira a indicação com o valor original preservado. Salve e reabra. Exporte XLSX em **Arquivo** e confira a formatação em uma nova importação.
4. Em **Tabela dinâmica**, use A1:D2, adicione Categoria em Linhas e Saldo em Valores. Adicione Previsto como segunda métrica. Confira 520 e 2000 na prévia e na nova aba. Teste troca de agregação, filtro, arraste ou botão de adicionar, Esc e reabertura do resultado para atualização. Com duas categorias em Linhas, ligue **Subtotais** e compare com os registros da origem.
5. Abra a tabela dinâmica com a janela maximizada e restaurada, em meia tela e no monitor direito. Repita em 100%, 125%, 150% e 200% quando o sistema permitir. Use Tab e Shift+Tab. Em janela curta, role o conteúdo e confirme que Cancelar e Criar tabela permanecem disponíveis. Confirme que Delete dentro do modal não apaga células da planilha.
6. Em **Dados**, importe CSV/TSV. Edite uma célula e use o menu da coluna para testar uma conversão com prévia e desfazer. Arraste a borda do cabeçalho ou use as setas no separador focado. Em **Filtros**, filtre pela célula selecionada. Em **SQL**, execute `SELECT COUNT(*) FROM dados`. Em **Python**, execute o script inicial. Redimensione e recolha o painel. Exporte em **Exportação** e confira o CSV.
7. Para reproduzir as capturas, execute `python -u tools/qa_workbook.py caminho-de-saida` e `python -u tools/qa_datasets.py caminho-de-saida` em processos separados, com Node e QtWebEngine disponíveis.

## Limites atuais

A operação de inserir/excluir linhas e colunas é protegida em pastas com fórmulas ou tabelas dinâmicas para evitar deslocar referências. O preenchimento usa valores calculados e a ordenação de Planilhas atua na seleção sem cabeçalho. O construtor trabalha sobre a aba de uma pasta, limitada a 10 mil linhas totais e 50 mil células na faixa. O resultado e a configuração são persistidos na pasta do Open Doc. O XLSX exportado leva os resultados e os estilos suportados.

Ficam pendentes mesclagem, dimensões e ocultação de linhas/colunas em Planilhas, congelamento configurável, formatos numéricos personalizados, formatação condicional, catálogo de funções ampliado com autocomplete na fórmula, gráficos independentes da tabela dinâmica, transformações destrutivas em lote e histórico de scripts entre sessões. O modo Dados usa consultas de leitura e pode enviar resultados SQL para uma pasta editável.

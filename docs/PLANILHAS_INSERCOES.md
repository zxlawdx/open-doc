# Inserções em planilhas: implementação e compatibilidade

A comparação abaixo usa as documentações de Excel, Google Planilhas,
LibreOffice Calc e ONLYOFFICE. O Open Doc implementa sua própria interface e
serialização; isso não significa paridade integral com esses produtos.

## Disponível em Inserir

| Recurso | Comportamento no Open Doc | XLSX |
| --- | --- | --- |
| Imagem PNG, JPEG e WebP | Inserção local, movimentação, tamanho, descrição, duplicação, exclusão e desfazer/refazer | Imagem DrawingML editável; WebP é normalizado para PNG |
| Gráfico de colunas ou barras | Categorias e uma ou mais séries ligadas à seleção, incluindo cabeçalhos | Gráfico nativo com referências às células |
| Gráfico de linhas, área ou pizza | Valores recalculados quando a fonte muda; pizza usa a primeira série | Gráfico nativo |
| Dispersão | Primeira coluna numérica como eixo X e demais colunas como séries Y | Gráfico de dispersão nativo |
| Formas | Retângulo, elipse, triângulo, losango, linha e seta; movimentação e tamanho | Formas DrawingML, não imagens achatadas |
| Caixa de texto | Texto editável em objeto livre, com movimentação e tamanho | Caixa DrawingML editável |
| Minigráfico | Linha, colunas ou ganhos/perdas, associado a valores da mesma aba | Extensão nativa x14 para sparklines |
| Caixa de seleção | Controle clicável na célula, associado a verdadeiro/falso | Valor booleano; a caixa visual moderna do Excel não é exportada |
| Lista suspensa | Opções definidas pelo usuário; editar ou remover pelo comando | Validação de dados nativa com lista literal |
| Comentário | Nota na célula, indicação visual e edição pelo comando | Nota/comentário tradicional, sem colaboração ou conversa encadeada |
| Link | Endereço HTTP, HTTPS ou mailto, com texto da célula | Hyperlink nativo |
| Tabela dinâmica | Linhas, colunas, métricas, filtros, totais e detalhamento | Resultado em células; não cria cache/tabela dinâmica nativa do Excel |
| Gráfico dinâmico | Prévia no construtor da tabela dinâmica | A prévia não vira automaticamente um objeto flutuante; use Gráfico da seleção |
| Abas, linhas e colunas | Comandos de criação e estrutura existentes | Planilhas nativas; alterações estruturais com referências complexas permanecem protegidas |

Os objetos de imagem e gráfico podem ser selecionados, movidos pelo mouse ou
setas, redimensionados, duplicados e excluídos. O histórico inclui as alterações.
Para mudar o tipo de um gráfico existente, escolha o tipo em Inserir e clique
em Editar no objeto. O intervalo usado na criação continua vinculado à fonte.

Uma imagem é armazenada por conteúdo no workspace. O JSON das células guarda
somente a referência e a geometria; editar uma célula não reenvia a foto. Arquivos
iguais compartilham o mesmo armazenamento. A exportação lê os arquivos durante
a escrita, sem manter uma cópia de cada foto no modelo da planilha.

## Como usar

1. Em **Inserir → Imagem**, escolha um arquivo local. Clique na imagem para
   acessar Editar, Duplicar e Excluir; arraste para mover ou use o canto para
   redimensionar. Também é possível colar imagens da área de transferência ou
   arrastar arquivos para a grade. Imagens mantêm a proporção, a menos que Shift esteja pressionado.
2. Para criar um gráfico, selecione a linha dos cabeçalhos, uma coluna de
   categorias e as colunas numéricas. Escolha o tipo e clique em **Gráfico da
   seleção**. Dê um título. Alterar os valores das células atualiza o desenho.
3. Em **Forma ou texto**, escolha uma geometria ou uma caixa de texto. Para
   editar seu texto, use Editar no objeto selecionado.
4. Para minigráficos, selecione os dados e escolha **Minigráfico à direita**.
   Uma seleção com várias linhas gera um por linha na coluna seguinte. Uma
   seleção vertical de uma coluna gera um único minigráfico. O destino deve
   estar livre de valores e de outros controles.
5. Para caixas de seleção, use células vazias ou booleanas. Para listas,
   separe as opções por ponto e vírgula. Comentário e Link aceitam um campo
   vazio para remover a informação. **Remover controle da célula** remove
   metadados da seleção, mantendo os valores.
6. Use **Salvar** para persistência no Open Doc e **Exportar → XLSX** para levar
   imagens, gráficos, formas, notas, links e controles compatíveis. CSV e TSV
   armazenam apenas os valores das células.

## Limites e itens ainda não integrados

- Imagem como valor de célula do Excel 2024 é diferente de uma imagem DrawingML
  sobre a grade. A implementação atual usa objetos sobre a grade.
- Listas literais usam até 50 opções e 250 caracteres no total, sem vírgulas
  ou aspas. Listas baseadas em nomes definidos ou fórmulas não são interpretadas
  por este adaptador.
- Gráficos e minigráficos usam intervalos da própria aba. Tipos adicionais como
  radar, bolhas, ações, cascata, histograma, caixa/bigodes e gráficos combinados
  não estão disponíveis no editor atual.
- Agrupamento de formas, geometria livre, rotação, SmartArt, WordArt, modelos 3D,
  objetos OLE/ActiveX, assinaturas, integrações de formulários, segmentações e
  linhas do tempo nativas do Excel não foram implementados.
- Comentários de colaboração, pessoas, chips inteligentes, conteúdo conectado
  à nuvem e scripts/macros não fazem parte desta camada local de inserção.
- Preservação universal de todos os recursos de um XLSX importado não é
  prometida: recursos desconhecidos precisam de adaptadores e testes próprios.

## Validação

- Testes de imagem compartilhada, persistência, validação e referência de mídia.
- Exportação e reimportação nativas dos seis tipos de gráfico e sete tipos de forma/texto.
- Exportação e reimportação de minigráficos x14, comentários, links, listas e booleanos.
- Sessão Qt com criação/importação, teclado, histórico, salvamento e exportação.
- Abertura pelo LibreOffice Calc do XLSX misto, com texto, formas e gráficos
  identificados no PDF produzido pelo próprio Calc.
- A importação do corpus público de 100 XLSX permaneceu bem-sucedida, incluindo
  9.229 células com controles/metadados reconhecidos. Isso não equivale a uma
  garantia de preservação de cada recurso desses arquivos.

## Fontes primárias

- [Excel: imagem na célula](https://support.microsoft.com/en-us/excel/insert-picture-in-cell-in-excel)
- [Excel: minigráficos](https://support.microsoft.com/en-us/excel/analyze-trends-in-data-using-sparklines)
- [Excel: tabelas e gráficos dinâmicos](https://support.microsoft.com/en-us/excel/overview-of-pivottables-and-pivotcharts)
- [Google Planilhas: imagens](https://support.google.com/docs/answer/9224754)
- [Google Planilhas: caixas de seleção](https://support.google.com/docs/answer/7684717)
- [LibreOffice: Inserir](https://help.libreoffice.org/latest/pt/text/shared/main0104.html)
- [LibreOffice: tipos de gráfico](https://books.libreoffice.org/en/CG262/CG26207-GalleryOfChartTypes.html)
- [ONLYOFFICE: guia Inserir](https://helpcenter.onlyoffice.com/docs/userguides/spreadsheet-editor/program-interface/insert-tab)
- [Microsoft Open XML: formas](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.spreadsheet.shapeproperties)
- [Microsoft MS-XLSX: sparklineGroups](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-xlsx/712ac8a5-cad4-404a-9b67-9033bff2774a)

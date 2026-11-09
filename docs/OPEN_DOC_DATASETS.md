# CSVs grandes e acréscimo de arquivos

A Central tem dois fluxos. **Planilhas** mantém edição por célula, fórmulas e histórico. **Dados** armazena datasets em disco e exibe páginas de 50 linhas e 12 colunas. A quantidade de colunas é determinada pelo cabeçalho. A posição pode ser informada diretamente para acessar qualquer página.

Dados usa SQLite separado do banco dos documentos. A importação percorre os arquivos com o leitor CSV do Python, agrupa inserções e registra os arquivos de origem na mesma transação. A consulta usa a chave de posição no índice, sem caminhar por todas as páginas anteriores. O fluxo não impõe um teto de linhas ou colunas como o da grade. A capacidade depende do espaço disponível, do tamanho dos registros e dos limites dos componentes. A prévia abrevia campos longos. Os valores armazenados continuam íntegros, inclusive os zeros à esquerda e os campos com quebras de linha entre aspas.

O acréscimo compara os nomes do cabeçalho após remover espaços nas extremidades. As colunas podem aparecer em outra ordem, e o cabeçalho de cada arquivo é consumido na importação. As linhas de dados são acrescentadas como estão. Uma seleção de múltiplos arquivos é atômica e uma divergência de esquema ou registro inválido cancela toda a seleção. A mesma operação pode ser repetida deliberadamente e acrescentará as linhas novamente.

Na grade, **Acrescentar CSV/TSV à aba** usa o cabeçalho da primeira linha e acrescenta os registros após a última linha usada. A operação pode ser desfeita antes ou depois de salvar, durante a sessão. A grade continua sujeita a seus limites e orienta o uso da área Dados quando um arquivo excede sua capacidade. Para codificações legadas e controle do separador, use Dados.

## Verificação e próximos passos

O teste de persistência usa 600 mil linhas seguidas de outras 500 mil. Outro cenário usa 130 colunas e Windows-1252. A suíte cobre a reversão do lote em caso de erro. O teste de desktop usa QtWebEngine e exercita a ponte nativa com arquivos reais, fornecendo somente os caminhos que seriam escolhidos no seletor. [Captura](images/datasets/append.png)

Datasets são consultáveis pela prévia ou por SQL. Selecione o dataset e execute uma consulta sobre a tabela `dados`. As colunas do CSV são texto. Use `CAST` para agregações numéricas e aspas duplas para nomes com espaços. O executor abre o banco somente para leitura e restringe o acesso ao dataset selecionado, com até cinco segundos e uma prévia de até 100 linhas e 100 colunas por consulta.

```sql
SELECT "ano", COUNT(*) AS registros
FROM dados
GROUP BY "ano"
ORDER BY "ano";
```

Python, edição em massa, exportação de datasets e junção por chave permanecem como etapas seguintes. O acréscimo atual empilha registros com o mesmo esquema.

1. Em Linux Mint ou Windows, abra **Dados** pela Central e crie um dataset com CSV de cabeçalho preenchido.
2. Acrescente um segundo CSV com os mesmos nomes em outra ordem e confira a contagem total. Vá diretamente à linha de transição pelo campo de posição.
3. Acrescente um lote com um cabeçalho diferente e confira que a contagem anterior foi preservada.
4. Reabra o aplicativo e selecione o dataset existente.
5. Em **Planilhas**, abra um CSV pequeno, acrescente outro à aba, use Desfazer e Refazer, salve e reabra.

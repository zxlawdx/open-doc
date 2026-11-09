# Open Doc — validação manual da Tabela Dinâmica V2, Planilhas e Dados

Branch: \`feat/pivot-v2-typed-cells-20261109\` · PR #74.

## Preparar o aplicativo

No Linux Mint, atualize a branch e inicie o Open Doc com as dependências do repositório. Para Windows, use a mesma branch no ambiente de desenvolvimento. Executar apenas o CSS/HTML de referência não valida o aplicativo real.

## Roteiro em planilha

1. Na Central, crie **Orçamento doméstico**. Verifique a planilha, a barra de fórmulas e a edição direta com duplo clique ou F2.
2. Selecione **B2**; mude o valor para **2000**. Confirme que **D2** passa de 20 para **520**. Desfaça, refaça e salve.
3. Clique com botão direito em uma célula, escolha **Moeda (R$)**; compare valor original na barra de fórmulas e valor exibido na grade. Tente alterar uma coluna inteira e uma seleção.
4. Abra **Tabela dinâmica**. Informe \`A1:D2\` e clique **Recarregar campos**.
5. Adicione **Categoria** em **Linhas**; adicione **Saldo** e **Previsto** em **Valores**. Confirme que há duas métricas independentes e que a prévia mostra **520** e **2000**.
6. Altere a função **Soma/Média/Contagem** e a forma de exibição **% do total geral / linha / coluna**. Confira a prévia e experimente arrastar um campo para outra zona.
7. Adicione um campo em **Filtros** e marque/desmarque categorias. Teste filtros sem registros e nomes longos.
8. Clique **Criar tabela**. Deve surgir uma **nova aba**, preservando os dados originais. Salve e reabra.
9. Dê duplo clique em um agregado para visualizar os registros da origem; feche e use **Editar campos** pelo comando de tabela dinâmica.
10. Altere o dado-fonte, reabra a tabela e clique **Atualizar resultado** (a atualização é explícita). Verifique undo/redo da operação.

## Roteiro na área Dados

1. Importe CSV com campos \`id;valor;data\` e pelo menos as linhas \`001;1.234,56;18/08/2026\` e \`002;25,5;19/08/2026\`.
2. Dê **duplo clique** na célula \`001\` e mude para \`009\`; Enter confirma. Verifique edição sem perda de zeros à esquerda. Reinicie e confirme persistência.
3. Desfaça/refaça a edição com Ctrl+Z/Ctrl+Y quando a grade tiver foco.
4. Clique com botão direito sobre o nome da coluna **valor**: marque **Número decimal**. Clique com botão direito sobre uma célula: aplique **Texto** como exceção.
5. Confira indicador de tipo no cabeçalho e alerta de valor incompatível sem esvaziar célula.
6. No editor SQL rode \`SELECT ROUND(SUM(valor),2) AS total FROM dados\`. Com a coluna numérica tipada, o esperado é \`1260.06\`.
7. Use **Python local** com autorização e leia \`DATASET_CSV\` com \`csv\`/pandas, se disponível. O arquivo de análise reflete tipos declarados; a exportação CSV comum mantém os textos originais.
8. Exporte o dataset CSV e abra para verificar valores de origem intactos. Teste o menu de contexto em células e cabeçalhos.

## Testes automatizados e evidências

- \`python -m pytest -q\`
- \`npm test\`
- \`python -u tools/qa_workbook.py docs/images/workbook-mvp\`
- \`python -u tools/qa_datasets.py docs/images/datasets\`
- CI do PR: jobs Qt **Linux** e **Windows**, com screenshots em artefatos de cada execução.
- Capturas da tabela dinâmica: \`pivot.png\`, \`pivot-1920.png\`, \`pivot-1500.png\`, \`pivot-1000.png\`, \`pivot-800.png\`, \`pivot-390.png\`, \`pivot-narrow.png\`.
- Verificar ausência de sobreposição e prévia alcançável por rolagem em todas as larguras, inclusive 390 px.

## Limitações conhecidas a tratar separadamente

- A tipagem de dados é não destrutiva por padrão. Não existe ainda um fluxo completo de conversão explícita com diagnóstico de todas as células e confirmação transacional para tipos.
- A área Dados ainda não tem histórico persistente de versões de esquema, nem desfazer/refazer das alterações de tipo (somente de edição de valores).
- A tabela dinâmica oferece agrupamentos por campos, mas agrupamento temporal mês/ano, expandir/recolher hierarquias e criação de gráficos vinculados continuam para evolução.
- A integração remota com Google Colab depende de autenticação e API suportadas; não foi implementada, nem simulada.
- Não interpretar um teste de unidade verde como evidência visual: screenshots reais de Qt e testes de interação precisam ser revistos antes do merge.

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

## Recursos adicionais desta etapa

### Agrupamento temporal e gráficos
1. Importe um arquivo com campo \`data\` contendo valores \`18/08/2026\`, \`19/08/2026\`, \`01/09/2026\` e um campo numérico \`quantidade\`.
2. No construtor da tabela dinâmica, mova \`data\` para **Linhas** e \`quantidade\` para **Valores**. No chip de data, selecione **Por mês**: a prévia deve mostrar **08/2026** e **09/2026**.
3. Mude a ordenação para A→Z/Z→A/maior valor; teste **Produto** e **Moeda R$**, inclusive 0 casas decimais.
4. Alterne a prévia **Tabela/Barras/Linhas/Pizza**. Confirme que o gráfico utiliza os valores numéricos reais, e que a configuração continua após salvar e reabrir a tabela. Gráficos de pizza exigem valores positivos.

### Conversão explícita e histórico de esquema
1. Na área Dados, clique direito na coluna **valor**. **Alterar tipo** marca o tipo, mas não altera texto bruto.
2. Escolha **Prévia e conversão…**, selecione **Número decimal**. Confira contagens, valores antigos/novos e erros antes de confirmar. **Cancelar** deve preservar tudo.
3. Se houver valores incompatíveis, confirme apenas depois de selecionar **Preservar valores incompatíveis**. Sem a opção a conversão é recusada.
4. Use Ctrl+Z/Ctrl+Y: cada conversão, edição e alteração de tipo ocupa uma etapa própria. Consulte **Histórico** e reinicie o aplicativo para confirmar persistência.
5. Verifique que mudar valores depois da prévia impede confirmar o token antigo; refaça a prévia.
6. Teste células com exceções individuais à coluna e conversões de datas, valores pt-BR, booleanos e porcentagens.
7. Para datasets com mais de **50 mil células** na seleção/coluna, o backend deve solicitar intervalo menor.

### SQL, Python e ambientes por projeto
1. No SQL da planilha, execute uma consulta e clique **Enviar para aba**. A nova aba deve ser editável e aparecer no histórico de desfazer.
2. Na área Dados, execute \`SELECT id, nome FROM dados LIMIT 2\` e clique **Enviar à planilha**. A planilha criada é independente da fonte.
3. Abra **Bibliotecas Python**. Sem autorização, não pode instalar nada.
4. Digite um nome PyPI válido, marque o consentimento e clique **Instalar no projeto**. O instalador usa um \`venv\` dentro do workspace do Open Doc e retorna logs. A instalação exige internet e o Python de desenvolvimento.
5. Refaça o autocomplete Python com uma biblioteca instalada e execute um script com ela. Em outro projeto, confirme que o ambiente de pacotes é independente.
6. **Atenção:** instalar pacotes e executar scripts locais pode executar código de terceiros com permissões do usuário; não é um sandbox. Colab ainda não está conectado.

## Como rodar no Linux Mint

A partir de um clone existente do Open Doc (não substitua a \`main\`):

\`\`\`bash
cd ~/estudos/open-doc
git fetch origin
git switch feat/pivot-v2-typed-cells-20261109
git pull --ff-only origin feat/pivot-v2-typed-cells-20261109
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python manage.py collectstatic --yes
python manage.py runapp
\`\`\`

Ao voltar para a \`main\`, use \`git switch main\` **no worktree que já a contém**. Se a branch estiver em outro worktree, não force um \`git switch\` que sobrescreva a árvore atual.

## Limitações conhecidas a tratar separadamente

- Faltam agrupamentos hierárquicos expansíveis/recolhíveis, gráficos ancorados permanentemente na grade, e conversões sem limite de 50 mil células por operação.
- A área Dados ainda não dispõe de uma barra lateral completa estilo Excel/Calc, redimensionamento de colunas por arrastar, filtros e ordenação de toda a base com edição por índices estáveis, e versão histórica em nível de importação.
- O gerenciador Python é local, opt-in e usa pacotes binários de PyPI. A execução do código **não** é isolada contra acesso a arquivos/rede; só execute scripts e pacotes confiáveis.
- Não existe conexão autenticada com Google Colab ou execução em sessão remota. A documentação e a UI não devem sugerir suporte que não foi implementado.
- Não interprete teste de unidade verde como evidência visual: screenshots do Qt e testes de interação em Linux e Windows precisam passar antes do merge.

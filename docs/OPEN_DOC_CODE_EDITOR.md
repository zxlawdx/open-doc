# Editores Python e SQL da área Dados

## Base e escolha técnica

O PR #67 foi incorporado à main em `7edaf79`. Este incremento usa o PR #71 como base para preservar os fluxos de planilhas, templates, importação de datasets, SQL e execução Python. O Vela continua hospedando a interface no QtWebEngine e a API local autenticada.

CodeMirror 6 foi escolhido para a primeira entrega. Seus modos Python e SQL entram em um único bundle local compilado para Chrome 83 e carregado ao abrir Dados. Monaco oferece um editor derivado do VS Code e usa workers para serviços de linguagem. A comparação considerou a arquitetura documentada e o teste no QtWebEngine foi feito com CodeMirror. Jedi atende a primeira etapa por meio de uma API Python direta, usando o interpretador do aplicativo. A análise estática permite sugerir símbolos sem rodar o script digitado. [CodeMirror](https://codemirror.net/) · [Monaco](https://github.com/microsoft/monaco-editor) · [Jedi](https://jedi.readthedocs.io/)

## Implementado

- CodeMirror com sintaxe, números de linha, desfazer/refazer, busca, fechamento de delimitadores, múltiplas seleções e recolhimento quando disponível no modo.
- Python com sugestões automáticas e Ctrl+Espaço, diagnósticos sintáticos, assinatura e documentação ao passar o cursor. Tab ou Enter aceita uma sugestão. Ctrl+Enter executa pelo fluxo local com confirmação.
- SQL com sugestões de palavras-chave, da tabela `dados` e das colunas do dataset selecionado. Trocar o dataset atualiza o esquema e mantém o texto da consulta.
- Dependências novas são CodeMirror e seus componentes licenciados no arquivo de notices, e Jedi com Parso (MIT). A instalação não adiciona bibliotecas científicas pesadas.

## Verificação manual no Linux Mint e no Windows

1. Inicie o Open Doc pelo interpretador, abra Dados e selecione um dataset com a coluna `nome`.
2. Abra Python local, digite `import pathlib as p` e, na linha seguinte, `p.Pa`. Use Ctrl+Espaço e aceite `Path`.
3. Abra uma chamada como `p.Path(` e confira a assinatura. Introduza uma expressão inválida e confira o diagnóstico.
4. Escreva `SELECT * FROM dados WHERE nom`, aceite `nome`, complete a consulta e execute com Ctrl+Enter. Troque de dataset e confira as novas sugestões.
5. Execute o exemplo Python com Ctrl+Enter e confirme que o console mostra a contagem de registros.

[Python no QtWebEngine](images/code-editor/autocomplete-python.png) · [SQL no QtWebEngine](images/code-editor/autocomplete-sql.png)

## Pendências

A análise tem foco em sintaxe e símbolos inferíveis por Jedi. Colunas de DataFrames inferidas pelo conteúdo, refatorações de linguagem, correções rápidas, formatação avançada e LSP completo seguem pendentes. Python contextual e execução Python exigem iniciar pelo interpretador. Seleção de interpretador, ambientes por projeto e pip são o próximo incremento do roteiro. Dashboard e Colab permanecem nas fases posteriores.

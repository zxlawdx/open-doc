# Roadmap

Este roadmap separa o que já está funcionando do que ainda está em evolução ou planejado. Ele deve ser atualizado sempre que uma capacidade passar de experimental para suportada.

## Concluído / disponível

- base desktop local-first no Vela Framework;
- editor visual estruturado;
- persistência SQLite, autosave e recuperação;
- documentos recentes e operações básicas de biblioteca;
- importação DOCX editável;
- modelo rico `opendoc-rich-v1`;
- exportação DOCX, PDF, HTML e Markdown;
- páginas, margens, orientação e quebras;
- fontes locais e tipografia avançada;
- tabelas;
- localizar/substituir;
- temas claro, escuro e sistema;
- QA real no QtWebEngine;
- refatoração dos estilos por módulos e responsividade desktop.

## Em evolução

- maior fidelidade de round-trip DOCX;
- paginação mais precisa;
- tratamento de estruturas OOXML complexas;
- refinamento de tabelas e objetos que atravessam páginas;
- compatibilidade visual entre Windows e Linux;
- documentação e matriz formal de capacidades por formato.

## Próximas frentes

### PDF

- leitura robusta de documentos grandes;
- renderização paginada/virtualizada;
- anotações;
- desenho livre sobre páginas;
- edição quando tecnicamente segura;
- exportação preservando anotações e conteúdo original.

### Caneta e mesa digitalizadora

- entrada por stylus/mesa digitalizadora;
- desenho e escrita manuscrita sobre documentos;
- camada de tinta separada do conteúdo base;
- reconhecimento opcional de escrita manuscrita;
- conversão de escrita para texto usando a fonte escolhida pelo usuário;
- suporte a pressão e borracha quando o dispositivo/stack expuser esses dados.

### PPTX

- leitura da estrutura de apresentações;
- renderização de slides;
- edição incremental;
- preservação de objetos não suportados;
- exportação sem destruição silenciosa do arquivo original.

### Experiência de edição

- menus de contexto mais completos;
- melhorias na régua e controles de layout;
- seleção e manipulação de objetos gráficos;
- suporte mais rico a imagens;
- revisão visual de compatibilidade por documento.

## Princípio do roadmap

Nenhuma feature deve aparecer como concluída apenas porque existe um botão ou protótipo visual. Uma capacidade só entra como suportada quando possui implementação funcional, persistência/exportação coerente e validação suficiente para não colocar o documento do usuário em risco.
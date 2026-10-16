# Recursos

Esta página resume os recursos já implementados no Open Doc.

## Edição

- editor visual estruturado;
- títulos, parágrafos, listas, citações e código;
- negrito, itálico, sublinhado e tachado;
- sobrescrito e subscrito;
- cores, alinhamento, espaçamento e recuo;
- fontes do sistema e fontes TTF/OTF/TTC importadas;
- tamanho de fonte entre 1 e 512 pt;
- links HTTP, HTTPS e `mailto`;
- desfazer/refazer com histórico limitado;
- localização e substituição de texto.

## Páginas

- modo com páginas e fluxo contínuo;
- tamanho e orientação de página;
- margens configuráveis;
- quebra manual com `Ctrl+Enter`;
- inserção de página em branco;
- zoom de 50% a 150%;
- régua informativa.

A paginação é aproximada e não promete equivalência pixel a pixel com o Microsoft Word.

## Tabelas

- criação com tamanho configurável;
- navegação por Tab;
- inserção e exclusão de linhas e colunas;
- mescla horizontal;
- divisão de células suportadas pelo modelo atual.

## Documentos e persistência

- criação, renomeação, duplicação e exclusão;
- documentos recentes;
- salvamento manual e por `Ctrl+S`;
- autosave a cada 30 segundos;
- recuperação persistente após pausa de digitação;
- revisões transacionais;
- detecção de conflito sem sobrescrita silenciosa;
- opção de salvar como cópia.

## Importação e exportação

### Importação

- DOCX editável;
- Markdown;
- TXT;
- PDF/PPTX preservados na biblioteca conforme capabilities atuais.

### Exportação

- DOCX;
- PDF;
- HTML;
- Markdown.

A gravação de exportações usa fluxo atômico e diálogo nativo de "Salvar como".

## Interface

- temas claro, escuro e sistema;
- papel permanece branco no modo escuro;
- menus clássicos;
- toolbar responsiva por grupos;
- outline de títulos navegável;
- confirmação nativa de fechamento com alterações pendentes;
- navegação por teclado nos menus.

## Segurança e comportamento local-first

- sem conta obrigatória;
- sem CDN no runtime;
- sem execução de macros;
- sem execução de `altChunk` HTML;
- sem downloads externos automáticos;
- API local protegida por token para alterações.
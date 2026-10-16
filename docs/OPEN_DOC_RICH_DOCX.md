# Open Doc Rich Document Model v1 e DOCX editável

Base inicial: `4cb79289d375e2566ef5c5c79bd7d2c61a64f95a` (main).
O HEAD de entrega é o commit final de integração que inclui este relatório. Os commits
anteriores desta entrega adicionam cada módulo/fixture novo separadamente.

## Comportamento entregue

Arquivo → Abrir/importar → selecionar DOCX → documento abre na folha editável.
A biblioteca recebe capabilities do backend, tornando DOCX clicável. Recentes
reabre o JSON persistido sem reprocessar o arquivo original. O runtime permanece
VelaApp, OpenDocBridge/BaseBridge, render_template, roteamento/API e CLI Vela.
Não foi criado servidor ou janela de produção paralelo.

A fonte canônica de documentos ricos é `opendoc-rich-v1`. O JSON nunca contém
HTML do editor ou mídia base64. HTML é construído com DOM seguro; mídia raster
é solicitada por ID via API autenticada e fica somente no cache de renderização.
Markdown é intercâmbio simplificado e fica somente para leitura no modo avançado
de documentos ricos. Documentos Markdown legados continuam editáveis.

## Modelo e SQLite

`app/document_model/schema.py` define dataclasses de texto, estilo, parágrafo,
lista, tabela/célula/linha, seção e documento. Nós importados ampliam o schema
com `field`, `note-reference`, `opaque-ooxml`, XML/propriedades originais e
continuações de mesclagem vertical. A validação limita versão, grafo, IDs,
profundidade, quantidade de nós, tipos, medidas, cores, links e estilos.

A migration inspeciona PRAGMA antes de adicionar, em **documents e recovery**:

| Coluna | Uso |
| --- | --- |
| content_format | markdown ou opendoc-rich-v1 |
| content_json | Modelo estruturado validado |
| source_kind | native ou docx |
| source_path | Origem da cópia importada |
| source_sha256 | Hash do DOCX original |

A tabela `legacy_backups` guarda o Markdown anterior à primeira promoção para
rico. Alteração, incremento de revisão e backup são transacionais. O histórico
anterior não é apagado por migration. Revisões concorrentes continuam recusadas;
salvar sem modelo sobre documento rico é recusado. Recovery inclui todo o modelo.
Conexões SQLite são fechadas explicitamente após transações.

Os pacotes ficam em `.veladata/packages/<UUID>/original.docx`, `manifest.json`
e `media/<sha256>`. Original nunca é escrito pelo fluxo de edição/exportação.
Salvar cópia também copia o pacote e a mídia referenciados.

## Reader, writer e fidelidade

Responsabilidades foram concentradas em módulos reais: package, relationships,
styles, numbering e importer; o writer concentra a escrita OOXML em package_writer.
Não foram criados módulos vazios para cada propriedade. Namespaces e unidades
são compartilhados por reader/writer.

| Recurso | Leitura/modelo/editor | Exportação DOCX |
| --- | --- | --- |
| Parágrafos e títulos | Estilos/defaults, basedOn com proteção contra ciclo, formatação direta, outline | pPr, pStyle, outlineLvl e propriedades preservadas |
| Runs e tipografia | Fonte/tema, tamanho, B/I/U/strike, cor/highlight, sup/sub, idioma, caps e espaçamento | rPr e formatação direta sobre propriedades originais |
| Alinhamento/espaçamento/recuos | jc, spacing, ind, flags e tabs | Propriedades originais e alterações conhecidas; tabs importadas preservadas |
| Listas | numId → abstractNum → nível, formato/padrão/start e overrides | IDs originais ou numbering novo sem colisão |
| Tabelas | Grid, largura, shading, bordas, células mescladas, parágrafos/listas em células | tcPr, gridSpan/vMerge, tblGrid, bordas e propriedades de linha |
| Imagens inline | Raster local validado; largura/altura/alt | DrawingML e relações originais preservados |
| Imagens flutuantes | Aproximação inline com aviso | Âncora original preservada |
| Seções | Dimensões, orientação, margens, colunas e referências | sectPr original no corpo e seção final |
| Headers/footers | Subdocumentos; preview de leitura do primeiro | Partes originais preservadas sem reescrita |
| Footnotes/endnotes | Subdocumentos e marcadores clicáveis | Referências e partes originais |
| Campos simples/complexos | Instrução, display e XML; não recalculados | Sequência XML preservada |
| SDT, bookmarks, VML, alterações e objetos desconhecidos | Nós opacos identificados, não executáveis | XML preservado quando o usuário mantém o nó |
| Tema, fontTable, custom XML, docProps | Guardados no pacote | Bytes de partes não alteradas preservados |

A classificação de importação é **DEGRADED_WITH_WARNING**, porque a folha é
contínua e não replica todo o layout Word. Elementos não editáveis usam
**PRESERVED_OPAQUE**. Arquivos inválidos/criptografados ou formatos perigosos
não interpretáveis são recusados. Não se promete HIGH_FIDELITY_SUPPORTED para
todo o DOCX nem compatibilidade de 100%.

A cascata cobre defaults, cadeia de estilos de parágrafo/caractere e propriedades
diretas. Não implementa integralmente todos os estilos condicionais de tabelas,
tints/shades e regras especiais de layout do Word. Não há editor de SmartArt,
OMML, OLE, ActiveX, tracked changes ou comentários; o XML/partes ficam preservados.
Também não há edição de anchors flutuantes ou paginação determinística.

## Frontend e seleção

Módulos: document_model, rich_renderer, rich_serializer, formatting e tables.
Selection/Range continuam no adapter existente editor_commands. Pointer/mousedown
captura a seleção antes de fontes/select/modal; comandos restauram-na. Fontes e
tamanhos usam divisão dos nós de texto selecionados, não fontName/fontSize via
execCommand. B/I e comandos estruturais nativos continuam encapsulados durante
a transição; o estado final sempre passa pelo serializer estruturado.

Runs equivalentes adjacentes são normalizados. Uma formatação normaliza somente
os blocos afetados, restaurando o bookmark. Digitação nativa atualiza o bloco
superior afetado quando a estrutura continua estável; mudanças estruturais usam
serializer completo. Não há rerender completo do rich DOM a cada tecla. A
serialização/hash/cache/autosave ainda têm custo proporcional ao modelo; isso
não é um engine virtualizado nem prova de desempenho para todo DOCX de 100 páginas.

Tabela mantém blocos dentro das células: texto editável, Enter nativo para novos
parágrafos, Tab/Shift+Tab entre células existentes e botão de inserção 2 × 2.
Não foram adicionados controles fictícios de mesclagem ou redimensionamento.

Fontes vêm de QFontDatabase, com fallback fc-list quando não há QApplication;
Inter já é distribuída com licença. Fontes ausentes mantêm nome original e opção
“não instalada”. Não são redistribuídas fontes Microsoft. Tamanhos: 1–512 pt;
DOCX tem precisão de meio ponto. A folha/régua usa medidas/margens da primeira
seção; outras seções permanecem no modelo/pacote, sem paginação visual exata.

## Limites e segurança

- DOCX: 100 MiB compactado, 200 MiB expandido, 5.000 entradas.
- Parte XML: 16 MiB; mídia: 32 MiB; raster: até 40 milhões de pixels.
- Modelo: 16 MiB; elemento XML opaco: até 1 MiB; grafo e profundidade limitados.
- XML sem rede, entidades ou DTD (inclusive declaração UTF-16).
- ZIP sem traversal, nomes duplicados ou criptografia; nenhuma extração de nomes ZIP.
- Não executar macros, ActiveX, scripts, altChunk, links ou imagens externas.
- Transporte JSON Bottle configurado separadamente: modelo + Markdown + envelope;
  seu limite padrão de 100 KiB impedia o save rico, agora coberto por regressão HTTP.

PDF e Markdown passam pelo adapter lossy. HTML é independente e seguro, mas não
reproduz todas as propriedades de layout/lista/notas. Essas exportações retornam
`lossy: true` e warnings; a UI informa a simplificação. DOCX é a prioridade.
Colagem continua texto simples e inserção de novas imagens pela UI não foi adicionada.

## Testes e evidências

**53 Python + 27 JavaScript aprovados**, além de Black 88, node --check,
build CSS e collectstatic oficiais. Os testes anteriores da toolbar e do bootstrap
com replaceChildren ausente continuam ativos.

Fixtures são geradas por `tests/docx_fixtures.py`: fontes Arial/Times/Courier/Aptos,
B/I/U/strike/cor/highlight/sup/sub, listas decimal/letter/roman e bullet, tabela
3×4 com colspan/rowspan e lista em célula, imagem, quebras, hyperlink, duas seções,
header/footer, notas, campo PAGE complexo, SDT e customXml/item1.xml.

Round-trip relê por python-docx, testa CRC/ZIP sem duplicatas, referências de
relationships válidas e igualdade byte a byte de todas as partes originais não
alteradas, inclusive mídia, headers/footers, notas e custom XML. Frontend testa
fonte/tamanho/cores/alinhamento/undo/redo/save/reopen no modelo, tabela, segurança
e modo Markdown protegido. JSDOM modela execCommand explicitamente; a prova do
engine real é feita no Qt.

QA real: Linux, PyQt 5.15.11, PyQtWebEngine 5.15.7, renderer
QtWebEngine/5.15.19 Chrome/87.0.4280.144, pywebview 6.2.1 e Vela 0.2.2 no commit
fixado. Offscreen/software, com sandbox desabilitada apenas para QA. Não houve
validação física em Windows nem interação manual com o popup nativo de arquivo.
O QA substitui só a escolha do picker e usa menu, bridge, API, SQLite e renderer
reais. Fonte/tamanho/formatação usam eventos nos controles da UI; texto em célula
é digitado por QTest. O teste anterior também usa mouse CDP real para B/undo/redo.

Marcadores aprovados no log:

```text
NATIVE_RICH_DOCX_IMPORT_FORMAT_TABLE_SAVE_EXPORT_OK
QT_RICH_CAPTURE_1366_1600_1920_TABLE_OK
NATIVE_USER_DOCX_IMPORT_FOOTER_FONTS_ROUNDTRIP_OK
NATIVE_RICH_REOPEN_SEPARATE_PROCESS_OK
NATIVE_QA_COMPLETE
```

O arquivo real `Lista_Exercicios_Fixacao_Aula_02_ML.docx` foi aberto pela UI,
com texto, fontes declaradas, rodapé, largura Letter e margens importados.
A exportação reabriu por python-docx com a sequência de texto dos parágrafos
igual à original. Uma segunda janela Vela/Qt em outro processo abriu o documento
persistido. O arquivo acadêmico não é distribuído nas fixtures públicas.

Capturas sintéticas reais: [1366](images/open-doc/editor-rich-1366.png),
[1600](images/open-doc/editor-rich-1600.png), [1920](images/open-doc/editor-rich-1920.png)
e [tabela](images/open-doc/editor-rich-table-1366.png). Sem overflow global nas
três resoluções. Avisos preexistentes: WebOb/cgi deprecado e clipboard primário
não suportado no offscreen; clipboard padrão e atalhos passaram.

## Referências primárias e licenças

- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs), Apache-2.0:
  renderAsync estável; parsing interno experimental não é usado como modelo.
- [Mammoth](https://github.com/mwilliamson/mammoth.js), BSD-2-Clause:
  referência semântica, não importador visual principal.
- [python-docx](https://github.com/python-openxml/python-docx), MIT:
  bootstrap de pacotes nativos e validação de saída; OOXML avançado fica encapsulado.
- [docxjs-editor](https://github.com/naskio/docxjs-editor), MIT: referência de produto,
  sem incorporar edição de código docx.js ou renderização externa.

Nenhum código desses projetos foi copiado para o reader/editor. python-docx já era
dependência; lxml e Pillow agora estão declarados explicitamente. Vela, migração
Windows/SQLite e sincronização tolerante ao OneDrive continuam preservados.

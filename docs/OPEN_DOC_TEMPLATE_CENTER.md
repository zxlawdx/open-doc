# Central e templates locais

## Auditoria

O Open Doc registra uma página de trabalho no Vela em `apps/open_doc/app.py`. O Vela mantém a janela, o ciclo de vida da página, a ponte nativa e a API local. A página já alternava a biblioteca e os editores sem destruir o controlador de documentos. A Central mantém essa estrutura e usa rotas internas para Início, Documentos, Apresentações, PDFs e Templates. Cada módulo reutiliza as seções de recentes, importados e criação. Os seletores de arquivo e a associação do sistema continuam passando pelo Vela.

O serviço de documentos de texto persiste o modelo rico e suas versões no SQLite do workspace. O serviço de documentos fixos armazena modelos de PDF e PPTX e as cópias das respectivas origens. O organizador administra os arquivos externos importados. O caso de uso `DocumentApplication` agrega essas fontes. As duas listas de recentes são agora ordenadas em conjunto pela última atualização.

Os modelos de fábrica ficam em um catálogo Python, empacotado com o app. O mesmo conteúdo alimenta as miniaturas esquemáticas, a prévia e o material criado. DOCX usa parágrafos e estilos do modelo rico, PPTX usa caixas de texto e slides nativos e PDF gera uma página com espaço para anotações. A criação usa os serviços e exportadores atuais. A biblioteca carrega os metadados uma vez por entrada e aplica buscas, formatos e categorias no cliente. A geração de cada cópia ocorre ao confirmar o uso.

## Próximas etapas

1. Criar o modelo de planilha com células esparsas, coordenadas estáveis e revisões. Integrar persistência e histórico antes de expor a rota no aplicativo.
2. Implementar uma grade virtualizada com navegação por teclado, colagem em bloco, seleção e edição. Medir a latência no QtWebEngine antes de escolher a implementação definitiva. AG Grid Community oferece licença MIT, mas precisa de um protótipo para verificar se suas interações por célula cobrem o MVP. [Licenças do AG Grid](https://www.ag-grid.com/eula/community/)
3. Implementar CSV e TSV com o módulo padrão do Python e avaliar openpyxl para XLSX usando arquivos de referência. Fórmulas precisam de motor separado. HyperFormula oferece GPLv3 ou licença comercial e fica fora do pacote MIT nesta etapa. [openpyxl](https://openpyxl.readthedocs.io/en/stable/usage.html) · [HyperFormula](https://handsontable.com/docs/hyperformula/guide/licensing)
4. Ampliar a biblioteca com favoritos, fixados, templates personalizados e metadados conforme o modelo compartilhado amadurecer. Separar o editor de planilhas da camada analítica. Validar pandas e DuckDB em ambientes isolados, com importação explícita e limites de recursos, antes de expor execução de código.

## Verificação

`tests/app.test.cjs` cobre navegação, filtragem, prévia, cancelamento e criação. `tests/test_template_catalog.py` exercita o endpoint autenticado, cria duas cópias de cada modelo e verifica os arquivos nativos exportados. `tests/test_file_associations.py` verifica que os formatos associados ainda abrem diretamente no editor.

`python tools/qa_template_center.py docs/images/template-center` abre a Central em QtWebEngine e cria cópias em todos os editores. Capturas da [Central](images/template-center/central.png), dos [modelos DOCX](images/template-center/templates-docx.png), dos [modelos PPTX](images/template-center/templates-pptx.png) e dos [modelos PDF](images/template-center/templates-pdf.png).

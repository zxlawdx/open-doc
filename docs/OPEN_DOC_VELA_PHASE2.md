# Open Doc — integração Vela e fase 2

Base: `8b79e799a538fd4422ff97ec642645dfe284fba7`.
Este relatório substitui as descrições de arquitetura e fluxo contínuo das entregas anteriores.
O commit final é identificado na entrega e no histórico de `main`.

## Arquitetura executada

A aplicação usa `VelaApp`, descoberta de `apps.open_doc`, `BaseBridge`, roteador,
templates, servidor HTTP e `CommandRunner` da versão fixada do Vela. `main.py`,
`launcher.py` e `manage.py runapp` entram no mesmo runtime.

| Antes | Agora |
|---|---|
| `app/editor.py` | `apps/open_doc/services/document_service.py` |
| `app/runtime.py` | `apps/open_doc/services/container.py` |
| `app/config.py`, `app/workspace.py` | services de preferências/workspace |
| `app/router.py` | `apps/open_doc/api.py` e pacote `views/` |
| `app/importers/docx` | `apps/open_doc/parsers/docx` |
| `app/document_model`, `app/exporters` | mesmos módulos dentro de `apps/open_doc` |
| `ui/templates`, `ui/static`, `ui/styles` | templates/static/styles do app |
| `tools/sync_frontend.py` | removido |

`app/` e `ui/` foram removidos. Não há shim para esses imports. Não há cópia de
source no boot, interceptação de collectstatic, servidor paralelo ou escrita do
CSS do produto sobre `staticfiles/css/vela.bundle.css`.

O shell offline usa **o bundle gerado pelo pipeline oficial**. No primeiro build:
`npm ci`, `python tools/build_css.py`, `python manage.py collectstatic`.
`collectstatic --no-tailwind` é oficial e funciona para atualização incremental;
em uma árvore limpa, esse comando deliberadamente não compila o bundle do shell.
Uma distribuição deve levar o `staticfiles` já compilado. O Node é dependência de
build/QA, não do runtime distribuído.

## Exportação e diagnóstico

O fluxo anterior chamava um endpoint HTTP e esperava JSON incondicionalmente.
FPDF/ZIP/Pillow e outras exceções não capturadas podiam alcançar a página de erro
HTML do Bottle. Não havia diálogo de destino. Esse defeito de tratamento foi
confirmado no código; **o traceback original do Windows não foi fornecido e não
foi reproduzido como ocorrência real nessa plataforma**.

A cobertura de falha injeta `RuntimeError("private internal failure")` no writer
após escrever conteúdo parcial. O teste confirma que o erro é convertido em
`ExportError`/objeto da bridge, o destino anterior mantém seus bytes e o temporário
é removido. A bridge registra traceback no logger, sem expor detalhes internos à UI.
Não se apresenta esse traceback de teste como diagnóstico do computador do usuário.

Fluxo atual: flush do documento → `pywebview.api.export_document` →
`FileDialog.SAVE` → `ExportService` → temporário na pasta escolhida com extensão
real → `os.replace`. Cancelar não gera arquivo. O cliente HTTP não pode enviar
um caminho de destino. A rota legada continua disponível para compatibilidade,
com resposta de erro estruturada, mas a UI de exportação usa a bridge nativa.

DOCX/PDF/HTML/MD foram gerados em destinos com espaços e acentos; DOCX foi relido
com python-docx e `ZipFile.testzip`, PDF com pypdf. Extensões são garantidas.
Ctrl+S continua salvando internamente. O seletor físico do Windows não foi
acionado neste ambiente Linux; o QA substitui só sua escolha de caminho.

## Fontes

`FontService` valida TTF/OTF/TTC com FontTools, limita 50 MB, identifica por SHA256,
copia para `.veladata/fonts` e mantém `index.json` atômico. O Qt registra as fontes
com `QFontDatabase.addApplicationFont`; o catálogo é atualizado sem restart.
Importar/gerenciar/atualizar ficam em Ferramentas. Só fontes importadas podem ser
removidas. O documento mantém o nome de uma fonte ausente e usa fallback visual.

Os testes geram fontes TTF e OTF originais mínimas, sem redistribuir fontes do
sistema. Foram verificadas persistência, deduplicação, rejeição e remoção segura.
No Qt real, uma família nova foi importada pela bridge, aplicada à seleção,
salva e encontrada no DOCX exportado. O binário não é embutido automaticamente
no DOCX. O receptor precisa ter a família instalada.

PDF tenta resolver uma família importada; se o writer não puder incorporá-la,
usa Inter e retorna aviso. PDF permanece simplificado: uma família principal,
sem fidelidade de fontes por trecho, imagens e seções do Word.

## Páginas editáveis

`pagination.js` move os nós editáveis entre folhas de dimensões fixas. Parágrafos
longos são fragmentados com Range preservando estilos; tabelas sem mescla vertical
podem se dividir entre linhas. Fragmentos continuam editáveis e são recombinados
pelo serializer em blocos lógicos. Não há cópias de conteúdo para simular screenshots,
nem overflow escondido. Quebras automáticas não entram no JSON.

O modelo aceita `page_break` manual em `opendoc-rich-v1`. Ctrl+Enter divide o
parágrafo no cursor e insere a quebra; undo/redo, recovery e save usam o histórico
do documento inteiro. O writer DOCX gera `w:br type="page"`; a importação preserva
essas quebras. As seções dão tamanho, orientação e margens. A edição das dimensões
atualiza os `sectPr`, incluindo os que estão nas propriedades de parágrafos.

O reflow começa na folha alterada e mantém o prefixo de páginas existente.
A medição é debounced e agendada em requestAnimationFrame. O QA alterou a última
folha de um documento com parágrafo longo e tabela de 45 linhas, verificando que
a primeira folha manteve sua identidade DOM e que texto/linhas não desapareceram.

Clique esquerdo no chrome, margem e espaço entre folhas abre o menu de página;
clique no texto mantém a edição. Há ações acima/abaixo, quebra e configuração.
Escape/clique externo fecham o menu; setas navegam suas opções.
Arquivo > Configuração da página oferece A4, Carta, Ofício, personalizado,
retrato/paisagem e margens. Exibir alterna páginas/contínuo, com preferência
persistente e migração dos settings antigos. Zoom escala as folhas; a statusbar
mostra Página X de Y e acompanha seleção/scroll.

## Operações P0

- Localizar/substituir no modelo, inclusive em runs formatados e células, com
  próximo/anterior, substituir/substituir todos, undo e persistência. Não opera
  sobre strings de innerHTML. Ctrl+H abre os controles de substituição.
- Home: renomear, duplicar e excluir registros internos com controle de revisão
  e confirmação para excluir. Arquivos importados originais são preservados.
- Tabelas: tamanho escolhido, linhas/colunas acima/abaixo/esquerda/direita,
  exclusão de linha/coluna/tabela, mescla horizontal e divisão horizontal.
  Menu de célula e opções em Formatar usam as mesmas operações.

## Validação

- 65 testes Python e 33 testes JS (incluindo estrutura, exportações, cancelamento,
  atomicidade, fontes, páginas, view modes, replace e operações de tabela).
- Black 88, sintaxe dos módulos JS, build CSS e collectstatic oficial.
- Vela/QtWebEngine real no Linux: bootstrap/remount, seleção, toolbar, menus,
  formatação, importação DOCX, edição de célula por QTest, exportação e reabertura
  em segundo processo. O DOCX fornecido pelo usuário passou pelo round-trip.
- Qt: overflow real com parágrafos e tabela longa; dimensões de conteúdo medidas;
  Ctrl+Enter por QTest; undo/redo; fonte nova; menu esquerdo; páginas/contínuo;
  preservação da primeira folha durante edição na última.
- Capturas Qt em 1366/1600/1920, temas claro/escuro, sem overflow horizontal global.

## Limites restantes

A paginação é aproximada. Campos, layout complexo, estilos condicionais,
keep-with-next, widow/orphan, colunas e fontes métricas diferentes podem alterar
quebras em relação ao Word. Tabelas com mesclas verticais e objetos maiores que
uma folha têm saída de segurança: permanecem acessíveis, podendo exceder a área.
A edição estrutural de linhas/colunas em tabelas mescladas pede divisão prévia;
a divisão vertical ainda não é suportada. Cabeçalhos/rodapés são preservados e
mostrados como preview de leitura, não são editores repetidos por página.
Comentários, colaboração e revisão continuam roadmap, sem botões fictícios.
O popup físico e os locks específicos de Windows/OneDrive precisam de teste no
Windows; a migração SQLite segura anterior foi preservada.

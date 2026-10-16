# PDF, tinta e escrita local no Vela

Base inspecionada: `de6de08b153a96e41f3bf1d80e5bbed054016937`, branch `main`.
Esta implementação usa `VelaApp`, `BaseBridge`, rotas `@api`, templates e
collectstatic oficiais. Não há outro servidor ou shell de produto paralelo.

## Usar

Atualize as dependências e os recursos locais:

```powershell
git pull origin main
python -m pip install -r requirements.txt
npm ci
node tools/build_vendor_js.mjs
python tools/build_css.py
python manage.py collectstatic
python manage.py runapp
```

Arquivo > Importar abre PDF, DOCX e PPTX. PDF usa leitura local com texto
selecionável, navegação, busca por páginas, marcadores, miniaturas e ajuste de
largura/página inteira. O original digital permanece separado da tinta.
A busca aponta as páginas com resultados; não altera o texto original do PDF e
não faz OCR das páginas escaneadas.

A barra de tinta oferece selecionar, caneta, marca-texto, borracha de traço e
escrita. Toque de palma não cria traços. Pontos incluem pressão, inclinação e
instante quando o driver os disponibiliza. Mouse usa pressão padrão. O desenho
fica no modelo e participa de desfazer/refazer, salvamento e recuperação.
A borracha elimina traços completos; não recorta pedaços de um traço.

O menu de margem/intervalo das páginas usa **botão direito**. Clique esquerdo
mantém seleção. Dentro do texto editável, permanece o menu nativo; tabelas mantêm
seu menu próprio. PDF/PPTX têm menu contextual de navegação e ferramentas.

## Manuscrito para texto e fontes

Escolha **Escrita**, escreva e pressione **Converter escrita**. O processamento
ocorre fora da thread da interface. Revise o texto no diálogo; **Manter tinta** e
**Cancelar** conservam os traços. Só **Inserir texto** substitui o grupo reconhecido.
Escolha fonte e tamanho na barra de tinta antes de inserir. DOCX recebe um
parágrafo/run nativo, PDF recebe um TextOverlay com texto nativo no export, PPTX
recebe uma caixa de texto OOXML editável.

Para importar fontes: **Ferramentas > Importar fontes**, escolha TTF/OTF/TTC.
O catálogo é atualizado sem reiniciar. **Gerenciar fontes** remove apenas as
fontes importadas no Open Doc. A barra de tinta lê esse mesmo FontService e atualiza a lista após a importação. Arial pode não existir no Linux: a visualização usa
Inter/sans-serif como fallback; o export PDF avisa sobre fallback. Fontes
importadas compatíveis são incorporadas no PDF.

### Windows Ink opcional

```powershell
python -m pip install -r requirements-windows-ink.txt
```

Instale o recurso de escrita à mão do Português no Windows. O adaptador usa
PyWinRT 3.2.1 numa thread MTA. Ausência do pacote/idioma ou falha de reconhecimento
retorna mensagem e conserva a tinta; não anuncia reconhecimento disponível sem
backend. A API foi conferida nos stubs de PyWinRT, mas a execução real depende de
Windows e não foi validada neste ambiente Linux.

### PaddleOCR opcional, sem downloads ocultos

```powershell
python -m pip install -r requirements-ocr.txt
```

Providencie modelos compatíveis com PaddleOCR 2.x por conta própria em
`<workspace>/.veladata/models/`. Crie `paddle.json` nesse diretório:

```json
{"det_model_dir":"det-local","rec_model_dir":"rec-latin-local"}
```

Ambos os diretórios precisam conter `inference.pdmodel` e os demais arquivos do
respectivo modelo. O adaptador desativa o classificador de ângulo e fornece os
dois caminhos explicitamente. Não baixa modelos. OCR genérico pode errar escrita
cursiva; revisão humana é parte do fluxo, não existe garantia de acerto.

## PPTX

python-pptx preserva e exporta a apresentação; não é um renderizador de slides.
Instale LibreOffice e disponibilize `soffice` no PATH para gerar uma prévia PDF
em processo headless com perfil e diretório temporários exclusivos. Sem isso, o
PPTX é importado/preservado e a tela explica a indisponibilidade da prévia. Não há
miniatura fictícia nem falha no startup. Após instalar, importe novamente.
O PDF de prévia pode variar do PowerPoint conforme fontes e recursos do slide.
A exportação PPTX adiciona uma imagem transparente de tinta do tamanho do slide
mais caixas de texto nativas. PDF usa a prévia como base quando disponível.

## Persistência, segurança e exportação

- Modelo fixo `opendoc-fixed-v1`, separado de `opendoc-rich-v1`, com origem,
  SHA-256 e superfícies. SQLite cria tabelas de documentos fixos e recuperação
  idempotentemente. Saves usam revisão otimista; conflitos conservam o estado.
- Pontos e contornos normalizados de 0 a 1, pressão 0 a 1, tilt -90 a 90. O
  backend rejeita números inválidos, IDs duplicados e trabalho acima dos limites.
- Sem IPC por ponto: Pointer Events/captura/coalescidos são locais; RDP ocorre
  após o traço. perfect-freehand gera o contorno no espaço físico de cada página.
- PDF.js legacy + worker, CMaps e fontes locais, empacotados com core-js para
  QtWebEngine/Chromium 87. Renderiza página visível ±2 e libera canvases distantes;
  miniaturas têm resolução pequena e carregamento por visibilidade.
- Conteúdo PDF servido por ID com token da sessão, Range e `no-store`. Nenhum
  endpoint aceita um caminho absoluto vindo do navegador. Originais internos
  são verificados por hash antes do acesso/exportação.
- Salvar como usa diálogo nativo, arquivo temporário com extensão correta e
  substituição atômica. Recusa destino que seja uma cópia intacta do original.
- PDF: clona o pacote, normaliza rotações em cópia, mescla somente a camada de
  anotações em alta resolução e texto nativo. O arquivo de origem não é escrito.
- DOCX: adiciona PNG transparente próprio e DrawingML `wp:anchor` relativo à
  página no pacote existente. Partes desconhecidas permanecem byte a byte.
  O vínculo usa o primeiro bloco da página: se o Word repaginar diferente do
  editor, a âncora pode cair em outra página. Tinta não acompanha reflow semântico
  de caracteres. Use o modo Com páginas para desenhar em DOCX.
- Markdown/HTML simplificados não incluem tinta. DOCX e PDF a conservam. O PDF
  do editor rico ainda usa paginação simplificada: a tinta é sobreposta por número
  de página e pode divergir do layout do editor; o exportador apresenta aviso.
  O PDF do leitor fixo usa a geometria do original.

## Validação e limites conhecidos

`pytest`: 80 aprovados e 1 integração Windows Ink ignorada no Linux.
`npm test`: 40 aprovados. A integração Windows pode ser habilitada explicitamente
com `OPEN_DOC_TEST_WINDOWS_INK=1` no ambiente adequado. Incluem pressão/coalescidos, rejeição de palma,
cancelamento, histórico, reconhecimento simulado, fonte nativa no run, revisões,
recuperação, autenticação/Range/traversal, PDF com rotações 0/90/180/270,
original intacto, tinta ancorada DOCX e texto nativo em três slides PPTX.
Fixtures pequenas são geradas pelos testes, sem documentos pessoais no repositório.

`python tools/qa_desktop.py`: Vela/Qt real, teclado QTest, edição Word/tabelas,
paginação, fontes importadas, menu direito, exportação e matriz claro/escuro nas
resoluções 1366×768, 1600×900 e 1920×1080.
`python tools/qa_ink.py`: PDF real de 300 páginas no Qt, canvases limitados,
camada de texto transparente e SVG ocupando a página, caneta sintética com
pressão/tilt, undo/redo, reconhecedor falso, revisão, texto nativo, save e export.
Capturas em `docs/images/ink/`. Nenhum teste sintético equivale a mesa física.

`python tools/qa_tablet.py` é diagnóstico interativo de Pointer Events versus
QTabletEvent, em lotes de 16 ms. Execute no Windows e no hardware pretendidos e
registre pressão, tilt, taxa e borracha. Não foi ativado um fallback QTabletEvent
no produto: a captura Pointer Events funcionou no ambiente testado; falta medir
o comportamento do driver/mesa no Windows antes de justificar essa adaptação.

PPTX com LibreOffice e reconhecedores reais também exigem validação no ambiente
onde esses programas/modelos estiverem instalados. Não foram baixados modelos
nem afirmados testes físicos ou Windows. Licenças e versões estão em
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

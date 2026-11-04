# Open Doc — Anotações PDF e editor de apresentações

## Referências estudadas (lógica, não cópia de implementação)

- [PDF Markup](https://marketplace.visualstudio.com/items?itemName=maxhoelper.pdf-markup):
  modos de seleção/tinta e persistência de anotações PDF interoperáveis.
- [Dokflow PDF Editor](https://github.com/mugonat-systems/dokflow-pdf-editor):
  extensões por camadas sobre PDF.js e ações contextuais sem modificar o viewer.
- [Casual Slides](https://github.com/CasualOffice/slides):
  painéis de miniaturas, criação de slides, comandos de objetos e inspector.
- [OpenPresentation OPF](https://www.openpresentation.org/docs/get-started):
  separação entre modelo de slide, geometria, renderização e exportação.
- [python-pptx](https://python-pptx.readthedocs.io/en/latest/user/autoshapes.html):
  texto e formas nativas editáveis em arquivos PPTX.

A arquitetura do Open Doc **não incorpora o código desses aplicativos**. A
implementação é original e usa as bibliotecas já presentes no runtime Vela.

## PDF: notas e comentários

O PDF original permanece intocado. As anotações ficam persistidas em
`opendoc-fixed-v1`, em coordenadas PDF, e são exportadas como objetos padrão:
`/Highlight`, `/Underline`, `/StrikeOut` e `/Text`.

Para adicionar uma nota, abra um PDF, selecione **Nota adesiva** na barra de
ferramentas, clique na página e escreva no painel lateral. A lista permite
buscar, filtrar por tipo, ajustar cores e copiar um resumo Markdown.

## Slides: editor nativo (primeira entrega)

Na biblioteca inicial, **Criar e abrir → Apresentações** cria um novo deck
PPTX local 16:9. É possível:

- criar, duplicar, excluir e reordenar slides;
- inserir caixas de texto, retângulos e elipses;
- arrastar, redimensionar, selecionar e alterar a ordem das camadas;
- editar texto, cores, medidas, fundo e notas do apresentador;
- usar desfazer/refazer e exportar PPTX editável.

`SlideDeckCommands` administra mutações no modelo; `SlideStudio` fornece a
interface do canvas, com apenas **uma alteração de histórico por gesto**;
`SlideModelValidator` rejeita geometria fora do papel, tipos e textos
inválidos; `SlideDeckExporter` produz formas OOXML reais via
`python-pptx`. O runtime, a janela, SQLite, a exportação e os comandos
continuam pertencendo ao **Vela Framework/Open Doc**.

### Limitações explícitas

Um PPTX **importado** continua disponível para leitura/anotação, mantendo o
arquivo de origem intacto; seus elementos internos complexos **ainda não**
são transformados em objetos deste novo editor. Isso requer leitura
não destrutiva de masters/layouts, SmartArt, imagens, gráficos e animações.
O formato nativo criado no Open Doc não oferece animações, transições,
gráficos ou colaboração em tempo real nesta primeira entrega.

Nenhum comando exige instalar Node.js no computador corporativo:

```powershell
python tools/offline_assets.py prepare
python manage.py runapp
```

Ao testar um PR empilhado, use a branch explícita antes de preparar os assets.
Não execute `collectstatic` sem Node.

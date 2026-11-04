# Open Doc — Editor SVG de apresentações (Qt / Windows e Linux)

## Diagnóstico reproduzido

1. **Canvas com zoom em 25%:** a chamada `fit(false)` no carregamento da apresentação era feita enquanto `data-home-view=true` mantinha o editor oculto. Com `clientWidth=0`, o zoom era limitado ao mínimo. O evento `open-doc:view-ready` agora solicita ajuste depois de mostrar a área de trabalho.
2. **Formas sem pixels visíveis:** o navegador QtWebEngine baseado em Chromium 83 não interpreta consistentemente `inset:0` em containers posicionados. Os objetos podiam existir no JSON/DOM e ter retângulos 0×0. As formas agora são posicionadas como filhas diretas da `.fixed-surface` usando coordenadas CSS px derivadas do modelo normalizado e zoom, sem depender das dimensões do overlay.
3. **Sobreposição:** fundo, formas e tinta precisam de pilha definida. A camada de fundo não recebe eventos de ponteiro e as formas ficam acima dela. Na exportação nativa PPTX a tinta é desenhada antes das formas OOXML.
4. **Ferramentas:** ao inserir uma forma, o modo de seleção é reativado; o overlay da caneta não pode interceptar a edição.

## Arquitetura e escopo

- `SlideModelValidator`: valida tipos e limites de objetos, nomes opcionais, rotação e contorno.
- `SlideSvgRenderer`: desenha `rect`, `ellipse`, `line` e `polygon` nativos, sem CDN ou `foreignObject`.
- `SlideDeckCommands`: mutações com histórico por operação; duplicar, organizar e excluir.
- `SlideStudio`: viewport, barra de ícones locais, seleção, arrastar, redimensionar, pan, inspector.
- `SlideDeckExporter` com `python-pptx`: objetos e caixas de texto continuam editáveis.
- Tipos: texto, retângulo, retângulo arredondado, elipse, linha, seta, triângulo e losango.
- Os PPTX importados continuam no leitor/anotador original, sem edição destrutiva.

O editor foi inspirado em padrões de modelagem/edição de projetos livres como OpenPresentation OPF (MIT), Casual Slides (verificar licença antes de importar código) e python-pptx (MIT). Não foi copiado código de terceiros não licenciado para redistribuição; o renderizador e os símbolos adicionados são implementação própria.

## Teste Windows (PowerShell)

```powershell
git fetch origin
git switch fix/slide-visibility-ink-geometry-20261104
git pull --ff-only origin fix/slide-visibility-ink-geometry-20261104
# Ambiente virtual com Vela e dependências do Open Doc previamente instalados
python tools/offline_assets.py prepare
python manage.py runapp
```

**Validação manual:** criar nova apresentação; observar se o slide ocupa a área disponível (sem zoom preso a 25%); inserir retângulo, elipse e texto; verificar cores visíveis e alças; selecionar e mover; usar as novas formas, alterar cor/espessura/rotação; duplicar e renomear; pan pelo botão central ou Espaço+arrastar; salvar e reabrir; exportar PPTX e abrir no PowerPoint/LibreOffice. Também conferir desenho PDF e borrachas parciais.

## Evidências automatizadas

- `tests/slide_editor.test.cjs` — SVGs, modelo, propriedades e eventos.
- `tests/test_native_slide_editor.py` — validação, persistência e OOXML.
- `tools/qa_ink.py` + `tools/qa_slide_capture.cjs` — captura no Qt real, `getBoundingClientRect`, hit-test e amostragem de pixels.
- Workflows `linux-qt` e `windows-qt` guardam artefatos em `docs/images/ink`.

A aprovação final exige CI verde e confirmação visual. Os nomes e layouts dos programas de terceiros não são uma garantia de fidelidade 1:1 em slides importados.

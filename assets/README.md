# Recursos visuais do Open Doc (build Vela)

Esta pasta segue a arquitetura documentada do **Vela Framework**: o comando `buildapp` já inclui `assets/` no pacote nativo, sem modificar o runtime.

| Caminho | Finalidade |
| --- | --- |
| `assets/icons/open-doc.ico` | Ícone **Windows** do instalador/executável |
| `assets/icons/open-doc.icns` | Ícone **macOS** |
| `assets/icons/open-doc.png` | Ícone de origem, exportação Linux, branding |
| `assets/branding/` | Materiais aprovados: marca, paleta e guia visual |
| `apps/open_doc/static/icons.svg` | Sprite da interface; símbolo `#file-text` é o ícone **atual** do cabeçalho |
| `apps/open_doc/static/brand/` | Logos SVG e ilustrações utilizadas pela **interface web** |

### Ativar uma logo oficial

1. Desenhe/exporte um SVG vetorial e uma versão PNG quadrada. Preserve o arquivo mestre em `assets/branding/`.
2. Gere um `.ico` (Windows) ou `.icns` (macOS) a partir da marca aprovada.
3. Coloque-o em `assets/icons/`, e configure em `config/settings.py`, **após o arquivo existir**:

```python
APP_ICON = "assets/icons/open-doc.ico"  # Windows
```

No macOS, use `.icns`. A configuração deve ser específica do SO quando necessário. Não configure um caminho inexistente — o Vela falha com `FileNotFoundError`.

Para a interface, use o static resolver: `{{ static('open_doc/brand/open-doc-logo.svg') }}`. **Não** coloque uma URL externa em um bundle offline.

### Ícone atual

Código-fonte: https://github.com/zxlawdx/open-doc/blob/main/apps/open_doc/static/icons.svg

O cabeçalho usa `#file-text` em `apps/open_doc/templates/base.html`. É um pictograma de documento, **não** uma logo oficial concluída.

O instalador, favicon, miniaturas e ícone do cabeçalho devem reutilizar variantes de uma marca aprovada, sem depender de fonte externa ou de renderização específica da WebView.

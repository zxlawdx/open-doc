# Recursos visuais do Open Doc (build Vela)

Esta pasta segue a arquitetura documentada do **Vela Framework**: o comando `buildapp` já inclui `assets/` no pacote nativo, sem modificar o runtime.

| Caminho | Finalidade |
| --- | --- |
| `build/open-doc.ico` | Ícone **Windows** gerado por `python tools/build_release_icon.py` |
| `assets/icons/open-doc.icns` | Ícone **macOS** |
| `assets/icons/open-doc.png` | Ícone de origem, exportação Linux, branding |
| `assets/branding/` | Materiais aprovados: marca, paleta e guia visual |
| `apps/home/static/icons.svg` | Sprite da interface; símbolo `#file-text` é o ícone **atual** do cabeçalho |
| `apps/home/static/brand/` | Logos SVG e ilustrações utilizadas pela **interface web** |

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

O cabeçalho usa o símbolo `#file-text` de `apps/home/static/icons.svg`,
com fundo azul e bordas arredondadas. O arquivo
[`icone-atual-open-doc.svg`](branding/icone-atual-open-doc.svg) reproduz
essa marca para o executável e o instalador. O build converte o SVG em um
ICO com resoluções de 16 a 256 px.

# Primeiros passos

## Requisitos

Para desenvolver a partir do código-fonte:

- Python 3.10 ou superior;
- Git;
- dependências gráficas do Qt/QtWebEngine;
- Node.js 22+ para o primeiro build do CSS do shell Vela.

## Instalação no Windows

```powershell
git clone https://github.com/zxlawdx/open-doc.git
cd open-doc
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm ci
python tools/build_css.py
python manage.py collectstatic
python manage.py runapp
```

## Instalação no Linux

Depois de criar a virtualenv, ative com:

```bash
source .venv/bin/activate
```

O QtWebEngine depende das bibliotecas gráficas do sistema, incluindo componentes de X11, NSS, xkbcommon, EGL, áudio e Xtst.

## Entradas oficiais

A aplicação pode ser iniciada por:

```bash
python manage.py runapp
```

ou:

```bash
python main.py
```

Ambos utilizam o bootstrap oficial do Vela.

## Diretório de dados

Por padrão, os dados ficam em:

```text
~/OpenDoc/
```

Estrutura principal:

```text
OpenDoc/
├── documents/
├── notes/
├── drawings/
├── exports/
└── .veladata/
```

A pasta `.veladata/` contém banco, preferências, pacotes preservados e metadados necessários para recuperação e round-trip de documentos.

## Atalhos principais

| Ação | Atalho |
|---|---|
| Novo documento | `Ctrl+N` |
| Abrir/importar | `Ctrl+O` |
| Salvar | `Ctrl+S` |
| Localizar | `Ctrl+F` |
| Substituir | `Ctrl+H` |
| Negrito | `Ctrl+B` |
| Itálico | `Ctrl+I` |
| Desfazer | `Ctrl+Z` |
| Refazer | `Ctrl+Y` ou `Ctrl+Shift+Z` |
| Quebra de página | `Ctrl+Enter` |

## Atualizando um clone

```bash
git pull origin main
```

Depois, atualize dependências e assets quando houver mudanças relevantes.
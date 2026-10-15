# Vela Writer

Aplicação desktop open source para escrever, organizar documentos e estudar.
Construída com **Vela Framework + Bottle + pywebview + PyQt5**.
Interface em português, tema escuro e recursos locais.

**Estado: Fase 1 — Fundação.** O editor completo pertence à Fase 2.

## Instalar e executar

Requer Python 3.10+, Git e uma sessão gráfica.

```bash
git clone https://github.com/zxlawdx/open-doc.git
cd open-doc
python -m venv .venv
```

Windows / PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python main.py
```

Linux / Mint:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
python main.py
```

O launcher seleciona Qt/PyQt5. No Linux, o QtWebEngine precisa das bibliotecas
gráficas do sistema, incluindo libXtst, NSS, X11 e EGL; instale os pacotes
correspondentes da sua distribuição se um import informar biblioteca ausente.
Não execute a aplicação desktop como root.

A instalação inicial baixa as dependências. Depois, a interface, as fontes e o
CSS funcionam offline. Node.js só é necessário para recompilar Tailwind.
O Vela está fixado em um commit inspecionado para estabilidade da API.

## Uso disponível

- Sidebar recolhível com preferência persistente.
- Importação pelo seletor nativo de PDF, DOCX, PPTX, Markdown e TXT UTF-8.
- Biblioteca de arquivos organizados por formato.
- Validação básica de assinatura PDF e estrutura ZIP Office.
- Cópia de importação por padrão: o original é preservado.
- Nomes exclusivos em caso de colisão, sem substituir arquivos existentes.
- Rascunho temporário e contagem de palavras.

**O rascunho não é salvo.** A interface informa isso e pede confirmação ao
fechar uma página com conteúdo. Não use o rascunho para trabalho permanente.
A biblioteca lista arquivos; visualização e conversão chegam na Fase 3.
A validação básica de formato não garante integridade completa do documento.

## Dados

Na primeira execução, o app cria:

```text
~/VelaWriter/
├── documents/
│   ├── docx/
│   ├── pptx/
│   └── pdf/
├── notes/
├── drawings/
├── exports/
└── .veladata/
    └── settings.json
```

Preferências são gravadas atomicamente. JSON corrompido é preservado e o erro é
mostrado na interface. Configuração e testes podem usar um diretório temporário.
O servidor escuta apenas em 127.0.0.1, numa porta livre; alterações HTTP de
preferências exigem o token da janela.

## Arquitetura

O entrypoint usa o servidor Bottle do Vela (`ApiServer`) e monta o roteador
da aplicação. O pywebview abre diretamente a página local na janela Qt.
Esse fluxo evita uma segunda shell visual e dependências de CDN do shell
padrão. Não usa Electron nem copia código do framework.

## Arquivos

| Caminho | Responsabilidade |
| --- | --- |
| `main.py` | Inicializar servidor Vela e janela Qt. |
| `app/__init__.py` | Identificar o pacote e a versão. |
| `app/config.py` | Criar workspace e persistir configurações. |
| `app/router.py` | Registrar rotas Bottle e importação nativa. |
| `app/file_organizer.py` | Validar, copiar ou mover arquivos por tipo. |
| `ui/templates/base.html` | Compor shell, cabeçalho e barra de status. |
| `ui/templates/sidebar.html` | Navegação recolhível e importação. |
| `ui/templates/editor.html` | Área inicial e rascunho temporário. |
| `ui/static/css/main.css` | Tema responsivo e Tailwind compilado. |
| `ui/static/js/app.js` | Navegação, preferências e importação. |
| `ui/static/fonts/Inter.woff2` | Fonte local da interface. |
| `ui/static/fonts/JetBrainsMono.woff2` | Fonte local do rascunho. |
| `ui/static/fonts/Inter-LICENSE.txt` | Licença OFL de Inter. |
| `ui/static/fonts/JetBrainsMono-LICENSE.txt` | Licença OFL de JetBrains Mono. |
| `tailwind.config.js` | Configurar a descoberta de classes. |
| `tools/build_css.py` | Compilar CSS pelo pipeline oficial do Vela. |
| `package.json` | Declarar Tailwind para compilação. |
| `package-lock.json` | Fixar dependências Node. |
| `requirements.txt` | Definir runtime e dependências das próximas fases. |
| `requirements-dev.txt` | Definir ferramentas de validação. |
| `tests/test_foundation.py` | Testar configuração, arquivos e HTTP real. |
| `docs/CONTRIBUTING.md` | Orientar contribuição e testes. |
| `.gitignore` | Excluir dados pessoais e artefatos temporários. |
| `LICENSE` | Licenciar o código da aplicação sob MIT. |
| `README.md` | Documentar instalação, uso e escopo. |

## Desenvolvimento

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m black --check --line-length 88 main.py app tests tools
node --check ui/static/js/app.js
```

Recompilar CSS:

```bash
npm ci
python tools/build_css.py
```

O CSS compilado já está versionado; nenhum build é necessário para executar.

## Validação desta fase

14 testes automatizados aprovados, incluindo montagem da aplicação no servidor
Vela real. Sintaxe JavaScript e formatação Python verificadas.
A renderização Qt e o seletor nativo ainda precisam ser validados numa sessão
gráfica Linux/Windows; o ambiente de implementação não disponibilizou todas as
bibliotecas gráficas. Não há screenshot ou build desktop validado nesta fase.

## Próximas fases

2. Editor rico/Markdown, persistência, autosave e exportação PDF/DOCX.
3. Leitura e conversão de documentos.
4. Canvas com pressão de caneta e PDF multipágina.
5. Notas conectadas, FTS5 e grafo de conhecimento.
6. Empacotamento, screenshots e polimento.

## Licenças

Código original da aplicação: MIT. Vela Framework: MPL-2.0, mantida no pacote
da dependência. Inter e JetBrains Mono: SIL OFL, com licenças incluídas.

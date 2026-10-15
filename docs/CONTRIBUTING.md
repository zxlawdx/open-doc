# Contribuindo com Vela Writer

Use Python 3.10+ e uma branch por alteração. O código da aplicação usa MIT;
Vela Framework mantém sua licença MPL-2.0 e as fontes mantêm SIL OFL.

## Ambiente

Crie um venv e execute `python -m pip install -r requirements-dev.txt`.
No Linux, instale as dependências Qt do sistema e use uma sessão gráfica.
O runtime não exige Node nem acesso à internet depois da instalação.

## Validação

```bash
python -m pytest -q
python -m black --check --line-length 88 main.py app tests tools
node --check ui/static/js/app.js
```

Para alterar CSS, edite a parte anterior ao marcador COMPILED TAILWIND em
`ui/static/css/main.css` e execute `npm ci` e
`python tools/build_css.py`. O script usa o pipeline oficial do Vela.
Versione o CSS compilado. Não use CDN em templates.

## Organização

- `main.py`: inicialização desktop.
- `app/config.py`: diretórios e configurações.
- `app/file_organizer.py`: validação e organização de documentos.
- `app/router.py`: HTTP Bottle e seletor nativo.
- `ui/templates/`: estrutura; `ui/static/`: comportamento e aparência.
- `tests/`: contratos de persistência, documentos e HTTP.

Use type hints e docstrings Google nas funções públicas, linhas Python de
até 88 caracteres, constantes nomeadas e uma responsabilidade por módulo.
Não inclua arquivos pessoais, dados do workspace ou segredos.

## Commits e revisão

Leia o arquivo atual antes de substituí-lo. Use um commit por arquivo criado
e mensagens em português (`feat: adiciona ...`, `fix: corrige ...`).
Encerre cada fase com `chore: finaliza fase X — nome da fase`.
Descreva comportamento e testes no pull request. Mudanças no fluxo de arquivos
precisam preservar originais, evitar sobrescrita e cobrir erros de leitura.

Teste a janela no Windows e no Linux antes de distribuir. Inclua navegação
por teclado, seletor de arquivo, escalas de tela e encerramento. O teste HTTP
automatizado não substitui a validação visual do Qt.

# Contribuindo com Vela Writer

Use Python 3.10+ e uma branch por alteração.

## Ambiente e validação

```bash
python -m pip install -r requirements-dev.txt
npm ci
python -m pytest -q
node --test tests/editor.test.cjs
python -m black --check --line-length 88 app apps config tools tests main.py manage.py
node --check ui/static/js/app.js
node --check ui/static/js/editor.js
```

## Runtime obrigatório

Use VelaApp, config.settings, register_app, register_routes, BaseBridge e o
template engine do Vela. Não crie janela pywebview ou servidor Bottle paralelo.
Views devem respeitar o lifecycle de páginas e remover timers/listeners.

As rotas de API usam decorators de vela.api; o framework as conecta ao Bottle.
O token inicial é entregue pela bridge nativa. Não exponha um bootstrap HTTP
com a credencial nem aceite caminhos de saída enviados pelo frontend.

## Frontend e estáticos

Edite fontes em ui/. Não edite as cópias geradas em apps/writer/static
ou staticfiles. Para estilos, altere a parte anterior a COMPILED TAILWIND em
ui/static/css/main.css e execute:

```bash
python tools/build_css.py
python manage.py collectstatic --no-tailwind
python manage.py runapp
```

O primeiro comando inclui classes do shell real no bundle. O segundo usa a
coleta oficial do Vela. O runtime também sincroniza automaticamente os assets.
Versione main.css compilado. Não use CDN.
Bibliotecas vendorizadas devem manter sua versão e licença documentadas.

## Documentos e editor

Markdown é a fonte canônica. SQLite controla transações e revisões; nunca
substitua um conflito por um save forçado. Preserve o buffer durante requisições.
Autosave, recuperação e exportação precisam usar snapshots coerentes.
A recuperação deve funcionar mesmo que o Vela escolha outra porta HTTP.

Não acesse JavaScript sincronamente no evento closing do Qt: isso pode
bloquear a thread gráfica. Use a confirmação nativa de pywebview e sincronize
o estado dirty pela bridge. Não altere a estrutura do workspace sem migração.

## Estilo e Git

Use type hints, docstrings Google, linhas Python de até 88 caracteres,
constantes nomeadas e responsabilidades separadas. Não inclua dados pessoais,
segredos, banco de usuário ou artefatos de build.

Leia o arquivo atual antes de substituir. Um commit por arquivo criado;
mensagens em português. Encerre fases com
chore: finaliza fase X — nome da fase.

## Teste gráfico

Teste Linux/Qt e Windows antes de distribuir. Verifique digitação, formatação,
preview, troca de notas durante salvamento, seletor nativo, conflitos,
exportação Unicode, recuperação e fechamento.
Use 1366×768, 1600×900 e 1920×1080. Registre limitações explicitamente.
Testes DOM não substituem o QtWebEngine: bibliotecas modernas podem exigir
recursos ausentes no Chromium do Qt 5.15.

## Licenças

Aplicação: MIT. Framework Vela: MPL-2.0. Fontes: SIL OFL.
Dependências vendorizadas mantêm suas licenças em ui/static/js/vendor.

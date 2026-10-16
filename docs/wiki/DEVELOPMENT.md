# Desenvolvimento e testes

## Ambiente de desenvolvimento

Instale dependências de desenvolvimento:

```bash
python -m pip install -r requirements-dev.txt
npm ci
```

## Testes e validações

Comandos principais:

```bash
python -m pytest -q
npm test
python tools/audit_css.py
python -m black --check --line-length 88 apps config tools tests main.py manage.py launcher.py
node --check apps/open_doc/static/js/app.js
python tools/build_css.py
python manage.py collectstatic --no-tailwind
python manage.py runapp
```

## QA desktop

O projeto possui smoke tests no QtWebEngine real:

```bash
python tools/qa_desktop.py
```

Esse fluxo usa workspace temporário e captura a aplicação real. Para QA de estilos:

```bash
python tools/qa_styles.py
```

A validação visual deve cobrir múltiplas resoluções desktop e os temas suportados.

## CSS

Nunca edite apenas o CSS gerado como fonte de verdade. Os arquivos de origem ficam em:

```text
apps/open_doc/styles/
```

Após alterações:

```bash
python tools/build_css.py
python manage.py collectstatic --no-tailwind
```

## Princípios para novos recursos

Ao adicionar uma feature:

1. mantenha integração pelo lifecycle oficial do Vela;
2. evite servidores, janelas ou pipelines paralelos;
3. separe UI, contrato e implementação;
4. adicione testes por feature;
5. preserve compatibilidade com documentos existentes;
6. documente limitações reais;
7. atualize a matriz de formatos quando o comportamento mudar.

## Compatibilidade de plataforma

O projeto possui validação automatizada importante em Linux/Qt. Recursos dependentes de diálogos nativos, WebView2 ou comportamento específico do Windows devem ser testados também no Windows.

## Documentação técnica existente

Além desta Wiki, `docs/` contém relatórios mais profundos sobre:

- integração Vela;
- DOCX rico;
- redesign;
- sistema de estilos;
- auditoria;
- decisão do engine;
- pesquisa de referências;
- compatibilidade do editor com Qt.
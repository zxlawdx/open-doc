# Arquitetura

## Visão geral

O Open Doc é uma aplicação desktop construída sobre o **Vela Framework**. O runtime do produto fica concentrado em `apps/open_doc/`, mantendo a interface, serviços, bridge, parsers, exporters e persistência dentro do app.

```text
open-doc/
├── apps/open_doc/
│   ├── services/
│   ├── static/
│   ├── styles/
│   ├── templates/
│   └── ...
├── config/
├── docs/
├── tests/
├── tools/
├── manage.py
├── main.py
└── launcher.py
```

## Bootstrap Vela

`manage.py` delega ao `CommandRunner` do framework.

`config/wsgi.py` instancia a aplicação Vela, registra `apps.open_doc`, descobre views/API e executa o lifecycle oficial.

`main.py` e `launcher.py` entram pelo mesmo bootstrap, evitando servidor ou janela paralela fora do framework.

## Bridge

A comunicação entre interface e backend utiliza uma bridge derivada de `BaseBridge`.

A interface deve depender de contratos estáveis da bridge/API, e não de detalhes internos de persistência ou parser.

## Modelo de documento

Documentos ricos utilizam o formato canônico:

```text
opendoc-rich-v1
```

O modelo é validado em JSON e serve como representação intermediária entre editor, persistência e adapters de importação/exportação.

## Persistência

O workspace padrão é `~/OpenDoc/`.

O banco SQLite mantém por compatibilidade o nome físico `writer.sqlite3` e armazena documentos, sessão ativa, revisões e dados de recuperação.

Preferências ficam em:

```text
.veladata/settings.json
```

Pacotes DOCX preservados e mídia associada ficam em:

```text
.veladata/packages/<id>/
```

## Frontend e estilos

Os estilos-fonte vivem em `apps/open_doc/styles/` e são organizados por responsabilidade, incluindo tokens, layout, componentes, conteúdo, estados e política responsiva.

O CSS final é gerado pelo pipeline do projeto. `collectstatic` é o coletor oficial de assets.

## Importadores e exporters

A arquitetura deve tratar cada formato como um adapter próprio, mantendo o núcleo do editor desacoplado de DOCX, PDF, PPTX e outros formatos.

Para formatos complexos, o princípio é:

1. importar para uma representação controlada;
2. preservar o original quando necessário;
3. editar apenas capacidades conhecidas;
4. exportar sem destruir silenciosamente partes não compreendidas.

## Direção futura

Novas capacidades como PDF editável, desenho livre, caneta digital, reconhecimento de escrita e PPTX devem entrar como módulos independentes e contratos explícitos, evitando acoplamento direto ao editor DOCX.
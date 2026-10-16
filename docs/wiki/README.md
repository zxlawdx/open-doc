# Open Doc Wiki

Bem-vindo à documentação do **Open Doc**, um editor de documentos desktop, local-first e construído sobre o **Vela Framework**.

O objetivo desta Wiki é separar a documentação de uso, arquitetura e desenvolvimento do README principal, mantendo uma visão clara do que já funciona e do que ainda está em evolução.

## Navegação

- [Primeiros passos](GETTING_STARTED.md)
- [Recursos](FEATURES.md)
- [Formatos e compatibilidade](FORMATS_COMPATIBILITY.md)
- [Arquitetura](ARCHITECTURE.md)
- [Desenvolvimento e testes](DEVELOPMENT.md)
- [Roadmap](ROADMAP.md)

## O que é o Open Doc?

Open Doc é um processador de documentos desktop sem dependência de conta, nuvem ou CDN. A aplicação combina uma interface de editor visual com persistência local, histórico, recuperação, importação e exportação de documentos.

O runtime do produto vive em `apps/open_doc/` e utiliza o lifecycle oficial do Vela. A aplicação usa Qt/WebView para a interface desktop e mantém seus dados localmente.

## Estado atual

O projeto já possui:

- editor visual estruturado;
- persistência local em SQLite;
- autosave e recuperação;
- importação e round-trip de DOCX;
- exportação para DOCX, PDF, HTML e Markdown;
- páginas, margens, orientação e quebras;
- fontes locais e tipografia avançada;
- tabelas;
- localizar/substituir;
- temas claro, escuro e sistema;
- QA automatizado no QtWebEngine.

Consulte o [Roadmap](ROADMAP.md) para distinguir recursos concluídos, em evolução e planejados.
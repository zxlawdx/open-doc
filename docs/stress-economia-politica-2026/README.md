# Corpus de stress — Economia política (2026)

Esta pasta foi reservada para os artefatos de teste do Open Doc:

- `economia_politica_brasil_36_slides.pptx` (36 slides, 16:9)
- `sintese_economia_politica_abnt.docx` (síntese de economia política, formatação acadêmica)
- `economia_politica_brasil_36_slides.pdf` (PDF da apresentação)

**Situação:** os três arquivos foram gerados e estão disponíveis no pacote ZIP entregue na conversa. Os binários **ainda precisam ser adicionados nesta pasta por git push**; não foram enviados por este commit.

## Como adicionar os arquivos

Extraia o ZIP na raiz do projeto com a branch `test/stress-qa-docx-pptx-pdf-20261106` selecionada, depois:

```bash
git add docs/stress-economia-politica-2026/
git commit -m "test(fixtures): add economia politica PPTX DOCX PDF corpus"
git push origin test/stress-qa-docx-pptx-pdf-20261106
```

## Critérios de QA

Abrir e reabrir, comparar renderizações com as versões de referência, editar textos e caixas, aplicar estilos, testar atalhos repetidos, mudar ordem de camadas, salvar como, importar/exportar e verificar perda de conteúdo. O corpus **não comprova** execução ou aprovação de testes de interface do Open Doc.

Observação: as informações e referências do material-base precisam ser confrontadas com as fontes primárias antes de uso público.

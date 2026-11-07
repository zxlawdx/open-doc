# Corpus de stress Open Doc — versão 2

A apresentação e o resumo foram redesenhados após o QA visual: contraste, hierarquia de texto, diagramação 16:9 e tipografia acadêmica no DOCX.

Arquivos no pacote entregue em conversa (os arquivos binários ainda **não foram enviados ao repositório**):

- `economia_politica_brasil_36_slides_v2.pptx` — 36 slides, elementos textuais e formas editáveis.
- `economia_politica_brasil_36_slides_v2.pdf` — 36 páginas, referência visual.
- `sintese_economia_politica_abnt_v2.docx` — síntese formatada para ABNT.
- `sintese_economia_politica_abnt_v2.pdf` — impressão de referência do DOCX.

Baixe o ZIP disponibilizado na conversa, extraia na raiz da branch e faça commit dos binários:

```bash
git add docs/stress-economia-politica-2026/
git commit -m "test(fixtures): add v2 slide and ABNT corpus"
git push origin test/stress-qa-docx-pptx-pdf-20261106
```

## Testes exigidos

1. Importar PPTX criado externamente e editar título sem perda de outras formas.
2. Verificar contraste de fundos escuros; salvar, exportar, reabrir e apresentar.
3. Testar DOCX com 600+ palavras, margens A4, parágrafos, títulos, paginação, edição e exportação.
4. Validar PDF de 36 páginas, seleção, busca e exportação; nenhuma cor/posição alterada após renderização.
5. Comparar PPTX/PDF página por página em pelo menos dois tamanhos de viewport.
6. Com templates complexos de terceiros, preservar dados não suportados e apresentar diagnóstico granular.

## Limites

Este material foi produzido fora do Open Doc. Renderização com LibreOffice foi validada; não constitui prova de compatibilidade completa na UI do Open Doc. Referências estatísticas no roteiro precisam de checagem nas fontes primárias.

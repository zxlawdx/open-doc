# Decisão do engine

Status: manter o formato Markdown/SQLite e melhorar a camada contenteditable
nesta rodada. Nenhuma migração destrutiva de conteúdo. A decisão é limitada
ao subconjunto de formatação representável sem perdas no formato atual.

| Opção | Qt 5.15/offline/tamanho | Seleção/history/tabelas | Serialização, DOCX e paginação | Decisão |
|---|---|---|---|---|
| Atual sem correções | Já executa; pequeno; MIT + vendors locais | Lacunas de seleção/history | Markdown limitado, sem DOCX round-trip | Rejeitada |
| contenteditable com adapter | Comprovável no Qt; sem pacote novo | Selection Range, comando único, history do app; tabelas atuais preservadas | Markdown mantido, export existente; papel contínuo | Adotada |
| ProseMirror | MIT, modular/offline; build precisa prova no Qt | Transações/schema/history/tabelas extensíveis | JSON estruturado, Markdown via adapter; DOCX/paginação não automáticos | Candidata futura |
| Tiptap | MIT core, mais extensões/build; sem garantia por modernidade | UX headless sobre ProseMirror | JSON/schema; extensões Markdown; DOCX não vem do core | Não necessário agora |
| Slate | MIT, core + UI React aumenta integração | Plugins, transforms/history; normalização própria | JSON customizado; serialização e paginação a construir | Custo alto neste patch |
| Lexical | MIT, core offline, Chrome 86+ declarado | Estado imutável, comandos/history, tabelas por pacotes | JSON/Markdown; DOCX/paginação requerem trabalho | Exige spike e migração |
| Modelo estruturado próprio | Tamanho controlável; manutenção total do app | Seleção/transações/IME e undo são responsabilidade própria | Pode representar Office, mas alto risco/custo | Não inventar engine novo |
| Premirror | MIT, composição + React 19/Vite/ProseMirror | Projeção de seleção e fragmentos especializados | Paginação determinística e widow/orphan | Referência, não dependência |

Não se mediu tamanho de bundle de engines que não serão instalados. A tabela
compara dependências e riscos; não fabrica benchmarks. Qt real é a prova de
compatibilidade da opção adotada. As alternativas não estão certificadas.

## Contrato desta entrega

- Documento canônico: título e Markdown, transações/revisões/recovery atuais.
- Adapter concentra execCommand e captura/restaura Selection Range.
- History limitado por quantidade e bytes; atalhos e toolbar usam o mesmo fluxo.
- Editor visual padrão; fonte Markdown/preview são opções avançadas exclusivas.
- Não expor font family, tamanho, cor, highlight, alinhamento ou sublinhado:
  o modelo atual não garante serialização dessas propriedades.
- Links, títulos, listas, negrito, itálico, citação e código são representáveis.
- PaperLayout separa zoom/medidas da edição; folha branca de largura A4 e
  altura mínima A4, contínua quando o texto cresce. Régua informativa, sem
  handles falsos. Não contar páginas que o engine não compôs.
- PDF tem paginação pelo exportador; não se promete equivalência ao canvas.

## Dívida técnica

execCommand é legado e depende do WebView. Encapsulá-lo reduz dispersão,
mas não elimina inconsistências de browser/IME. Antes de oferecer tipografia
arbitrária, imagens editáveis, OOXML round-trip ou paginação fiel, executar
spike com engine estruturado, schema versionado, migração reversível e fixtures
de notas antigas. Nenhuma feature foi removida para simular uma suíte Office.

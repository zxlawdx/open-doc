# Open Doc — investigação de UX, implementação e validação

Atualizado em 5 de novembro de 2026. Evidências: capturas locais enviadas pelo usuário, código de `main` e testes GitHub Actions. A prioridade é **não confundir um botão visível com uma funcionalidade concluída**.

## Evidências e correções implementadas

| Tema | Evidência / problema | Correção | PR |
| --- | --- | --- | --- |
| PDF | Miniaturas e anotações compartilham coluna estreita | Miniaturas à esquerda; anotações em trilho independente à direita, ocultável e responsivo | #22 |
| PDF | Selecionar/escrever comentário navega automaticamente para a primeira página da marcação | Separar edição de `go()`: navegação só após clique deliberado na lista | #22 |
| PDF | Comentário exige abandonar o texto | Ctrl/⌘+clique sobre marcação abre balão editável, sem romper a seleção normal | #22 |
| Slides | Duplo clique abre `window.prompt`, texto só no Inspector | Edição inline no próprio slide, Esc cancela, Ctrl+Enter confirma | #23 |
| Slides | Só uma alça de redimensionamento, sem rotação visual | 8 alças e topo para girar; alteração única no histórico | #23 |
| Slides | Formas deixam pequena margem no seu próprio SVG | Caminho SVG normalizado na caixa integral, sem recuo interno | #23 |
| Slides | Ferramentas misturadas com caneta PDF | Grupos Slides / Inserir / Formatar, cor reutilizável e balde | #23 |
| Documentos | Inserir tabela exige `3x4` em input usado para URL | Diálogo com linhas, colunas, espaçamento, modelos, CSV/TSV e URL CSV pública | #24 |
| Documentos | Matriz não mantém espaçamento editável em DOCX | Propriedade `cell_spacing_pt` no modelo; `w:tblCellSpacing` na exportação OOXML | #24 |
| Ajuda | Falta auxílio específico e recuperação | FAQ por tipo de documento, em português, local | #24 |
| Home | Biblioteca sem navegação lateral | Acesso a recentes, importação, criação, apresentações e ajuda | #24 |
| Salvamento | Status não indica se arquivo está no workspace ou em pasta escolhida | Mensagem diferencia biblioteca local de exportação nativa | #24 |
| Branding | Cabeçalho compacto, símbolo encostado no título | Maior espaçamento; convenção Vela `assets/` documentada | #24 |

## Heurísticas de Nielsen — auditoria orientada a tarefas

Referência: https://www.nngroup.com/articles/ten-usability-heuristics/

1. **Visibilidade do status:** Antes, “salvo” não explicava onde. Corrigido parcialmente; ainda é necessário exibir tempo, destino e ação “Abrir pasta” após exportação.
2. **Correspondência com o mundo real:** “Tabela 3x4” no campo “Endereço” confundia a tarefa. Substituído por formulário contextual. Falta linguagem visual mais uniforme em todos os modos.
3. **Controle e liberdade:** Texto de slide passa a editar inline com Esc/cancelamento; PDF possui balão fechável. Falta desfazer para operações de substituição de conteúdo nativo PDF.
4. **Consistência e padrões:** Proposta de faixas contextuais e barras laterais independentes. Falta convergir atalhos e seleções entre DOCX, PDF e PPTX.
5. **Prevenção de erros:** Validar limites geométricos, tabelas e revisões; preservar arquivos originais. Falta prévia de perdas ao converter DOCX↔PDF.
6. **Reconhecimento em vez de memorização:** Modelos de tabelas substituem sintaxe compacta; falta galeria de efeitos com prévia e ícones descritivos.
7. **Flexibilidade e eficiência:** Ctrl+clique, duplo clique em slides, paint bucket. Falta painéis flutuantes reposicionáveis, atalhos documentados por função e personalização do ribbon.
8. **Design minimalista:** Grupos de ribbon e painéis dedicados; ainda há comandos globais de tinta visíveis no modo slides, que precisam ser ocultados por contexto após cobertura de regressões.
9. **Diagnóstico e recuperação:** Erros de input explícitos; não mostrar traceback/JSON aos usuários. Falta central de integridade do arquivo e ajuda “O que fazer agora?” junto a falhas import/export.
10. **Ajuda e documentação:** FAQ embutido por formato; falta ajuda contextual por botão, vídeos curtos locais, tutoriais guiados e pesquisa por palavra-chave.

## Pesquisa técnica: PPTX, transições, animações e gráficos

- **Office Kit PPTX (MIT)** — https://github.com/office-kit/pptx — leitura/escrita OOXML, transições e animações com API de leitura, gráficos com planilhas embutidas e validação. Uma referência importante para separar transição (slide) de animação (forma). **Não copiar código sem revisão de licença/arquitetura e sem testes no Qt legado.** O runtime do Office Kit prioriza browsers modernos; Open Doc usa QtWebEngine legado. Avaliar backend ou lógica OOXML em Python.
- **PPTist (AGPL-3.0)** — https://github.com/pipipi-pikachu/PPTist — interface e fluxo de edição; issue https://github.com/pipipi-pikachu/PPTist/issues/430 confirma dificuldade com animação em **grupos**. Evitar dependência direta ou transplante de código AGPL em base incompatível.
- **PptxGenJS** — https://github.com/gitbrent/PptxGenJS/issues/327 — suporte de animações historicamente não implementado. Útil para exportação de gráficos/decks novos; inadequado para prometer roundtrip integral.
- Critérios para uma implementação real de transições: escolher efeito, direção e duração; persistir no modelo; exportar `p:transition` OOXML; reabrir em PowerPoint e LibreOffice; não confundir prévia CSS com efeito nativo do arquivo.
- Critérios para animações: identificar formas por shape IDs preservados; modelar `start` (clique/anterior/depois), duração e ordem; exportar `p:timing` válido; teste visual e OOXML; não reduzir animação a GIF ou rasterizar forma.
- Critérios para gráficos editáveis: dados em modelo estruturado, planilha embutida `ppt/embeddings/*.xlsx` + relações com chart parts; operações de seleção/dados, paleta, fonte, eixos, legenda e etiquetas; reabrir e editar os dados no PowerPoint. **Implementado parcialmente no PR #26**: barras/linhas/pizza, uma série de dados e paletas, com workbook XLSX embutido. Recursos avançados (múltiplas séries, eixos secundários e importação editável de gráficos externos) permanecem pendentes.

## Pesquisa técnica: edição real de PDFs

- **PyMuPDF** — https://pymupdf.org/2026/07/02/can-i-edit-pdf-documents-with-pymupdf/ e https://pymupdf.readthedocs.io/en/latest/page.html — PDF é posicional, não fluxo de parágrafos como Word; redaction e reinserção podem apagar texto vizinho e não preservam reflow.
- **pdfedit (projeto alpha)** — https://pypi.org/project/pdfedit/ — localiza spans, tenta correspondência de fonte, aplica redaction/reinserção; declara limitações de fundo branco, sem reflow e sem OCR. Revisar issues antes de incorporar.
- **Arquitetura correta proposta:** manter fonte original imutável; construir camada de **edições por objetos** (texto, imagem, retângulo), com extração de bounds, fonte, rotação e z-order; apontar conflitos ao usuário; prévia lado a lado; exportação atômica para cópia; histórico de comandos independente da anotação semântica. Abrir DOCX convertido não garante fidelidade ao voltar para PDF. Não suprimir alertas sobre falhas de fonte ou scans.
- **Ainda não implementado:** edição do texto **original** de PDFs, manipulação livre de imagens do PDF e conversão/reflow DOCX↔PDF sem perda. Esse trabalho requer testes com fontes embutidas, PDFs escaneados, colunas, ligaduras, tabela, OCR e assinatura.

## Pendências de produto que continuam abertas

1. **Animações por objeto**: transições nativas de slide (fade/push/wipe) foram implementadas no **PR #25**; faltam animações de formas com timing, ordem e roundtrip.
2. **Gráficos avançados**: barras, linhas e pizza de uma série em PPTX foram implementados no **PR #26**; faltam múltiplas séries, gráficos em DOCX e edição de gráficos importados.
3. **Tabelas matrizes em slides** com tamanho/posicionamento, fontes e dados editáveis; #24 cobre matriz **no documento DOCX**, não ainda no slide.
4. **Equações estruturadas OMML**: o **PR #27** introduz calculadora e paleta que inserem texto matemático Unicode no cursor, mas ainda não geram equações profissionais estruturadas em OMML.
5. **Edição real de PDF** por objeto com revisão de fidelidade; não confundir com as anotações atuais.
6. **Salvamento e exportação**: o PR #24 inclui confirmação legível com o caminho exato; ainda falta botão nativo “Mostrar pasta”, recuperação assistida e mensagens de erro específicas para todas as falhas.
7. **Temas e modelos de slides, layouts, guias, alinhamento e grids** com editor de mastros/templates.
8. **Cobertura real de Qt** para novos diálogos, arrastar alças, rotação, zoom e acessibilidade com leitor de tela; os testes atuais medem a lógica mais diretamente.
9. **Ícone oficial**: marca ainda depende de arte final aprovada; o código SVG atual é apenas o símbolo de arquivo `#file-text`.

## Plano de testes manuais, na ordem recomendada

1. Abra um PDF longo, navegue até a página 80, destaque uma frase; adicione comentário e pressione Ctrl+clique. Confirme que a página 80 continua visível.
2. Alterne a coluna de comentários e redimensione a janela: miniaturas à esquerda, página central, comentários à direita (ou gaveta em telas pequenas).
3. Exporte o PDF anotado, reabra em leitor de terceiros e verifique texto original, destaque e comentários.
4. Crie um PPTX, insira texto, edite no próprio slide, pressione Escape e repita com Ctrl+Enter.
5. Insira retângulo na borda, redimensione por oito lados, gire pelo topo, preencha com balde e faça Undo/Redo.
6. Exporte o PPTX e abra em PowerPoint ou LibreOffice Impress; cheque geometria, cor e texto **editável**.
7. Crie um documento, insira tabela de 5×6 modelo matriz com espaçamento 12 pt, digite dados e salve.
8. Reabra o DOCX no Open Doc e no Word/LibreOffice; confira espaçamento e conteúdo; teste CSV/TSV com caracteres acentuados.
9. Abra o menu Ajuda em cada formato e valide FAQ e procedimentos de recuperação.
10. Na página inicial, teste Recentes, Importar, Novo e Nova apresentação; reduza a janela, veja acessibilidade/rolagem.
11. Na primeira exportação, confira status visível e destino. Verifique que nenhum JSON, traceback ou erro técnico aparece ao usuário.
12. Faça build Vela **somente depois** de adicionar ícone real `assets/icons/open-doc.ico` e configurar `APP_ICON`.

## Protocolo de qualidade

- Cada mudança deve ter teste que falhava antes e passa depois, sem desativar verificações.
- Sempre testar Windows e Linux Qt. Conferir `npm test`, `pytest`, `collectstatic --yes`, e suite real desktop.
- Não mesclar os PRs de UX até passarem as duas plataformas. Não chamar funcionalidade parcialmente implementada de “editor profissional completo”.
- Distinguir erros de **código**, **build**, **arquivo de origem** e **capacidade não suportada** em mensagens legíveis.

## Progresso concreto da trilha de PRs

| PR | Foco | Verificação CI |
|---|---|---|
| [#22](https://github.com/zxlawdx/open-doc/pull/22) | Anotações à direita, Ctrl+clique, estabilidade de página | Windows/Linux aprovados |
| [#23](https://github.com/zxlawdx/open-doc/pull/23) | Texto inline no slide, oito alças, rotação e balde | Windows/Linux aprovados |
| [#24](https://github.com/zxlawdx/open-doc/pull/24) | Tabelas matrizes DOCX, CSV, FAQ e UX da biblioteca | Windows/Linux aprovados |
| [#25](https://github.com/zxlawdx/open-doc/pull/25) | Transições nativas com prévia | Windows/Linux aprovados |
| [#26](https://github.com/zxlawdx/open-doc/pull/26) | Gráficos nativos editáveis, workbook XLSX e prévia SVG | Windows/Linux aprovados |
| [#27](https://github.com/zxlawdx/open-doc/pull/27) | Assistente de equações Unicode e calculadora segura | Em validação; não alegar aprovação até CI |

**Os PRs continuam em rascunho (draft) e não foram mesclados à main.**
Não tratar o documento como comprovação de teste visual manual no Windows PowerPoint ou LibreOffice.

### Etapas adicionais de verificação sequencial

13. Insira gráficos de barras, linhas e pizza. Altere os valores e cores da tabela de dados. Exporte PPTX, abra no PowerPoint e confira se “Editar Dados” abre a planilha.
14. Selecione uma transição de slide, use Prévia, exporte PPTX e reproduza a apresentação em PowerPoint ou LibreOffice.
15. Em documento DOCX, posicione o cursor no meio de uma frase. Use Inserir > Equação e calculadora, escolha símbolos, calcule 2*(3+4), insira expressão, desfaça e refaça. Confira que a escrita ao redor não se move.
16. Confirme explicitamente a limitação: a fórmula do passo anterior é texto Unicode editável, **não** uma equação OMML; redimensionar uma fração não deve ser apresentado como composição matemática profissional.

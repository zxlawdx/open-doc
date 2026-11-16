# Open Doc — auditoria e matriz de rastreabilidade do redesign

Fonte de decisão: `PROMPT_IMPLEMENTACAO_OPEN_DOC_REDESIGN.md`, HTML da UI aprovada e 62 símbolos SVG (23 originais da etapa 1, 39 extensões).

| Tela / controle | Estado na main antes do PR 1 | Serviço/estado real | Intervenção neste PR |
|---|---|---|---|
| Navegação lateral entre aplicativos | Existe como `suite-launcher` dentro da Central; falta trilho global | URLs Vela `data-vela-link` e ação `home` | Trilho fixo compartilhado com esses mesmos endpoints |
| Abas de arquivos | Funciona parcialmente: ativa, fecha, salva, restaura; sem reordenação persistida | `OpenDocWorkspace` / `workspace` API | Aparência e SVG canônico aplicados sobre o DOM existente; reordenação fica pendente |
| Tema claro/escuro/sistema | Já funciona | `OpenDocTheme` + `settings` API | Tokens harmonizados, sem duplicar preferência |
| Zoom de interface/documento/planilha | Já funciona | `OpenDocZoom`, `OpenDocPaperLayout`, `settings` API | Reaproveita fluxo atual; o trilho ocupa largura fixa interna |
| Densidade confortável/compacta | Inexistente | `Config` / `settings` API | Preferência durável, botão acessível e estilos só do chrome |
| Menus, tooltips, atalhos, mensagens e modal | Já funcionam | `menus.js`, `app.js`, diálogos e estados | Tematização escopada, sem remover comandos |
| Central, recentes, importados, templates | Funcionam; visual parcial | `OpenDocDesign` + biblioteca/workspace | Preservados; redesign integral no PR 2 |
| Dados/Notebooks | Funciona parcialmente; PR #102 em andamento | `datasets.js`, `OpenDocCodeNotebook`, API Data/Python/SQL | Mantido intacto; continuar PR #102 separado |
| Documentos | Editor rico real | `rich_renderer`, `document_model`, histórico e serviços DOCX | Mantido; PR 4 |
| Planilhas | Motor real, layout evolutivo | `workbook*` e serviços planilha | Mantido; PR 5 |
| Apresentações | Editor e importador reais | `slide_editor`, importação PPTX e serviço | Mantido; PR 6 |
| PDF | Renderizador real; modo apresentação introduzido antes | `fixed_document`, PDF e ferramentas de anotação | Mantido; PR 7 |
| Código/Ambientes/Configurações | Funcional parcial, UI evolutiva | editor de código, Python e settings | Mantido; PR 8 |

## Limites e evidência

- A referência HTML é **somente** especificação visual. Nenhum editor, execução de código, arquivo ou persistência do protótipo substitui o Open Doc.
- Os SVGs aprovados são distribuídos como `home/approved-icons.svg`; o sprite original `home/icons.svg` continua disponível para controles não migrados.
- `od_shell.css` não altera largura do papel, régua, canvas ou motor de paginação.
- Os arquivos de entrada/saída e os contratos com Vela não são modificados.
- Screenshots válidos devem vir de `tools/qa_appearance_zoom.py` executado com Vela/PyQt; não aceitar HTML isolado como evidência.
- Reordenação persistente de abas, central redesenhada e migração de todos os ícones de Ribbon por módulo são pendências explícitas; não se anunciam como concluídas.

## QA do PR 1

Executar: `npm test`, `python -m pytest -q tests/integration/test_preferences_density.py`, `python manage.py collectstatic --yes` e `python -u tools/qa_appearance_zoom.py docs/images/appearance-zoom` com Qt real. Verificar os artefatos do GitHub Actions antes da mesclagem.

# Formatos e compatibilidade

O Open Doc trabalha com diferentes formatos, mas o nível de fidelidade varia conforme o tipo de documento.

## Matriz atual

| Formato | Abrir | Editar | Exportar | Observações |
|---|---:|---:|---:|---|
| DOCX | Sim | Sim | Sim | Usa modelo rico e preserva o pacote original quando possível |
| Markdown | Sim | Sim | Sim | Em documentos ricos, a visualização Markdown pode ser simplificada |
| TXT | Sim | Sim | Indireto | Tratado como conteúdo textual |
| HTML | Parcial | — | Sim | Preserva parte da tipografia; layout é aproximado |
| PDF | Biblioteca | Não completo | Sim | Adapter atual pode ter perdas; edição direta ainda não é o objetivo concluído |
| PPTX | Biblioteca | Não completo | Não completo | Mantido como formato arquivado/capability atual |

## DOCX

O formato DOCX é o principal alvo de fidelidade do editor.

O Open Doc utiliza o modelo canônico `opendoc-rich-v1` e preserva uma cópia do pacote OOXML original. Durante o round-trip, o corpo e as relações necessárias são atualizados sobre essa base.

### O que o Open Doc tenta preservar

- estilos e temas;
- imagens e mídia;
- cabeçalhos e rodapés não editados;
- partes OOXML desconhecidas;
- dimensões e margens das seções;
- nomes de fontes mesmo quando a fonte não está disponível localmente.

### Limitações conhecidas

- não há promessa de fidelidade 100% idêntica ao Word;
- imagens flutuantes podem ser aproximadas;
- estilos condicionais complexos de tabela podem ser aproximados;
- campos do Word não são recalculados;
- objetos maiores que uma folha podem ultrapassar a área de conteúdo;
- mesclas verticais complexas ainda podem exigir tratamento especial.

## PDF

O Open Doc já exporta PDF, porém edição nativa de PDF é uma frente separada do editor DOCX. O roadmap deve tratar leitura/renderização, anotações e eventual edição de conteúdo PDF como capacidades próprias.

## PPTX

O formato PPTX ainda não possui o mesmo pipeline de edição do DOCX. A arquitetura da aplicação deve manter os adapters por formato desacoplados do núcleo do editor.

## Princípio de compatibilidade

A prioridade é nunca destruir silenciosamente conteúdo desconhecido. Quando um elemento não puder ser editado com fidelidade, o Open Doc deve preservar o original quando possível e informar a limitação ao usuário.
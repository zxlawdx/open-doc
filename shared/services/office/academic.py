"""Original academic scaffolds; formatting presets are not ABNT certification."""

from dataclasses import asdict

from shared.contracts.document_model.schema import (
    Paragraph,
    ParagraphStyle,
    RichDocument,
    Section,
    TextRun,
    TextStyle,
)

CM = 72 / 2.54
PROFILES = (
    {
        "id": "academic-base",
        "title": "ABNT · base acadêmica",
        "scope": "document",
        "note": "Perfil de apresentação: confirme o manual da instituição. Não normaliza referências, citações, sumário ou paginação pré-textual automaticamente.",
        "section": {
            "page_width_pt": 21 * CM,
            "page_height_pt": 29.7 * CM,
            "margin_top_pt": 3 * CM,
            "margin_left_pt": 3 * CM,
            "margin_bottom_pt": 2 * CM,
            "margin_right_pt": 2 * CM,
        },
        "paragraph": {
            "alignment": "justify",
            "line_spacing": 1.5,
            "line_spacing_rule": "auto",
            "first_line_indent_pt": 1.25 * CM,
            "space_before_pt": 0,
            "space_after_pt": 0,
        },
        "text": {"font_family": "Times New Roman", "font_size_pt": 12},
    },
    {
        "id": "long-quote",
        "title": "Citação longa · bloco",
        "scope": "selection",
        "note": "Recuo de 4 cm é uma convenção editável; confirme o manual da instituição e informe a fonte/página.",
        "paragraph": {
            "alignment": "justify",
            "line_spacing": 1,
            "line_spacing_rule": "auto",
            "left_indent_pt": 4 * CM,
            "first_line_indent_pt": 0,
            "space_after_pt": 6,
        },
        "text": {"font_size_pt": 10},
    },
    {
        "id": "references",
        "title": "Referências · apresentação",
        "scope": "selection",
        "note": "Aplica apresentação visual. Os dados e a correção bibliográfica precisam de revisão.",
        "paragraph": {
            "alignment": "left",
            "line_spacing": 1,
            "line_spacing_rule": "auto",
            "first_line_indent_pt": 0,
            "space_after_pt": 12,
        },
        "text": {"font_size_pt": 12},
    },
)
SCAFFOLDS = {
    "academic-thesis": (
        "Trabalho acadêmico · base ABNT",
        (
            "RESUMO",
            "1 INTRODUÇÃO",
            "2 FUNDAMENTAÇÃO TEÓRICA",
            "3 MÉTODO",
            "4 RESULTADOS E DISCUSSÃO",
            "5 CONCLUSÃO",
            "REFERÊNCIAS",
        ),
    ),
    "academic-project": (
        "Projeto de pesquisa",
        (
            "TEMA E PROBLEMA",
            "JUSTIFICATIVA",
            "OBJETIVOS",
            "REFERENCIAL TEÓRICO",
            "MÉTODO",
            "CRONOGRAMA",
            "RECURSOS",
            "REFERÊNCIAS",
        ),
    ),
    "academic-article": (
        "Artigo acadêmico",
        (
            "RESUMO",
            "INTRODUÇÃO",
            "MÉTODO",
            "RESULTADOS",
            "DISCUSSÃO",
            "CONCLUSÃO",
            "REFERÊNCIAS",
        ),
    ),
    "academic-review": (
        "Fichamento e revisão de literatura",
        (
            "REFERÊNCIA DA OBRA",
            "OBJETIVO DA LEITURA",
            "SÍNTESE",
            "CITAÇÕES E PÁGINAS",
            "ANÁLISE CRÍTICA",
            "RELAÇÃO COM A PESQUISA",
        ),
    ),
}


def document(identifier):
    title, headings = SCAFFOLDS[identifier]
    profile = PROFILES[0]

    def paragraph(text, heading=False, center=False):
        style = {**profile["paragraph"]}
        if heading:
            style.update(
                first_line_indent_pt=0,
                alignment="left",
                outline_level=0,
                space_before_pt=12,
                space_after_pt=12,
                keep_next=True,
            )
        if center:
            style.update(alignment="center", first_line_indent_pt=0, space_after_pt=18)
        return asdict(
            Paragraph(
                style=ParagraphStyle(**style),
                children=[
                    asdict(
                        TextRun(
                            text=text, style=TextStyle(**profile["text"], bold=heading)
                        )
                    )
                ],
            )
        )

    blocks = []
    if identifier != "academic-article":
        for value in (
            "[INSTITUIÇÃO]",
            "[CURSO]",
            "[NOME DO AUTOR]",
            title,
            "[CIDADE] · [ANO]",
        ):
            blocks.append(paragraph(value, center=True))
        from shared.contracts.document_model.schema import node_id

        blocks.append({"id": node_id(), "type": "page_break"})
    else:
        blocks += [paragraph(title, True), paragraph("[AUTOR · AFILIAÇÃO · CONTATO]")]
    for heading in headings:
        blocks += [
            paragraph(heading, True),
            paragraph(
                "[Preencha esta seção com conteúdo próprio e fontes verificáveis.]"
            ),
        ]
    return RichDocument(
        blocks=blocks,
        sections=[asdict(Section(**profile["section"]))],
        metadata={"academic_profile": "academic-base", "review_required": True},
    ).to_dict()

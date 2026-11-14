"""Original offline templates and their shared preview content."""

from dataclasses import asdict, dataclass
from pathlib import Path

from shared.contracts.document_model.schema import (
    Paragraph,
    ParagraphStyle,
    RichDocument,
    Section,
    TextRun,
    TextStyle,
)


@dataclass(frozen=True)
class Template:
    id: str
    format: str
    title: str
    category: str
    sections: tuple[tuple[str, str], ...]


CATALOG = (
    Template(
        "field-report",
        "docx",
        "Relatório de campo",
        "Pesquisa",
        (
            ("Identificação", "Sítio, equipe, data e coordenadas."),
            ("Método", "Descreva a unidade, a estratégia de coleta e o registro."),
            ("Observações", "Registre camadas, materiais e contexto."),
            ("Próximos passos", "Liste análises, pendências e anexos."),
        ),
    ),
    Template(
        "meeting-minutes",
        "docx",
        "Ata de reunião",
        "Profissional",
        (
            ("Identificação", "Data, local e participantes."),
            ("Pauta", "Assuntos discutidos e contexto."),
            ("Decisões", "Registre os encaminhamentos e as responsabilidades."),
        ),
    ),
    Template(
        "research-deck",
        "pptx",
        "Apresentação de pesquisa",
        "Acadêmico",
        (
            ("Problema e objetivos", "Apresente a pergunta e os objetivos do estudo."),
            ("Método", "Descreva a amostra e a estratégia de análise."),
            ("Resultados", "Destaque os achados e suas limitações."),
            ("Conclusão", "Resuma as contribuições e indique as próximas etapas."),
        ),
    ),
    Template(
        "project-deck",
        "pptx",
        "Plano de projeto",
        "Profissional",
        (
            ("Contexto", "Qual problema o projeto resolve?"),
            ("Escopo", "Liste as entregas e os limites do projeto."),
            ("Cronograma", "Apresente marcos, responsáveis e prazos."),
        ),
    ),
    Template(
        "review-sheet",
        "pdf",
        "Ficha de leitura",
        "Estudos",
        (
            ("Referência", "Autor, título, ano e páginas."),
            ("Argumento central", "Use o espaço abaixo para suas anotações."),
            (
                "Questões para discussão",
                "Registre dúvidas e conexões com outras leituras.",
            ),
        ),
    ),
)


from shared.services.office.academic import SCAFFOLDS

CATALOG += tuple(
    Template(
        identifier,
        "docx",
        title,
        "Acadêmico",
        tuple(
            (heading, "Preencha com conteúdo próprio e fontes verificáveis.")
            for heading in headings
        ),
    )
    for identifier, (title, headings) in SCAFFOLDS.items()
)
CATALOG += (
    Template(
        "academic-defense",
        "pptx",
        "Defesa de trabalho acadêmico",
        "Acadêmico",
        (
            ("Problema e contribuição", "Apresente o problema e sua contribuição."),
            ("Objetivos", "Defina objetivo geral e objetivos específicos."),
            ("Método", "Informe dados, procedimento e critérios de avaliação."),
            ("Resultados", "Apresente evidências, comparações e limitações."),
            (
                "Conclusão e próximos passos",
                "Retome as contribuições e agradecimentos.",
            ),
        ),
    ),
    Template(
        "academic-seminar",
        "pptx",
        "Seminário de leitura",
        "Acadêmico",
        (
            ("Referência e contexto", "Identifique a obra e o contexto."),
            ("Argumento", "Apresente o argumento central com suas palavras."),
            ("Evidências", "Discuta os dados usados pelos autores."),
            ("Análise crítica", "Separe interpretação e evidência."),
            ("Debate", "Prepare perguntas para discussão."),
        ),
    ),
)


def rich_document(template: Template) -> dict:
    if template.id in SCAFFOLDS:
        from shared.services.office.academic import document

        return document(template.id)
    blocks = [
        asdict(
            Paragraph(
                style=ParagraphStyle(outline_level=0, space_after_pt=14),
                children=[
                    asdict(
                        TextRun(
                            text=template.title,
                            style=TextStyle(bold=True, font_size_pt=24),
                        )
                    )
                ],
            )
        )
    ]
    for heading, body in template.sections:
        blocks.extend(
            (
                asdict(
                    Paragraph(
                        style=ParagraphStyle(outline_level=1, space_after_pt=5),
                        children=[
                            asdict(TextRun(text=heading, style=TextStyle(bold=True)))
                        ],
                    )
                ),
                asdict(
                    Paragraph(
                        style=ParagraphStyle(space_after_pt=12),
                        children=[asdict(TextRun(text=body))],
                    )
                ),
            )
        )
    return RichDocument(blocks=blocks, sections=[asdict(Section())]).to_dict()


def presentation(template: Template):
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.util import Inches, Pt

    deck = Presentation()
    deck.slide_width, deck.slide_height = Inches(13.333), Inches(7.5)
    for index, (title, body) in enumerate(
        ((template.title, template.category), *template.sections)
    ):
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = RGBColor.from_string(
            "17304B" if index == 0 else "F1F5F9"
        )
        for text, y, size in ((title, 1.35, 40), (body, 3.0, 25)):
            box = slide.shapes.add_textbox(
                Inches(1.1), Inches(y), Inches(11), Inches(1.4)
            )
            run = box.text_frame.paragraphs[0].add_run()
            run.text = text
            run.font.size = Pt(size)
            run.font.bold = y < 2
            run.font.color.rgb = RGBColor.from_string(
                "FFFFFF" if index == 0 else "17304B"
            )
    return deck


def write_pdf(template: Template, path: Path) -> None:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 23)
    pdf.cell(0, 15, template.title, new_x="LMARGIN", new_y="NEXT")
    for heading, body in template.sections:
        pdf.set_font("Helvetica", "B", 14)
        pdf.cell(0, 12, heading, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", size=11)
        pdf.multi_cell(0, 6, body, new_x="LMARGIN", new_y="NEXT")
        for _ in range(4):
            pdf.ln(8)
            y = pdf.get_y()
            pdf.line(10, y, 200, y)
        pdf.ln(6)
    pdf.output(path)

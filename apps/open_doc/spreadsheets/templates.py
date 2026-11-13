"""Editable workbook templates. All data is illustrative."""

from .store import empty_sheet

SAMPLES = {
    "research-budget": (
        "Orçamento de pesquisa",
        ["Recurso", "Quantidade", "Custo unitário"],
        ["Material de campo", "4", "25"],
        "Total",
        "B2*C2",
    ),
    "study-grades": (
        "Acompanhamento de avaliações",
        ["Disciplina", "Avaliação 1", "Avaliação 2"],
        ["Inteligência Artificial", "8", "9"],
        "Média",
        "MÉDIA(B2:C2)",
    ),
    "experiment": (
        "Registro de experimento",
        ["Amostra", "Medição 1", "Medição 2"],
        ["Controle", "10.2", "10.4"],
        "Média",
        "MÉDIA(B2:C2)",
    ),
    "budget": (
        "Orçamento doméstico",
        ["Categoria", "Previsto", "Real"],
        ["Moradia", "1500", "1480"],
        "Saldo",
        "B2-C2",
    ),
    "expenses": (
        "Controle de despesas",
        ["Despesa", "Valor", "Reembolso"],
        ["Transporte", "80", "20"],
        "Líquido",
        "B2-C2",
    ),
    "stock": (
        "Controle de estoque",
        ["Item", "Entradas", "Saídas"],
        ["Caixa", "50", "12"],
        "Saldo",
        "B2-C2",
    ),
    "project": (
        "Planejamento de projetos",
        ["Tarefa", "Planejado (h)", "Realizado (h)"],
        ["Revisão", "8", "3"],
        "Restante (h)",
        "B2-C2",
    ),
    "csv": (
        "Análise de CSV",
        ["Categoria", "Janeiro", "Fevereiro"],
        ["Exemplo", "120", "150"],
        "Média",
        "MÉDIA(B2:C2)",
    ),
}


def catalog():
    return [
        {
            "id": "sheet-" + key,
            "format": "xlsx",
            "title": sample[0],
            "category": "Planilhas",
            "sections": [
                ["Colunas", ", ".join(sample[1])],
                ["Dados de exemplo", ", ".join(sample[2])],
            ],
        }
        for key, sample in SAMPLES.items()
    ]


def sample(identifier):
    sample = SAMPLES.get(identifier.removeprefix("sheet-"))
    if sample is None:
        raise ValueError("Template de planilha não encontrado.")
    title, headings, values, metric, formula = sample
    sheet = empty_sheet("Exemplo")
    for row, items in enumerate(
        [headings + [metric], values + ["=" + formula], ["Exemplo"]]
    ):
        for col, value in enumerate(items):
            sheet["cells"][f"{row},{col}"] = value
    sheet["bold"] = [f"0,{col}" for col in range(4)]
    return title, [sheet]


def create(store, identifier):
    title, workbook = sample(identifier)
    return store.create(title, workbook)

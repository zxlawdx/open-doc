"""Editable workbook templates. All data is illustrative."""

from .store import empty_sheet

SAMPLES = {
    "budget": ("Orçamento doméstico", ["Categoria", "Previsto", "Real"], ["Moradia", "1500", "1480"], "Saldo", "B2-C2"),
    "expenses": ("Controle de despesas", ["Despesa", "Valor", "Reembolso"], ["Transporte", "80", "20"], "Líquido", "B2-C2"),
    "stock": ("Controle de estoque", ["Item", "Entradas", "Saídas"], ["Caixa", "50", "12"], "Saldo", "B2-C2"),
    "project": ("Planejamento de projetos", ["Tarefa", "Planejado (h)", "Realizado (h)"], ["Revisão", "8", "3"], "Restante (h)", "B2-C2"),
    "csv": ("Análise de CSV", ["Categoria", "Janeiro", "Fevereiro"], ["Exemplo", "120", "150"], "Média", "MÉDIA(B2:C2)"),
}


def catalog():
    return [
        {"id": "sheet-" + key, "format": "xlsx", "title": sample[0], "category": "Planilhas",
         "sections": [["Colunas", ", ".join(sample[1])], ["Dados de exemplo", ", ".join(sample[2])]]}
        for key, sample in SAMPLES.items()
    ]


def create(store, identifier):
    sample = SAMPLES.get(identifier.removeprefix("sheet-"))
    if sample is None:
        raise ValueError("Template de planilha não encontrado.")
    title, headings, values, metric, formula = sample
    sheet = empty_sheet("Exemplo")
    for row, items in enumerate([headings + [metric], values + ["=" + formula],
                                 ["Exemplo"]]):
        for col, value in enumerate(items):
            sheet["cells"][f"{row},{col}"] = value
    sheet["bold"] = [f"0,{col}" for col in range(4)]
    return store.create(title, [sheet])

"""One explicit compatibility contract; never infer fidelity from an extension."""

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class FormatCapability:
    extension: str
    editor: str
    level: str
    exports: tuple[str, ...]
    features: tuple[str, ...]
    limitations: tuple[str, ...]
    dependency: str | None = None


FORMATS = (
    FormatCapability(
        "docx",
        "rich",
        "editable",
        ("docx", "odt", "pdf", "html", "md"),
        ("text", "styles", "tables", "images", "math", "ink", "pages"),
        ("Campos e desenhos OOXML complexos ainda exigem adaptadores específicos.",),
    ),
    FormatCapability(
        "pdf",
        "pdf",
        "annotatable",
        ("pdf",),
        ("search", "ink", "notes", "page-extraction", "limited-text-replacement"),
        (
            "A edição de texto é limitada; não há recomposição geral das páginas.",
            "Texto digitalizado precisa de OCR.",
        ),
    ),
    FormatCapability(
        "xlsx",
        "workbook",
        "editable",
        ("xlsx", "csv", "tsv"),
        ("cells", "formulas", "charts", "images", "shapes", "validation", "pivot"),
        (
            "Nem todas as fórmulas, macros, caches de tabela dinâmica ou conexões externas do Excel são suportados.",
        ),
    ),
    FormatCapability(
        "csv",
        "workbook",
        "tabular",
        ("csv", "tsv", "xlsx"),
        ("cells", "formulas", "sort", "filter"),
        (
            "CSV armazena valores de texto; formatação, gráficos, abas e imagens exigem XLSX.",
        ),
    ),
    FormatCapability(
        "tsv",
        "workbook",
        "tabular",
        ("csv", "tsv", "xlsx"),
        ("cells", "formulas", "sort", "filter"),
        (
            "TSV armazena valores de texto; formatação, gráficos, abas e imagens exigem XLSX.",
        ),
    ),
    FormatCapability(
        "pptx",
        "presentation",
        "editable",
        ("pptx", "odp"),
        ("slides", "text", "tables", "images", "shapes", "math", "ink", "presentation"),
        (
            "Objetos especiais são preservados; nem todo componente interno possui um painel de edição.",
        ),
    ),
    FormatCapability(
        "odt",
        "rich",
        "converted",
        ("odt", "docx", "pdf", "html", "md"),
        ("text", "styles", "tables", "images", "pages"),
        (
            "Convertido via DOCX; revise layout complexo, campos e controle de alterações.",
        ),
        "LibreOffice",
    ),
    FormatCapability(
        "odp",
        "presentation",
        "converted",
        ("odp", "pptx"),
        ("slides", "text", "tables", "images", "shapes", "presentation"),
        ("Convertido via PPTX; revise efeitos, fontes, gráficos e slides mestres.",),
        "LibreOffice",
    ),
)


def matrix():
    from shared.services.office.opendocument import executable

    installed = executable() is not None
    return [
        {**asdict(item), "available": not item.dependency or installed}
        for item in FORMATS
    ]

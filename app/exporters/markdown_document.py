"""
Módulo: markdown_document.py.
Responsabilidade: interpretar Markdown com HTML e recursos remotos bloqueados.
Autor: Vela Writer Contributors
Criado em: 2026
"""

from __future__ import annotations

from markdown_it import MarkdownIt
from markdown_it.token import Token

PARSER = MarkdownIt("commonmark", {"html": False}).enable("table")


def tokens(markdown: str) -> list[Token]:
    """Retorna tokens estruturados sem executar HTML do documento."""
    return PARSER.parse(markdown)


def safe_html(markdown: str) -> str:
    """Renderiza Markdown para PDF sem carregar imagens locais ou remotas."""
    parser = MarkdownIt("commonmark", {"html": False}).enable("table")

    def image_text(items: list[Token], index: int, *args: object) -> str:
        from html import escape

        return escape("[Imagem: " + items[index].content + "]")

    parser.renderer.rules["image"] = image_text
    return parser.render(markdown)

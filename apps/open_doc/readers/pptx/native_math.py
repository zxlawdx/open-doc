"""Structured, editable mathematical OOXML (OMML) for native PPTX objects.

The math tree is deliberately small and validated. Unsupported external Office
mathematics is NOT flattened into images or plain text: such decks remain preview-only.
"""
from __future__ import annotations

from lxml import etree

M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
A14 = "http://schemas.microsoft.com/office/drawing/2010/main"
XML = "http://www.w3.org/XML/1998/namespace"
KINDS = {
    "text": ("value",),
    "fraction": ("numerator", "denominator"),
    "nary": ("operator", "lower", "upper", "body"),
    "superscript": ("base", "power"),
    "sqrt": ("radicand",),
}
OPERATORS = {"∫", "∬", "∮", "∑"}


def _tag(local):
    return "{%s}%s" % (M, local)


def _element(local, parent=None):
    item = etree.Element(_tag(local))
    if parent is not None:
        parent.append(item)
    return item


def validate_math_blocks(blocks):
    if not isinstance(blocks, list) or not 1 <= len(blocks) <= 32:
        raise ValueError("Equação deve ter entre 1 e 32 componentes.")
    for block in blocks:
        if not isinstance(block, dict) or block.get("kind") not in KINDS:
            raise ValueError("Componente de equação não suportado.")
        fields = KINDS[block["kind"]]
        if set(block) != {"kind", *fields}:
            raise ValueError("Campos desconhecidos no componente matemático.")
        for field in fields:
            value = block[field]
            if (not isinstance(value, str) or len(value) > 160 or
                    any(ord(char) < 32 and char not in "\t\n" for char in value)):
                raise ValueError("Expressão matemática inválida.")
        if block["kind"] == "nary" and block["operator"] not in OPERATORS:
            raise ValueError("Operador matemático não suportado.")
        if block["kind"] == "fraction" and (not block["numerator"] or not block["denominator"]):
            raise ValueError("Frações exigem numerador e denominador.")
        if block["kind"] == "sqrt" and not block["radicand"]:
            raise ValueError("Radicando vazio.")
        if block["kind"] == "superscript" and (not block["base"] or not block["power"]):
            raise ValueError("Potência incompleta.")
    if not any(any(block.get(field, "") for field in KINDS[block["kind"]] if field != "operator")
               for block in blocks):
        raise ValueError("Equação matemática vazia.")


def _run(parent, value):
    run = _element("r", parent)
    text = _element("t", run)
    text.set("{%s}space" % XML, "preserve")
    text.text = value


def _write_block(parent, block):
    kind = block["kind"]
    if kind == "text":
        _run(parent, block["value"])
    elif kind == "fraction":
        frac = _element("f", parent)
        _run(_element("num", frac), block["numerator"])
        _run(_element("den", frac), block["denominator"])
    elif kind == "nary":
        nary = _element("nary", parent)
        props = _element("naryPr", nary)
        _element("chr", props).set(_tag("val"), block["operator"])
        for label, value in (("sub", block["lower"]), ("sup", block["upper"]), ("e", block["body"])):
            _run(_element(label, nary), value)
    elif kind == "superscript":
        sup = _element("sSup", parent)
        _run(_element("e", sup), block["base"])
        _run(_element("sup", sup), block["power"])
    elif kind == "sqrt":
        rad = _element("rad", parent)
        props = _element("radPr", rad)
        _element("degHide", props).set(_tag("val"), "1")
        _element("deg", rad)
        _run(_element("e", rad), block["radicand"])


def write_math(shape, blocks):
    """Replace only the textbox math paragraph; the result is Office-native OMML."""
    validate_math_blocks(blocks)
    frame = shape.text_frame
    # python-pptx keeps non-run children of the first paragraph when clear()
    # is called. Remove the old math wrapper to avoid duplicate OMML zones.
    for old in list(shape._element.iter("{%s}m" % A14)):
        old.getparent().remove(old)
    frame.clear()
    paragraph = frame.paragraphs[0]._p
    wrapper = etree.Element("{%s}m" % A14, nsmap={"a14": A14, "m": M})
    math = _element("oMath", wrapper)
    for block in blocks:
        _write_block(math, block)
    paragraph.append(wrapper)


def read_math(shape):
    """Return known OMML components; raise on unsupported math to avoid data loss."""
    wrappers = list(shape._element.iter("{%s}m" % A14))
    if not wrappers:
        return None
    if len(wrappers) != 1:
        raise ValueError("Múltiplos blocos de equação no objeto PPTX.")
    wrapper = wrappers[0]
    math = wrapper.find(_tag("oMath"))
    if math is None:
        paragraph = wrapper.find(_tag("oMathPara"))
        math = paragraph.find(_tag("oMath")) if paragraph is not None else None
    if math is None:
        raise ValueError("Estrutura matemática externa desconhecida.")
    result = []
    def text(section):
        if section is None:
            raise ValueError("Parte obrigatória da equação ausente.")
        runs = list(section)
        if len(runs) != 1 or runs[0].tag != _tag("r"):
            raise ValueError("Expressão matemática aninhada ainda não suportada.")
        t = runs[0].find(_tag("t"))
        if t is None:
            raise ValueError("Texto matemático sem conteúdo.")
        return t.text or ""
    for child in math:
        if child.tag == _tag("r"):
            result.append({"kind": "text", "value": text_section_run(child)})
        elif child.tag == _tag("f"):
            result.append({"kind": "fraction", "numerator": text(child.find(_tag("num"))),
                           "denominator": text(child.find(_tag("den")))})
        elif child.tag == _tag("nary"):
            pr = child.find(_tag("naryPr"))
            chr_node = pr.find(_tag("chr")) if pr is not None else None
            op = chr_node.get(_tag("val")) if chr_node is not None else None
            result.append({"kind": "nary", "operator": op, "lower": text(child.find(_tag("sub"))),
                           "upper": text(child.find(_tag("sup"))), "body": text(child.find(_tag("e")))})
        elif child.tag == _tag("sSup"):
            result.append({"kind": "superscript", "base": text(child.find(_tag("e"))),
                           "power": text(child.find(_tag("sup")))})
        elif child.tag == _tag("rad"):
            result.append({"kind": "sqrt", "radicand": text(child.find(_tag("e")))})
        else:
            raise ValueError("Operação matemática externa ainda não suportada.")
    validate_math_blocks(result)
    return result


def text_section_run(run):
    t = run.find(_tag("t"))
    if t is None:
        raise ValueError("Run matemático sem texto.")
    return t.text or ""

"""Bounded, editable Office Math (OMML) trees for PPTX and DOCX.

A formula is a list of typed nodes. Composite arguments may be plain strings
(legacy documents) or nested lists of nodes. No equation is flattened to PNG.
Unknown Office Math features are rejected by this reader, so importers retain
the untouched source rather than silently degrading it.
"""
from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from lxml import etree

M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
A14 = "http://schemas.microsoft.com/office/drawing/2010/main"
XML = "http://www.w3.org/XML/1998/namespace"
KINDS = {
    "text": ("value",),
    "bold": ("value",),
    "fraction": ("numerator", "denominator"),
    "nary": ("operator", "lower", "upper", "body"),
    "superscript": ("base", "power"),
    "subscript": ("base", "sub"),
    "sqrt": ("radicand",),
    "root": ("index", "radicand"),
    "limit": ("base", "lower"),
    "matrix": ("rows",),
}
OPERATORS = {"∫", "∬", "∭", "∮", "∯", "∑", "∏"}
MAX_DEPTH = 6
MAX_NODES = 512
MAX_COMPONENTS = 32
MAX_ROWS = 6
MAX_COLUMNS = 6
MATRIX_FENCES = {"round": ("(", ")"), "square": ("[", "]")}


def _tag(name):
    return "{%s}%s" % (M, name)


def _element(name, parent=None):
    item = etree.Element(_tag(name))
    if parent is not None:
        parent.append(item)
    return item


def validate_math_blocks(blocks):
    """Reject oversized/malformed structures before use, including nested ones."""
    count = [0]

    def validate_list(parts, depth):
        if depth > MAX_DEPTH or not isinstance(parts, list) or not 1 <= len(parts) <= MAX_COMPONENTS:
            raise ValueError("Profundidade ou quantidade de componentes matemáticos inválida.")
        for item in parts:
            count[0] += 1
            if count[0] > MAX_NODES or not isinstance(item, dict):
                raise ValueError("Equação matemática complexa demais.")
            kind = item.get("kind")
            if kind not in KINDS:
                raise ValueError("Componente matemático desconhecido.")
            fields = {"kind", *KINDS[kind]}
            if kind == "matrix" and "fence" in item:
                if not isinstance(item["fence"], str) or item["fence"] not in MATRIX_FENCES:
                    raise ValueError("Delimitador de matriz não suportado.")
                fields.add("fence")
            if set(item) != fields:
                raise ValueError("Componente matemático desconhecido.")
            if kind == "matrix":
                rows = item["rows"]
                if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
                    raise ValueError("Matriz matemática inválida.")
                cols = len(rows[0]) if isinstance(rows[0], list) else 0
                if not 1 <= cols <= MAX_COLUMNS:
                    raise ValueError("Número de colunas inválido.")
                for row in rows:
                    if not isinstance(row, list) or len(row) != cols:
                        raise ValueError("Matriz matemática irregular.")
                    for cell in row:
                        validate_value(cell, depth + 1, required=True)
                continue
            for field in KINDS[kind]:
                val = item[field]
                if kind == "nary" and field == "operator":
                    if val not in OPERATORS:
                        raise ValueError("Operador matemático não suportado.")
                    continue
                if kind == "bold" and not isinstance(val, str):
                    raise ValueError("Texto matemático em negrito inválido.")
                optional = kind == "nary" and field in {"lower", "upper"}
                validate_value(val, depth + 1, required=not optional)
        return True

    def validate_value(value, depth, *, required):
        if isinstance(value, list):
            validate_list(value, depth)
        elif not isinstance(value, str):
            raise ValueError("Componente matemático inválido.")
        elif (len(value) > 160 or any(ord(c) < 32 and c not in "\t\n" for c in value)
              or (required and not value.strip())):
            raise ValueError("Expressão matemática inválida ou vazia.")

    validate_list(blocks, 0)


def _run(parent, text, *, bold=False):
    node = _element("r", parent)
    if bold:
        props = _element("rPr", node)
        _element("sty", props).set(_tag("val"), "b")
    leaf = _element("t", node)
    leaf.set("{%s}space" % XML, "preserve")
    leaf.text = text


def _put(parent, value):
    if isinstance(value, list):
        for item in value:
            _write_block(parent, item)
    else:
        _run(parent, value)


def _write_block(parent, block):
    kind = block["kind"]
    if kind in {"text", "bold"}:
        _run(parent, block["value"], bold=kind == "bold")
    elif kind == "fraction":
        frac = _element("f", parent)
        _put(_element("num", frac), block["numerator"])
        _put(_element("den", frac), block["denominator"])
    elif kind == "nary":
        nary = _element("nary", parent)
        props = _element("naryPr", nary)
        _element("chr", props).set(_tag("val"), block["operator"])
        for name, field in (("sub", "lower"), ("sup", "upper"), ("e", "body")):
            _put(_element(name, nary), block[field])
    elif kind in {"superscript", "subscript"}:
        node = _element("sSup" if kind == "superscript" else "sSub", parent)
        _put(_element("e", node), block["base"])
        _put(_element("sup" if kind == "superscript" else "sub", node),
             block["power"] if kind == "superscript" else block["sub"])
    elif kind in {"sqrt", "root"}:
        rad = _element("rad", parent)
        props = _element("radPr", rad)
        if kind == "sqrt":
            _element("degHide", props).set(_tag("val"), "1")
        deg = _element("deg", rad)
        if kind == "root":
            _put(deg, block["index"])
        _put(_element("e", rad), block["radicand"])
    elif kind == "limit":
        node = _element("limLow", parent)
        _put(_element("e", node), block["base"])
        _put(_element("lim", node), block["lower"])
    elif kind == "matrix":
        if "fence" in block:
            delimiter = _element("d", parent)
            props = _element("dPr", delimiter)
            start, end = MATRIX_FENCES[block["fence"]]
            _element("begChr", props).set(_tag("val"), start)
            _element("endChr", props).set(_tag("val"), end)
            parent = _element("e", delimiter)
        matrix = _element("m", parent)
        for row in block["rows"]:
            r = _element("mr", matrix)
            for cell in row:
                _put(_element("e", r), cell)


def write_math(shape, blocks):
    """Replace the existing PPTX math wrapper atomically within a text box."""
    validate_math_blocks(blocks)
    frame = shape.text_frame
    for old in list(shape._element.iter("{%s}m" % A14)):
        old.getparent().remove(old)
    frame.clear()
    paragraph = frame.paragraphs[0]._p
    wrapper = etree.Element("{%s}m" % A14, nsmap={"a14": A14, "m": M})
    math = _element("oMath", wrapper)
    for block in blocks:
        _write_block(math, block)
    paragraph.append(wrapper)


def _read_run(run):
    children = [child for child in run if child.tag != _tag("rPr")]
    if len(children) != 1 or children[0].tag != _tag("t"):
        raise ValueError("Run matemático complexo não suportado.")
    return children[0].text or ""


def _read_sequence(node):
    """Return a scalar for old documents and a node list for nested math."""
    if node is None:
        raise ValueError("Componente OMML obrigatório ausente.")
    values = _read_blocks(node)
    if not values:
        return ""
    if len(values) == 1 and values[0]["kind"] == "text":
        return values[0]["value"]
    return values


def _read_blocks(root):
    out = []
    for child in root:
        kind = child.tag
        if kind == _tag("r"):
            style = child.find(f"{_tag('rPr')}/{_tag('sty')}")
            bold = style is not None and style.get(_tag("val")) == "b"
            out.append({"kind": "bold" if bold else "text", "value": _read_run(child)})
        elif kind == _tag("f"):
            out.append({"kind": "fraction",
                        "numerator": _read_sequence(child.find(_tag("num"))),
                        "denominator": _read_sequence(child.find(_tag("den")))})
        elif kind == _tag("nary"):
            pr = child.find(_tag("naryPr"))
            char = pr.find(_tag("chr")) if pr is not None else None
            operator = char.get(_tag("val")) if char is not None else None
            out.append({"kind": "nary", "operator": operator,
                        "lower": _read_sequence(child.find(_tag("sub"))),
                        "upper": _read_sequence(child.find(_tag("sup"))),
                        "body": _read_sequence(child.find(_tag("e")))})
        elif kind in (_tag("sSup"), _tag("sSub")):
            sup = kind == _tag("sSup")
            out.append({"kind": "superscript" if sup else "subscript",
                        "base": _read_sequence(child.find(_tag("e"))),
                        ("power" if sup else "sub"): _read_sequence(
                            child.find(_tag("sup" if sup else "sub")))})
        elif kind == _tag("rad"):
            props = child.find(_tag("radPr"))
            hidden = props.find(_tag("degHide")) if props is not None else None
            simple = hidden is not None and hidden.get(_tag("val")) in ("1", "true")
            if simple:
                out.append({"kind": "sqrt",
                            "radicand": _read_sequence(child.find(_tag("e")))})
            else:
                out.append({"kind": "root",
                            "index": _read_sequence(child.find(_tag("deg"))),
                            "radicand": _read_sequence(child.find(_tag("e")))})
        elif kind == _tag("limLow"):
            out.append({"kind": "limit",
                        "base": _read_sequence(child.find(_tag("e"))),
                        "lower": _read_sequence(child.find(_tag("lim")))})
        elif kind == _tag("d"):
            props = child.find(_tag("dPr"))
            expressions = child.findall(_tag("e"))
            if len(expressions) != 1 or (
                props is not None
                and any(node.tag not in {_tag("begChr"), _tag("endChr")} for node in props)
            ):
                raise ValueError("Delimitador OMML não suportado.")
            pair = ["(", ")"]
            if props is not None:
                for index, tag in enumerate(("begChr", "endChr")):
                    char = props.find(_tag(tag))
                    if char is not None:
                        pair[index] = char.get(_tag("val"), "")
            fence = next((key for key, value in MATRIX_FENCES.items() if value == tuple(pair)), None)
            contents = _read_blocks(expressions[0])
            if not fence or len(contents) != 1 or contents[0]["kind"] != "matrix" or "fence" in contents[0]:
                raise ValueError("Delimitador OMML não suportado.")
            out.append({**contents[0], "fence": fence})
        elif kind == _tag("m"):
            rows = []
            for row in child:
                if row.tag == _tag("mPr"):
                    continue
                if row.tag != _tag("mr"):
                    raise ValueError("Matriz OMML desconhecida.")
                cells = []
                for cell in row:
                    if cell.tag != _tag("e"):
                        raise ValueError("Célula OMML desconhecida.")
                    cells.append(_read_sequence(cell))
                rows.append(cells)
            out.append({"kind": "matrix", "rows": rows})
        else:
            raise ValueError("Operação OMML ainda não suportada: %s" % child.tag)
    return out


def read_math(shape):
    """Read supported PPTX math. Caller must preserve original if unsupported."""
    wrappers = list(shape._element.iter("{%s}m" % A14))
    if not wrappers:
        return None
    if len(wrappers) != 1:
        raise ValueError("Múltiplos blocos matemáticos no objeto.")
    wrapper = wrappers[0]
    math = wrapper.find(_tag("oMath"))
    if math is None:
        paragraph = wrapper.find(_tag("oMathPara"))
        math = paragraph.find(_tag("oMath")) if paragraph is not None else None
    if math is None:
        raise ValueError("Estrutura OMML desconhecida.")
    result = _read_blocks(math)
    validate_math_blocks(result)
    return result


def text_section_run(run):
    return _read_run(run)


def build_word_omath(blocks):
    validate_math_blocks(blocks)
    math = etree.Element(_tag("oMath"), nsmap={"m": M})
    for block in blocks:
        _write_block(math, block)
    return math


def parse_word_omath(math):
    if math is None or math.tag != _tag("oMath"):
        raise ValueError("Estrutura matemática Word desconhecida.")
    result = _read_blocks(math)
    validate_math_blocks(result)
    return result

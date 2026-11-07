"""Restore one slide from a validated snapshot of the same presentation."""

from .serialization import load, serialize


def restore_slide(current_json, selected_json, index):
    current, selected = load(current_json), load(selected_json)
    if not all(
        model["source_kind"] == "pptx" and model.get("editable_deck") is True
        for model in (current, selected)
    ):
        raise ValueError("A restauração de slides exige uma apresentação editável.")
    if type(index) is not int or not 0 <= index < min(
        len(current["surfaces"]), len(selected["surfaces"])
    ):
        raise ValueError("O slide precisa existir nas duas versões.")
    target, old = current["surfaces"][index], selected["surfaces"][index]
    if any(
        target.get(key) != old.get(key)
        for key in ("width_pt", "height_pt", "source_slide_index")
    ):
        raise ValueError("Os slides têm origens ou dimensões incompatíveis.")

    for element in old.get("elements", []):
        if element["type"] != "image":
            continue
        asset_id = element["asset_id"]
        asset = selected["assets"][asset_id]
        assets = current.setdefault("assets", {})
        if assets.setdefault(asset_id, asset) != asset:
            raise ValueError("Uma imagem da versão antiga conflita com a versão atual.")
    current["surfaces"][index] = old
    return serialize(current)

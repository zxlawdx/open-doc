"""Non-destructive DrawingML picture adjustments for editable slides."""

from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement


def export_image_effects(blip, picture):
    opacity = picture.get("image_opacity", 100)
    brightness = picture.get("image_brightness", 0)
    contrast = picture.get("image_contrast", 0)
    if opacity != 100:
        alpha = OxmlElement("a:alphaModFix")
        alpha.set("amt", str(round(opacity * 1000)))
        blip.append(alpha)
    if brightness or contrast:
        luminance = OxmlElement("a:lum")
        luminance.set("bright", str(round(brightness * 1000)))
        luminance.set("contrast", str(round(contrast * 1000)))
        blip.append(luminance)
    if picture.get("image_grayscale"):
        blip.append(OxmlElement("a:grayscl"))


def import_image_effects(blip):
    adjustments = {}
    seen = set()
    for effect in blip:
        if effect.tag == qn("a:extLst"):
            continue
        if effect.tag in seen:
            raise ValueError("Efeito de imagem repetido.")
        seen.add(effect.tag)
        if effect.tag == qn("a:alphaModFix"):
            adjustments["image_opacity"] = int(effect.get("amt", "100000")) / 1000
        elif effect.tag == qn("a:lum"):
            adjustments["image_brightness"] = int(effect.get("bright", "0")) / 1000
            adjustments["image_contrast"] = int(effect.get("contrast", "0")) / 1000
        elif effect.tag == qn("a:grayscl"):
            adjustments["image_grayscale"] = True
        else:
            raise ValueError("Efeito de imagem fora do subconjunto editável.")
    return adjustments

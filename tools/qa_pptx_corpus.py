"""Validate editing and OOXML round-trip of an external 36-slide corpus."""

import argparse
import sys
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.composition import configure
from shared.services.preferences_service import Config


def edit_text(note, suffix):
    model = deepcopy(note["content"])
    target = next(
        obj
        for obj in model["surfaces"][0]["elements"]
        if obj.get("text_runs") and obj["text_runs"][0]
    )
    target["text_runs"][0][0]["text"] += suffix
    target["text"] = "\n".join(
        "".join(run["text"] for run in para) for para in target["text_runs"]
    )
    return model, target["text"]


def metrics(model):
    slides = model["surfaces"]
    objects = [obj for slide in slides for obj in slide["elements"]]
    return len(slides), len(objects), sum(o["type"] == "image" for o in objects)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("presentation", type=Path)
    source = parser.parse_args().presentation.resolve(strict=True)
    source_bytes = source.read_bytes()
    with TemporaryDirectory() as root:
        ctx = configure(Config(Path(root)))
        note = ctx.documents.import_path(source)["document"]
        assert note["capabilities"]["edit_slides"]
        baseline = metrics(note["content"])
        assert baseline[0] == 36
        model, expected = edit_text(note, " [QA 1]")
        saved = ctx.fixed_documents.save(
            note["id"], note["title"], model, note["revision"]
        )
        target = Path(root) / "qa-export.pptx"
        ctx.fixed_documents.export(saved["id"], saved["revision"], "pptx", target)
        reopened = ctx.fixed_documents.import_pptx(target)
        assert metrics(reopened["content"]) == baseline
        assert expected in [
            obj.get("text") for obj in reopened["content"]["surfaces"][0]["elements"]
        ]
        with ZipFile(source) as first, ZipFile(target) as second:
            assert set(first.namelist()) == set(second.namelist())
            modified = [
                part
                for part in first.namelist()
                if first.read(part) != second.read(part)
            ]
            assert modified == ["ppt/slides/slide1.xml"], modified
        model, expected = edit_text(reopened, " [QA 2]")
        edited = ctx.fixed_documents.save(
            reopened["id"], reopened["title"], model, reopened["revision"]
        )
        assert expected in [
            obj.get("text") for obj in edited["content"]["surfaces"][0]["elements"]
        ]
        assert source.read_bytes() == source_bytes
        print(
            "PPTX_CORPUS_ROUNDTRIP_OK",
            "slides, objetos, imagens",
            baseline,
            "partes alteradas",
            modified,
        )


if __name__ == "__main__":
    main()

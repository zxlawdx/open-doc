"""Opt-in PaddleOCR 2.10 adapter; both models must already exist locally."""

import asyncio
import json
from pathlib import Path
from .handwriting import Recognition


class PaddleOcrBackend:
    name = "paddleocr"

    def __init__(self, config):
        self.directory = config.root / ".veladata" / "models"
        self.settings = self.directory / "paddle.json"

    @property
    def available(self):
        try:
            import importlib.util

            if not importlib.util.find_spec("paddleocr") or not self.settings.is_file():
                return False
            settings = json.loads(self.settings.read_text())
            return all(
                (self.directory / settings[key] / "inference.pdmodel").is_file()
                and (self.directory / settings[key])
                .resolve()
                .is_relative_to(self.directory.resolve())
                for key in ["det_model_dir", "rec_model_dir"]
            )
        except (ValueError, KeyError, OSError):
            return False

    async def recognize(self, strokes, *, language="pt-BR"):
        return await asyncio.to_thread(self._recognize, strokes, language)

    def _recognize(self, strokes, language):
        import numpy as np
        from paddleocr import PaddleOCR
        from .raster import recognition_image

        if not self.available:
            raise RuntimeError(
                "Configure modelos locais em .veladata/models/paddle.json."
            )
        settings = json.loads(self.settings.read_text())
        # All model paths supplied; angle classifier disabled to prevent downloads.
        engine = PaddleOCR(
            det_model_dir=str(self.directory / settings["det_model_dir"]),
            rec_model_dir=str(self.directory / settings["rec_model_dir"]),
            use_angle_cls=False,
            lang="latin",
            show_log=False,
            use_gpu=False,
        )
        result = engine.ocr(np.array(recognition_image(strokes)), cls=False)
        values = [row[1] for page in result or [] for row in page or []]
        return Recognition(
            " ".join(text for text, score in values),
            sum(score for text, score in values) / len(values) if values else None,
            self.name,
            language,
        )

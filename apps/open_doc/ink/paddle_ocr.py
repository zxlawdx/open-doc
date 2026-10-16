"""Opt-in PaddleOCR 2.10 adapter; both models must already exist locally."""

import asyncio
import importlib.util
import json
from pathlib import Path
from .handwriting import Recognition


class PaddleOcrBackend:
    name = "paddleocr"

    def __init__(self, config):
        self.directory = config.root / ".veladata" / "models"
        self.settings = self.directory / "paddle.json"

    def diagnostics(self, language="pt-BR"):
        result = {
            "backend": self.name,
            "available": False,
            "language": language,
            "package_installed": False,
            "settings_present": self.settings.is_file(),
            "models_present": False,
            "reason": "PaddleOCR não configurado.",
        }
        try:
            result["package_installed"] = bool(importlib.util.find_spec("paddleocr"))
            if not result["package_installed"]:
                result["reason"] = (
                    "PaddleOCR não instalado. Instale requirements-ocr.txt para habilitar este backend local."
                )
                return result
            if not result["settings_present"]:
                result["reason"] = (
                    "PaddleOCR não configurado: .veladata/models/paddle.json não foi encontrado."
                )
                return result
            settings = json.loads(self.settings.read_text(encoding="utf-8"))
            directories = []
            for key in ["det_model_dir", "rec_model_dir"]:
                relative = settings[key]
                if not isinstance(relative, str) or not relative:
                    raise ValueError(f"Configuração inválida para {key}.")
                directory = (self.directory / relative).resolve()
                if not directory.is_relative_to(self.directory.resolve()):
                    raise ValueError("Modelo PaddleOCR fora do diretório local permitido.")
                directories.append(directory)
            result["models_present"] = all(
                (directory / "inference.pdmodel").is_file()
                for directory in directories
            )
            if not result["models_present"]:
                result["reason"] = (
                    "PaddleOCR configurado, mas os modelos locais de detecção/recognition não foram encontrados."
                )
                return result
            result["available"] = True
            result["reason"] = ""
            return result
        except (ValueError, KeyError, OSError, json.JSONDecodeError) as exc:
            result["reason"] = "PaddleOCR não configurado: " + str(exc)[:180]
            return result

    @property
    def available(self):
        return self.diagnostics()["available"]

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
        settings = json.loads(self.settings.read_text(encoding="utf-8"))
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

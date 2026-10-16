"""Optional PyWinRT 3.2.1 adapter. Imported only inside its worker on Windows."""

import asyncio
import sys
from .handwriting import Recognition


class WindowsInkBackend:
    name = "windows-ink"

    def diagnostics(self, language="pt-BR"):
        result = {
            "backend": self.name,
            "available": False,
            "language": language,
            "pywinrt_installed": False,
            "recognizers": [],
            "reason": "Windows Ink requer Windows.",
        }
        if sys.platform != "win32":
            return result
        try:
            import winrt.windows.ui.input.inking

            result["pywinrt_installed"] = True
        except ImportError:
            result["reason"] = (
                "PyWinRT não instalado. Instale requirements-windows-ink.txt."
            )
            return result
        try:
            from winrt.runtime import init_apartment, uninit_apartment, ApartmentType

            init_apartment(ApartmentType.MULTI_THREADED)
            try:
                from winrt.windows.ui.input.inking import InkRecognizerContainer

                names = [r.name for r in InkRecognizerContainer().get_recognizers()]
            finally:
                uninit_apartment()
            result["recognizers"] = names
            matches = [
                n
                for n in names
                if not language.startswith("pt") or "portugu" in n.casefold()
            ]
            result["available"] = bool(matches)
            result["recognizer"] = matches[0] if matches else None
            result["reason"] = (
                ""
                if matches
                else (
                    "Instale o recurso de escrita Português no Windows."
                    if names
                    else "Nenhum reconhecedor de escrita instalado no Windows."
                )
            )
        except Exception as exc:
            result["reason"] = "Windows Ink indisponível: " + str(exc)[:160]
        return result

    @property
    def available(self):
        return self.diagnostics()["available"]

    async def recognize(self, strokes, *, language="pt-BR"):
        return await asyncio.to_thread(self._recognize, strokes, language)

    def _recognize(self, strokes, language):
        from winrt.runtime import init_apartment, uninit_apartment, ApartmentType

        init_apartment(ApartmentType.MULTI_THREADED)
        try:
            from winrt.windows.ui.input.inking import (
                InkPoint,
                InkRecognitionTarget,
                InkRecognizerContainer,
                InkStrokeBuilder,
                InkStrokeContainer,
            )

            builder = InkStrokeBuilder()
            container = InkStrokeContainer()
            # Tuple structs are supported by PyWinRT 3; identity is six floats.
            for stroke in strokes:
                points = [
                    InkPoint(
                        (p["x"] * 1000, p["y"] * 1000),
                        p.get("pressure", 0.5),
                        p.get("tilt_x", 0),
                        p.get("tilt_y", 0),
                        int(p.get("timestamp_ms", 0) * 1000),
                    )
                    for p in stroke["points"]
                ]
                container.add_stroke(
                    builder.create_stroke_from_ink_points(
                        points, (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                    )
                )
            recognizer = InkRecognizerContainer()
            installed = list(recognizer.get_recognizers())
            if not installed:
                raise RuntimeError("Nenhum idioma de escrita instalado no Windows.")
            match = (
                next(
                    (
                        r
                        for r in installed
                        if ("portugu" in r.name.casefold())
                        if language.startswith("pt")
                    ),
                    None,
                )
                if language.startswith("pt")
                else None
            )
            if language.startswith("pt") and not match:
                raise RuntimeError("Instale o recurso de escrita Português no Windows.")
            if match:
                recognizer.set_default_recognizer(match)
            results = recognizer.recognize_async(
                container, InkRecognitionTarget.ALL
            ).get()
            return Recognition(
                " ".join(
                    r.get_text_candidates()[0]
                    for r in results
                    if r.get_text_candidates()
                ),
                None,
                self.name,
                language,
            )
        finally:
            uninit_apartment()

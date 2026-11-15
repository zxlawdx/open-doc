"""Regression tests for reported Fedora EGL and Zorin install-path failures."""
import re
import unittest

def classify(log):
    return {
        "egl_missing": "qt.qpa.wayland: EGL not available" in log,
        "running": bool(re.search(r"Lifecycle\s*[→>-]+\s*running", log)),
        "missing_path": "Arquivo ou diretório inexistente" in log or "No such file or directory" in log,
    }

def has_rendered_pixels(rgb, tolerance=8):
    """True when screenshot RGB bytes contain a pixel darker than near-white."""
    if not rgb or len(rgb) % 3:
        raise ValueError("Expected nonempty RGB triples")
    return any(v < 255 - tolerance for v in rgb)

class RegressionTests(unittest.TestCase):
    def test_fedora_app_running_does_not_mean_egl_available(self):
        log = "DEBUG [vela.lifecycle] Lifecycle → running\nqt.qpa.wayland: EGL not available"
        self.assertTrue(classify(log)["running"])
        self.assertTrue(classify(log)["egl_missing"])

    def test_zorin_bad_install_path_is_separate_from_rendering(self):
        log = "bash: cd: /home/carlos_evan/.local/opt/open-doc/Open-Doc: Arquivo ou diretório inexistente"
        self.assertTrue(classify(log)["missing_path"])
        self.assertFalse(classify(log)["running"])

    def test_blank_white_screenshot_fails(self):
        self.assertFalse(has_rendered_pixels(bytes([255,255,255] * 100)))
        self.assertTrue(has_rendered_pixels(bytes([255,255,255] * 99 + [20,20,20])))

if __name__ == "__main__":
    unittest.main()

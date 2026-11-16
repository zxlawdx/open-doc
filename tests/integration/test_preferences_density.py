"""The shared shell density uses the same durable settings service as theme/zoom."""
import pytest
from shared.services.preferences_service import Config


def test_density_round_trips_via_real_settings_service(tmp_path):
    config = Config(tmp_path)
    assert config.load_settings()["density"] == "comfortable"
    config.save_settings({"density": "compact"})
    assert Config(tmp_path).load_settings()["density"] == "compact"


def test_invalid_density_does_not_overwrite_settings(tmp_path):
    config = Config(tmp_path)
    with pytest.raises(ValueError, match="Densidade inválida"):
        config.save_settings({"density": "microscopic"})
    assert Config(tmp_path).load_settings()["density"] == "comfortable"

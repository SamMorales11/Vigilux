"""Configuration module for Vigilux ML Engine Telemetry Simulator."""

from dataclasses import dataclass, field
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env if present
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


@dataclass(frozen=True)
class AssetBaseProfile:
    """Baseline physical metrics profile for an industrial machine."""
    asset_id: str
    name: str
    asset_type: str
    rated_kw: float
    base_kw: float
    base_rpm: float
    base_temp_c: float
    base_vib_rms: float
    base_pressure: float
    iso_vibration_limit: float


@dataclass
class FailureScenarioConfig:
    """Configuration for mechanical bearing degradation failure injection."""
    enabled: bool = os.getenv("SIMULATE_FAILURE", "false").lower() in ("true", "1", "yes")
    target_asset_id: str = os.getenv("FAILURE_TARGET_ASSET", "MOTOR-03")
    total_steps: int = int(os.getenv("FAILURE_PROGRESSION_STEPS", "25"))
    
    # Degradation parameters for MOTOR-03
    vib_start_rms: float = 1.8
    vib_target_rms: float = 7.8
    temp_increase_c: float = 18.0
    power_surge_multiplier: float = 0.34  # +34% kW electrical surge


@dataclass
class AppConfig:
    """Application-wide configuration parameters."""
    backend_api_url: str = os.getenv("BACKEND_API_URL", "http://localhost:3000/api/v1/telemetry")
    sampling_interval_seconds: float = float(os.getenv("SAMPLING_INTERVAL_SECONDS", "1.0"))  # 1 Hz frequency
    request_timeout_seconds: float = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "3.0"))
    max_retries: int = int(os.getenv("MAX_RETRIES", "3"))
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    
    failure_scenario: FailureScenarioConfig = field(default_factory=FailureScenarioConfig)

    # 5 standard industrial machinery baseline profiles
    asset_profiles: dict[str, AssetBaseProfile] = field(default_factory=lambda: {
        "MOTOR-01": AssetBaseProfile(
            asset_id="MOTOR-01",
            name="Induction Motor #01 (Primary Conveyor)",
            asset_type="Motor",
            rated_kw=75.0,
            base_kw=66.5,
            base_rpm=1485.0,
            base_temp_c=58.0,
            base_vib_rms=2.1,
            base_pressure=0.0,
            iso_vibration_limit=4.5,
        ),
        "MOTOR-02": AssetBaseProfile(
            asset_id="MOTOR-02",
            name="Induction Motor #02 (Cooling Fan Drive)",
            asset_type="Motor",
            rated_kw=45.0,
            base_kw=39.5,
            base_rpm=2950.0,
            base_temp_c=51.5,
            base_vib_rms=1.7,
            base_pressure=0.0,
            iso_vibration_limit=4.5,
        ),
        "MOTOR-03": AssetBaseProfile(
            asset_id="MOTOR-03",
            name="Induction Motor #03 (Heavy Crusher)",
            asset_type="Motor",
            rated_kw=110.0,
            base_kw=86.0,
            base_rpm=1475.0,
            base_temp_c=66.0,
            base_vib_rms=1.8,  # Starts at 1.8 mm/s before bearing degradation
            base_pressure=0.0,
            iso_vibration_limit=4.5,
        ),
        "PUMP-01": AssetBaseProfile(
            asset_id="PUMP-01",
            name="Centrifugal Slurry Pump #01",
            asset_type="Pump",
            rated_kw=55.0,
            base_kw=48.0,
            base_rpm=1750.0,
            base_temp_c=60.5,
            base_vib_rms=2.8,
            base_pressure=6.0,
            iso_vibration_limit=4.5,
        ),
        "COMP-01": AssetBaseProfile(
            asset_id="COMP-01",
            name="Rotary Screw Air Compressor #01",
            asset_type="Compressor",
            rated_kw=90.0,
            base_kw=78.0,
            base_rpm=3100.0,
            base_temp_c=76.0,
            base_vib_rms=2.4,
            base_pressure=8.2,
            iso_vibration_limit=3.5,
        ),
    })


# Global configuration singleton
config = AppConfig()

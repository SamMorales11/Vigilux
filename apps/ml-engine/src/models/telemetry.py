"""Pydantic models for industrial sensor telemetry and ML inference results."""

from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator


class TelemetryPayload(BaseModel):
    """Payload representing a single real-time sensor reading and ML predictions for an asset."""

    asset_id: str = Field(..., description="Unique industrial asset identifier (e.g. MOTOR-01)")
    timestamp: str = Field(
        default_factory=lambda: datetime.now().astimezone().isoformat(),
        description="ISO 8601 formatted timestamp of the reading"
    )
    kw: float = Field(..., description="Active electrical power in kilowatts (kW)")
    rpm: float = Field(..., description="Rotational speed in revolutions per minute (RPM)")
    temp_c: float = Field(..., description="Bearing / operating temperature in Celsius (°C)")
    vib_rms: float = Field(..., description="Vibration root mean square velocity in mm/s")
    pressure: float = Field(..., description="Discharge / working pressure in bar")

    # Real-time Machine Learning Inference Fields (Phase 2)
    predicted_kw: Optional[float] = Field(default=None, description="LightGBM predicted baseline active power (kW)")
    waste_gap_kw: Optional[float] = Field(default=None, description="Positive energy gap (actual kW - predicted kW)")
    waste_pct: Optional[float] = Field(default=None, description="Percentage of active power wasted (%)")
    anomaly_score: Optional[float] = Field(default=None, description="Normalized anomaly probability score [0.00, 1.00]")
    status: Optional[str] = Field(default=None, description="Operational classification ('Healthy', 'Warning', 'Critical')")

    # Simulation metadata
    is_degraded: bool = Field(default=False, description="Whether failure scenario is active for this reading")
    degradation_pct: float = Field(default=0.0, description="Percentage of degradation injected (0.0 to 100.0%)")

    @field_validator("kw", "rpm", "temp_c", "vib_rms", "pressure", mode="before")
    @classmethod
    def round_floats(cls, value: Any) -> float:
        """Round floating point metrics to 2 decimal places for clean telemetry."""
        if isinstance(value, (int, float)):
            return round(float(value), 2)
        return float(value)

    @property
    def bearing_temp(self) -> float:
        """Alias for database compatibility (bearing_temp)."""
        return self.temp_c

    @property
    def vibration_rms(self) -> float:
        """Alias for database compatibility (vibration_rms)."""
        return self.vib_rms

    def to_backend_payload(self) -> dict[str, Any]:
        """Convert to JSON-serializable dictionary tailored for backend /api/v1/telemetry endpoint."""
        return {
            "asset_id": self.asset_id,
            "timestamp": self.timestamp,
            "kw": self.kw,
            "rpm": self.rpm,
            "temp_c": self.temp_c,
            "bearing_temp": self.temp_c,
            "vib_rms": self.vib_rms,
            "vibration_rms": self.vib_rms,
            "pressure": self.pressure,
            "predicted_kw": self.predicted_kw,
            "waste_gap_kw": self.waste_gap_kw,
            "waste_pct": self.waste_pct,
            "anomaly_score": self.anomaly_score,
            "status": self.status,
            "is_degraded": self.is_degraded,
            "degradation_pct": self.degradation_pct,
        }


class TelemetryBatch(BaseModel):
    """Container for batch transmissions of multiple assets' sensor readings."""

    batch_timestamp: str = Field(default_factory=lambda: datetime.now().astimezone().isoformat())
    readings: list[TelemetryPayload] = Field(default_factory=list)

    def to_backend_payload(self) -> list[dict[str, Any]]:
        return [reading.to_backend_payload() for reading in self.readings]

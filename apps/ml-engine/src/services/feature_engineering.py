"""Real-time Feature Engineering Service for Industrial Sensor Telemetry.

Provides sliding window statistical aggregations per asset (rolling mean, rolling std,
peak-to-peak amplitude) and physical domain indicators (Energy-to-Throughput ratio).
"""

from collections import deque
from dataclasses import dataclass, asdict
from datetime import datetime
import logging
from typing import Any, Optional, Union
import numpy as np
import pandas as pd

from ..models.telemetry import TelemetryPayload

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WindowTelemetryRecord:
    """Lightweight historical snapshot of a single sensor telemetry point."""
    timestamp: str
    kw: float
    rpm: float
    temp_c: float
    vib_rms: float
    pressure: float


@dataclass
class EngineeredFeatures:
    """Output schema for engineered statistical and domain features."""

    asset_id: str
    timestamp: str

    # Raw metrics (latest instant)
    kw: float
    rpm: float
    temp_c: float
    vib_rms: float
    pressure: float

    # Statistical Rolling Metrics for Electrical Power (kW)
    kw_rolling_mean: float
    kw_rolling_std: float
    kw_peak_to_peak: float

    # Statistical Rolling Metrics for Vibration (Vib RMS mm/s)
    vib_rolling_mean: float
    vib_rolling_std: float
    vib_peak_to_peak: float

    # Statistical Rolling Metrics for Temperature (Bearing Temp °C)
    temp_rolling_mean: float
    temp_rolling_std: float
    temp_peak_to_peak: float

    # Physical Domain Feature: Energy-to-Throughput Ratio (kW / RPM)
    energy_to_throughput_ratio: float
    energy_to_throughput_rolling_mean: float

    # Window Metadata
    window_size: int
    window_capacity: int

    def to_dict(self) -> dict[str, Any]:
        """Convert engineered features to dictionary."""
        return asdict(self)

    def to_pandas_row(self) -> pd.DataFrame:
        """Convert single feature set into a 1-row Pandas DataFrame for ML pipelines."""
        return pd.DataFrame([self.to_dict()])

    def to_ml_feature_vector(self) -> list[float]:
        """Extract purely numerical feature vector suitable for LightGBM / Scikit-Learn inference."""
        return [
            self.kw,
            self.rpm,
            self.temp_c,
            self.vib_rms,
            self.pressure,
            self.kw_rolling_mean,
            self.kw_rolling_std,
            self.kw_peak_to_peak,
            self.vib_rolling_mean,
            self.vib_rolling_std,
            self.vib_peak_to_peak,
            self.temp_rolling_mean,
            self.temp_rolling_std,
            self.temp_peak_to_peak,
            self.energy_to_throughput_ratio,
            self.energy_to_throughput_rolling_mean,
        ]


class FeatureEngineeringService:
    """
    Clean Code Feature Engineering service maintaining an in-memory sliding window
    (collections.deque) per asset_id to compute real-time statistical aggregations.
    """

    def __init__(self, window_size: int = 30):
        """
        Initialize the feature engineering service.

        Args:
            window_size: Maximum number of data points preserved per asset window.
                         At 1 Hz sampling, 30 points corresponds to a 30-second window.
        """
        if window_size < 1:
            raise ValueError("window_size must be at least 1")

        self.window_size = window_size
        self._windows: dict[str, deque[WindowTelemetryRecord]] = {}

    def _get_or_create_window(self, asset_id: str) -> deque[WindowTelemetryRecord]:
        """Retrieve existing sliding window deque or create a new one for asset_id."""
        if asset_id not in self._windows:
            self._windows[asset_id] = deque(maxlen=self.window_size)
        return self._windows[asset_id]

    def reset_window(self, asset_id: Optional[str] = None) -> None:
        """
        Clear sliding window history for a specific asset or all assets.

        Args:
            asset_id: If provided, clears only this asset's window. If None, clears all windows.
        """
        if asset_id is not None:
            if asset_id in self._windows:
                self._windows[asset_id].clear()
                logger.info("Cleared sliding window for asset %s", asset_id)
        else:
            self._windows.clear()
            logger.info("Cleared sliding windows for all assets")

    def get_window_dataframe(self, asset_id: str) -> pd.DataFrame:
        """Export current sliding window history for asset_id as a Pandas DataFrame."""
        window = self._get_or_create_window(asset_id)
        if not window:
            return pd.DataFrame(columns=["timestamp", "kw", "rpm", "temp_c", "vib_rms", "pressure"])
        return pd.DataFrame([asdict(record) for record in window])

    def process_reading(
        self,
        reading: Union[TelemetryPayload, dict[str, Any]]
    ) -> EngineeredFeatures:
        """
        Ingest a raw sensor telemetry reading, append to the asset's sliding window,
        and calculate real-time statistical & domain features.

        Args:
            reading: TelemetryPayload instance or dictionary containing raw metrics.

        Returns:
            EngineeredFeatures object containing calculated features.
        """
        # 1. Normalize input reading
        if isinstance(reading, TelemetryPayload):
            asset_id = reading.asset_id
            timestamp = reading.timestamp
            kw = float(reading.kw)
            rpm = float(reading.rpm)
            temp_c = float(reading.temp_c)
            vib_rms = float(reading.vib_rms)
            pressure = float(reading.pressure)
        elif isinstance(reading, dict):
            asset_id = str(reading["asset_id"])
            timestamp = str(reading.get("timestamp", datetime.now().astimezone().isoformat()))
            kw = float(reading["kw"])
            rpm = float(reading["rpm"])
            temp_c = float(reading.get("temp_c", reading.get("bearing_temp", 0.0)))
            vib_rms = float(reading.get("vib_rms", reading.get("vibration_rms", 0.0)))
            pressure = float(reading.get("pressure", 0.0))
        else:
            raise TypeError(f"Unsupported reading type: {type(reading)}")

        # 2. Append latest snapshot to asset's sliding window
        window = self._get_or_create_window(asset_id)
        record = WindowTelemetryRecord(
            timestamp=timestamp,
            kw=kw,
            rpm=rpm,
            temp_c=temp_c,
            vib_rms=vib_rms,
            pressure=pressure,
        )
        window.append(record)

        current_n = len(window)

        # 3. Extract numpy arrays for vectorized calculations
        kw_series = np.fromiter((r.kw for r in window), dtype=np.float64, count=current_n)
        vib_series = np.fromiter((r.vib_rms for r in window), dtype=np.float64, count=current_n)
        temp_series = np.fromiter((r.temp_c for r in window), dtype=np.float64, count=current_n)
        rpm_series = np.fromiter((r.rpm for r in window), dtype=np.float64, count=current_n)

        # 4. Compute Statistical Metrics: Rolling Mean, Std, Peak-to-Peak (max - min)
        # Electrical Power (kW)
        kw_mean = float(np.mean(kw_series))
        kw_std = float(np.std(kw_series, ddof=1)) if current_n > 1 else 0.0
        kw_p2p = float(np.ptp(kw_series))

        # Vibration RMS (mm/s)
        vib_mean = float(np.mean(vib_series))
        vib_std = float(np.std(vib_series, ddof=1)) if current_n > 1 else 0.0
        vib_p2p = float(np.ptp(vib_series))

        # Bearing Temperature (°C)
        temp_mean = float(np.mean(temp_series))
        temp_std = float(np.std(temp_series, ddof=1)) if current_n > 1 else 0.0
        temp_p2p = float(np.ptp(temp_series))

        # 5. Compute Physical Domain Feature: Energy-to-Throughput Ratio (kW / RPM)
        # Safe zero-division handling when RPM is zero or idle
        if rpm > 1e-4:
            instant_energy_ratio = kw / rpm
        else:
            instant_energy_ratio = 0.0

        # Rolling Energy-to-Throughput Ratio
        valid_rpm_mask = rpm_series > 1e-4
        if np.any(valid_rpm_mask):
            rolling_energy_ratios = kw_series[valid_rpm_mask] / rpm_series[valid_rpm_mask]
            energy_ratio_mean = float(np.mean(rolling_energy_ratios))
        else:
            energy_ratio_mean = 0.0

        # 6. Assemble and return clean output dataclass
        return EngineeredFeatures(
            asset_id=asset_id,
            timestamp=timestamp,
            kw=round(kw, 2),
            rpm=round(rpm, 1),
            temp_c=round(temp_c, 2),
            vib_rms=round(vib_rms, 2),
            pressure=round(pressure, 2),
            kw_rolling_mean=round(kw_mean, 3),
            kw_rolling_std=round(kw_std, 4),
            kw_peak_to_peak=round(kw_p2p, 3),
            vib_rolling_mean=round(vib_mean, 3),
            vib_rolling_std=round(vib_std, 4),
            vib_peak_to_peak=round(vib_p2p, 3),
            temp_rolling_mean=round(temp_mean, 3),
            temp_rolling_std=round(temp_std, 4),
            temp_peak_to_peak=round(temp_p2p, 3),
            energy_to_throughput_ratio=round(instant_energy_ratio, 6),
            energy_to_throughput_rolling_mean=round(energy_ratio_mean, 6),
            window_size=current_n,
            window_capacity=self.window_size,
        )

    def process_batch(
        self,
        readings: list[Union[TelemetryPayload, dict[str, Any]]]
    ) -> list[EngineeredFeatures]:
        """Process a list/batch of readings across one or multiple assets."""
        return [self.process_reading(r) for r in readings]

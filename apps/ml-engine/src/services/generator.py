"""Industrial sensor telemetry generator with failure scenario state management."""

from datetime import datetime
import logging
from typing import Optional
import numpy as np

from ..config import AppConfig, AssetBaseProfile, FailureScenarioConfig, config as default_config
from ..models.telemetry import TelemetryPayload

logger = logging.getLogger(__name__)


class FailureScenarioStateManager:
    """Clean state manager that progressively injects mechanical bearing degradation into target asset."""

    def __init__(self, failure_config: FailureScenarioConfig):
        self.enabled = failure_config.enabled
        self.target_asset_id = failure_config.target_asset_id
        self.total_steps = max(1, failure_config.total_steps)
        self.vib_start = failure_config.vib_start_rms
        self.vib_target = failure_config.vib_target_rms
        self.temp_increase = failure_config.temp_increase_c
        self.power_surge_multiplier = failure_config.power_surge_multiplier

        self.current_step: int = 0
        self._is_active: bool = self.enabled

    @property
    def progress(self) -> float:
        """Current progression fraction from 0.0 (baseline) to 1.0 (fully degraded)."""
        if not self._is_active or self.total_steps == 0:
            return 0.0
        return min(1.0, max(0.0, self.current_step / self.total_steps))

    @property
    def progress_pct(self) -> float:
        """Progress represented as percentage (0.0% to 100.0%)."""
        return round(self.progress * 100.0, 1)

    @property
    def status_description(self) -> str:
        """Human-readable status of the failure scenario."""
        if not self._is_active:
            return "DISABLED"
        if self.current_step == 0:
            return "STANDBY (Baseline)"
        if self.progress >= 1.0:
            return "PEAK DEGRADATION (Critical)"
        return f"PROGRESSIVE WEAR ({self.progress_pct}%)"

    def step(self) -> None:
        """Advance the degradation progression by one time step."""
        if self._is_active and self.current_step < self.total_steps:
            self.current_step += 1

    def reset(self) -> None:
        """Reset degradation back to healthy baseline."""
        self.current_step = 0
        logger.info("Failure scenario reset to baseline for %s", self.target_asset_id)

    def set_enabled(self, enabled: bool) -> None:
        """Enable or disable the failure scenario."""
        self._is_active = enabled
        logger.info("Failure scenario state changed: enabled=%s", enabled)

    def calculate_degradation(self, asset_id: str) -> tuple[float, float, float, bool]:
        """
        Calculate injection deltas for a specific asset.

        Returns:
            (vibration_delta_rms, temp_delta_c, kw_multiplier, is_degraded)
        """
        if not self._is_active or asset_id != self.target_asset_id or self.current_step == 0:
            return 0.0, 0.0, 1.0, False

        alpha = self.progress

        # Progressive vibration increase from 1.8 mm/s towards 7.8 mm/s (+6.0 mm/s delta)
        vib_delta = (self.vib_target - self.vib_start) * alpha

        # Progressive temperature increase (+18°C)
        temp_delta = self.temp_increase * alpha

        # Progressive electrical power surge (+34% kW)
        kw_mult = 1.0 + (self.power_surge_multiplier * alpha)

        return vib_delta, temp_delta, kw_mult, True


class TelemetryGenerator:
    """Generates realistic physical sensor telemetry with Gaussian noise and stateful failure injection."""

    def __init__(self, app_config: Optional[AppConfig] = None):
        self.config = app_config or default_config
        self.profiles: dict[str, AssetBaseProfile] = self.config.asset_profiles
        self.failure_state = FailureScenarioStateManager(self.config.failure_scenario)

    def generate_single_reading(
        self,
        asset_id: str,
        timestamp_str: Optional[str] = None
    ) -> TelemetryPayload:
        """Generate a realistic telemetry reading for a single asset."""
        profile = self.profiles.get(asset_id)
        if not profile:
            raise ValueError(f"Unknown asset ID: {asset_id}")

        ts = timestamp_str or datetime.now().astimezone().isoformat()

        # Retrieve degradation deltas if failure scenario applies
        vib_delta, temp_delta, kw_multiplier, is_degraded = self.failure_state.calculate_degradation(asset_id)

        # Baseline values
        base_kw = profile.base_kw * kw_multiplier
        base_rpm = profile.base_rpm
        base_temp = profile.base_temp_c + temp_delta
        base_vib = profile.base_vib_rms + vib_delta
        base_pressure = profile.base_pressure

        # In severe mechanical wear, slight RPM slip / speed drop occurs due to bearing friction
        if is_degraded:
            rpm_slip = 25.0 * self.failure_state.progress
            base_rpm = max(100.0, base_rpm - rpm_slip)

        # Apply realistic Gaussian noise
        kw_noise = float(np.random.normal(0, 0.45))
        rpm_noise = float(np.random.normal(0, 1.8))
        temp_noise = float(np.random.normal(0, 0.25))
        vib_noise = float(np.random.normal(0, 0.06))
        pressure_noise = float(np.random.normal(0, 0.04)) if base_pressure > 0 else 0.0

        # Compute final physical values with realistic clamping
        final_kw = max(0.0, base_kw + kw_noise)
        final_rpm = max(0.0, base_rpm + rpm_noise)
        final_temp = max(15.0, base_temp + temp_noise)
        final_vib = max(0.1, base_vib + vib_noise)
        final_pressure = max(0.0, base_pressure + pressure_noise)

        return TelemetryPayload(
            asset_id=asset_id,
            timestamp=ts,
            kw=final_kw,
            rpm=final_rpm,
            temp_c=final_temp,
            vib_rms=final_vib,
            pressure=final_pressure,
            is_degraded=is_degraded,
            degradation_pct=self.failure_state.progress_pct if is_degraded else 0.0,
        )

    def generate_cycle(self, advance_failure_step: bool = True) -> list[TelemetryPayload]:
        """
        Generate a complete 1 Hz cycle of telemetry readings for all 5 assets.

        Args:
            advance_failure_step: If True, steps the failure scenario state manager forward.
        """
        now_str = datetime.now().astimezone().isoformat()
        cycle_readings: list[TelemetryPayload] = []

        for asset_id in self.profiles.keys():
            reading = self.generate_single_reading(asset_id, timestamp_str=now_str)
            cycle_readings.append(reading)

        if advance_failure_step:
            self.failure_state.step()

        return cycle_readings

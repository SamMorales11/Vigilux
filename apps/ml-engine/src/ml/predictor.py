"""Real-time Machine Learning Inference Service for Vigilux Industrial Predictive Maintenance.

Loads trained LightGBM Regressor, IsolationForest, and StandardScaler from artifacts/
at startup to deliver low-latency (< 15 ms) inference for:
- predicted_kw: baseline active power estimation based on RPM, pressure, and temperature.
- waste_gap_kw: positive energy discrepancy (actual kW - predicted kW).
- waste_pct: percentage of active power wasted relative to baseline.
- anomaly_score: smoothly normalized probability score in [0.00, 1.00].
- status: operational state ('Healthy' < 0.65, 'Warning' 0.65–0.80, 'Critical' > 0.80).
"""

from dataclasses import dataclass, asdict
import logging
from pathlib import Path
import sys
import time
from typing import Any, Optional

import joblib
import numpy as np
import pandas as pd

# Support execution both directly and as package module
if __package__ is None or __package__ == "":
    project_root = Path(__file__).resolve().parent.parent.parent
    sys.path.insert(0, str(project_root))
    from src.config import AppConfig, config as default_config
    from src.models.telemetry import TelemetryPayload
    from src.services.feature_engineering import EngineeredFeatures
else:
    from ..config import AppConfig, config as default_config
    from ..models.telemetry import TelemetryPayload
    from ..services.feature_engineering import EngineeredFeatures

logger = logging.getLogger("RealTimePredictor")


@dataclass
class PredictionResult:
    """Output container for real-time ML inference results."""

    asset_id: str
    predicted_kw: float
    waste_gap_kw: float
    waste_pct: float
    anomaly_score: float
    status: str  # 'Healthy', 'Warning', 'Critical'
    inference_time_ms: float

    def to_dict(self) -> dict[str, Any]:
        """Convert prediction result to dictionary."""
        return asdict(self)


class RealTimePredictor:
    """
    High-performance real-time ML inference service.
    Loads models once at startup and performs batch predictions with sub-15 ms latency.
    """

    def __init__(
        self,
        artifacts_dir: Optional[Path] = None,
        app_config: Optional[AppConfig] = None
    ):
        self.config = app_config or default_config
        self.artifacts_dir = artifacts_dir or (
            Path(__file__).resolve().parent.parent.parent / "artifacts"
        )

        self.asset_rated_kw_map = {
            k: v.rated_kw for k, v in self.config.asset_profiles.items()
        }
        self.asset_code_map = {
            name: idx for idx, name in enumerate(self.config.asset_profiles.keys())
        }

        # Model containers
        self.isolation_forest = None
        self.lgbm_regressor = None
        self.scaler = None
        self.metadata = None

        self._load_artifacts()

    def _load_artifacts(self) -> None:
        """Load trained models, preprocessor scaler, and metadata from artifacts directory."""
        iso_path = self.artifacts_dir / "isolation_forest.joblib"
        lgbm_path = self.artifacts_dir / "lightgbm_baseline.joblib"
        scaler_path = self.artifacts_dir / "scaler.joblib"
        meta_path = self.artifacts_dir / "metadata.joblib"

        required_files = [iso_path, lgbm_path, scaler_path, meta_path]
        missing = [str(f) for f in required_files if not f.is_file()]
        if missing:
            raise FileNotFoundError(
                f"Missing ML model artifact(s): {', '.join(missing)}. "
                "Please run 'python apps/ml-engine/src/ml/trainer.py' first."
            )

        start_load = time.perf_counter()
        self.isolation_forest = joblib.load(iso_path)
        self.lgbm_regressor = joblib.load(lgbm_path)
        self.scaler = joblib.load(scaler_path)
        self.metadata = joblib.load(meta_path)
        elapsed = (time.perf_counter() - start_load) * 1000.0

        self.regressor_features = self.metadata["regressor_features"]
        self.anomaly_features = self.metadata["anomaly_features"]

        # Warmup C++ OpenMP runtime and threadpool during startup for sub-15 ms latency
        self._warmup()

        logger.info(
            "ML model artifacts loaded successfully in %.2f ms from %s",
            elapsed,
            self.artifacts_dir,
        )

    def _warmup(self) -> None:
        """Execute one dummy prediction to warm up LightGBM and Scikit-Learn C-extensions."""
        try:
            dummy_reg = pd.DataFrame([{col: 50.0 for col in self.regressor_features}])
            dummy_anom = pd.DataFrame([{col: 50.0 for col in self.anomaly_features}])
            self.lgbm_regressor.predict(dummy_reg)
            scaled = self.scaler.transform(dummy_anom)
            self.isolation_forest.decision_function(scaled)
        except Exception as e:
            logger.debug("Model warmup skipped: %s", e)

    def _normalize_iso_score(self, decision_func_val: float) -> float:
        """
        Smoothly normalize raw IsolationForest decision_function value into [0.00, 1.00].
        In scikit-learn, decision_function > 0 indicates normal/inliers,
        while negative values indicate increasing anomaly severity.
        """
        k = 22.0
        x = -decision_func_val
        score = 1.0 / (1.0 + np.exp(-k * (x - 0.040)))
        return float(np.clip(score, 0.0, 1.0))

    def _classify_status(self, anomaly_score: float) -> str:
        """
        Categorize machine operational health state:
        - 'Healthy'  if score < 0.65
        - 'Warning'  if 0.65 <= score <= 0.80
        - 'Critical' if score > 0.80
        """
        if anomaly_score < 0.65:
            return "Healthy"
        elif anomaly_score <= 0.80:
            return "Warning"
        else:
            return "Critical"

    def predict_single(
        self,
        reading: TelemetryPayload,
        features: EngineeredFeatures
    ) -> PredictionResult:
        """
        Execute real-time ML inference for a single telemetry reading.

        Overhead target: < 15 ms.
        """
        results = self.predict_batch([reading], [features])
        return results[0]

    def predict_batch(
        self,
        readings: list[TelemetryPayload],
        features: list[EngineeredFeatures]
    ) -> list[PredictionResult]:
        """
        Execute vectorized real-time ML inference for a batch of industrial assets.

        Overhead target: < 15 ms total for all assets combined.
        """
        t0 = time.perf_counter()

        if len(readings) != len(features):
            raise ValueError(
                f"Mismatch: {len(readings)} readings vs {len(features)} feature sets"
            )

        n = len(readings)
        if n == 0:
            return []

        # 1. Prepare Regressor input matrix (predicted_kw)
        # Use nominal operating parameters (base_rpm, base_pressure, base_temp_c)
        # so that the baseline power prediction represents true healthy operational baseline,
        # completely unaffected by friction-induced thermal spikes or bearing wear.
        reg_rows: list[dict[str, Any]] = []
        for r in readings:
            profile = self.config.asset_profiles.get(r.asset_id)
            nom_temp = profile.base_temp_c if profile else 55.0
            nom_rpm = profile.base_rpm if profile else r.rpm
            nom_pressure = profile.base_pressure if profile else r.pressure

            reg_rows.append({
                "rpm": nom_rpm,
                "pressure": nom_pressure,
                "temp_c": nom_temp,
                "temp_rolling_mean": nom_temp,
                "rated_kw": self.asset_rated_kw_map.get(r.asset_id, 75.0),
                "asset_code": self.asset_code_map.get(r.asset_id, 0),
            })
        df_reg = pd.DataFrame(reg_rows)[self.regressor_features]

        # 2. Prepare Anomaly Detection input matrix (scaled multi-sensor signals)
        anom_rows: list[dict[str, Any]] = []
        for r, feat in zip(readings, features):
            anom_rows.append({
                "kw": r.kw,
                "rpm": r.rpm,
                "temp_c": r.temp_c,
                "vib_rms": r.vib_rms,
                "pressure": r.pressure,
                "kw_rolling_mean": feat.kw_rolling_mean,
                "kw_rolling_std": feat.kw_rolling_std,
                "kw_peak_to_peak": feat.kw_peak_to_peak,
                "vib_rolling_mean": feat.vib_rolling_mean,
                "vib_rolling_std": feat.vib_rolling_std,
                "vib_peak_to_peak": feat.vib_peak_to_peak,
                "temp_rolling_mean": feat.temp_rolling_mean,
                "temp_rolling_std": feat.temp_rolling_std,
                "temp_peak_to_peak": feat.temp_peak_to_peak,
                "energy_to_throughput_ratio": feat.energy_to_throughput_ratio,
            })
        df_anom = pd.DataFrame(anom_rows)[self.anomaly_features]

        # 3. Vectorized model inference
        predicted_kws = self.lgbm_regressor.predict(df_reg)
        scaled_anom = self.scaler.transform(df_anom)
        decision_funcs = self.isolation_forest.decision_function(scaled_anom)

        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        # 4. Construct PredictionResult objects with calibrated anomaly score
        results: list[PredictionResult] = []
        for i, (r, pred_raw, dec_raw) in enumerate(zip(readings, predicted_kws, decision_funcs)):
            pred_kw = max(0.0, round(float(pred_raw), 2))
            actual_kw = float(r.kw)

            # waste_gap_kw: positive energy discrepancy (actual kW - predicted kW)
            waste_gap_kw = max(0.0, round(actual_kw - pred_kw, 2))

            # waste_pct: percentage of energy wasted relative to predicted baseline
            if pred_kw > 0.0:
                waste_pct = round((waste_gap_kw / pred_kw) * 100.0, 2)
            else:
                waste_pct = 0.0

            # Statistical anomaly score from Isolation Forest
            iso_score = self._normalize_iso_score(dec_raw)

            # Domain physical indicators
            profile = self.config.asset_profiles.get(r.asset_id)
            iso_limit = profile.iso_vibration_limit if profile else 4.5
            base_vib = profile.base_vib_rms if profile else 1.8

            # Vibration wear severity relative to ISO limits
            vib_severity = max(0.0, min(1.0, (float(r.vib_rms) - base_vib) / max(0.5, (iso_limit - base_vib))))

            # Energy waste severity relative to expected maximum surge (+28-34%)
            waste_severity = max(0.0, min(1.0, waste_pct / 28.0))

            # Multi-signal fused anomaly score [0.00, 1.00]
            composite_score = 0.35 * iso_score + 0.40 * vib_severity + 0.25 * waste_severity
            if vib_severity >= 1.0 or float(r.vib_rms) >= iso_limit:
                composite_score = max(composite_score, 0.82 + 0.15 * min(1.0, (float(r.vib_rms) - iso_limit) / 2.5))
            anomaly_score = round(float(np.clip(composite_score, 0.0, 1.0)), 3)

            # Status classification: Healthy (< 0.65), Warning (0.65–0.80), Critical (> 0.80)
            status = self._classify_status(anomaly_score)

            result = PredictionResult(
                asset_id=r.asset_id,
                predicted_kw=pred_kw,
                waste_gap_kw=waste_gap_kw,
                waste_pct=waste_pct,
                anomaly_score=anomaly_score,
                status=status,
                inference_time_ms=round(elapsed_ms / n, 2),
            )
            results.append(result)

        return results

"""Machine Learning Training Pipeline for Vigilux Industrial Predictive Maintenance.

Trains two models:
1. IsolationForest: Unsupervised anomaly detection on scaled multi-sensor features.
2. LGBMRegressor: Baseline active power (predicted_kw) estimation based on RPM, pressure, and temperature.
Saves model artifacts and scaler to apps/ml-engine/artifacts/.
"""

import argparse
from datetime import datetime, timedelta
import logging
import os
from pathlib import Path
import sys
from typing import Any, Tuple

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# Support execution both directly and as package module
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

if __package__ is None or __package__ == "":
    project_root = Path(__file__).resolve().parent.parent.parent
    sys.path.insert(0, str(project_root))
    from src.config import AppConfig, AssetBaseProfile, config as default_config
    from src.models.telemetry import TelemetryPayload
    from src.services.feature_engineering import FeatureEngineeringService
else:
    from ..config import AppConfig, AssetBaseProfile, config as default_config
    from ..models.telemetry import TelemetryPayload
    from ..services.feature_engineering import FeatureEngineeringService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("MLTrainer")


class OperationalDatasetGenerator:
    """Generates realistic continuous time-series operational dataset for industrial assets."""

    def __init__(self, app_config: AppConfig | None = None):
        self.config = app_config or default_config
        self.profiles: dict[str, AssetBaseProfile] = self.config.asset_profiles

    def generate_asset_history(
        self,
        asset_id: str,
        n_samples: int = 1200,
        start_time: datetime | None = None
    ) -> list[TelemetryPayload]:
        """
        Generate continuous realistic operational telemetry sequence for an asset.
        Includes diurnal load curves, thermal inertia, slip physics, and small anomaly injection.
        """
        profile = self.profiles[asset_id]
        current_ts = start_time or (datetime.now() - timedelta(seconds=n_samples))

        readings: list[TelemetryPayload] = []

        # State tracking for continuous smooth time-series
        current_temp = profile.base_temp_c
        current_load_factor = 0.85

        for i in range(n_samples):
            current_ts += timedelta(seconds=1)

            # Smooth random walk in operational demand load factor (65% to 98% rated capacity)
            load_delta = np.random.normal(0, 0.005)
            current_load_factor = np.clip(current_load_factor + load_delta, 0.65, 0.98)

            # Target active power (kW) governed by operational load
            target_kw = profile.rated_kw * current_load_factor

            # Motor slip: induction motor RPM slightly drops as load increases
            slip_rpm = (target_kw / profile.rated_kw) * 18.0
            base_rpm = profile.base_rpm - slip_rpm

            # Pressure correlates with speed squared for pumps/compressors
            if profile.base_pressure > 0:
                speed_ratio = base_rpm / profile.base_rpm
                base_pressure = profile.base_pressure * (speed_ratio ** 1.8)
            else:
                base_pressure = 0.0

            # Thermal inertia: temperature slowly converges towards equilibrium based on power
            temp_equilibrium = profile.base_temp_c + (target_kw / profile.rated_kw) * 12.0
            current_temp += 0.03 * (temp_equilibrium - current_temp)

            # Vibration correlates with rotational speed and load
            base_vib = profile.base_vib_rms * (0.85 + 0.25 * current_load_factor)

            # Inject small intermittent anomaly (3% probability after warmup)
            is_anomaly = i > 100 and np.random.rand() < 0.03
            if is_anomaly:
                target_kw *= np.random.uniform(1.15, 1.30)  # Power surge
                base_vib *= np.random.uniform(2.0, 3.5)     # Vibration spike
                current_temp += np.random.uniform(3.0, 7.0) # Thermal surge

            # Apply realistic measurement Gaussian sensor noise
            kw_val = float(np.clip(target_kw + np.random.normal(0, 0.4), 0.0, profile.rated_kw * 1.5))
            rpm_val = float(np.clip(base_rpm + np.random.normal(0, 1.5), 0.0, profile.base_rpm * 1.1))
            temp_val = float(np.clip(current_temp + np.random.normal(0, 0.2), 15.0, 120.0))
            vib_val = float(np.clip(base_vib + np.random.normal(0, 0.05), 0.1, 15.0))
            pressure_val = float(np.clip(base_pressure + np.random.normal(0, 0.04), 0.0, 20.0)) if base_pressure > 0 else 0.0

            reading = TelemetryPayload(
                asset_id=asset_id,
                timestamp=current_ts.astimezone().isoformat(),
                kw=round(kw_val, 2),
                rpm=round(rpm_val, 1),
                temp_c=round(temp_val, 2),
                vib_rms=round(vib_val, 2),
                pressure=round(pressure_val, 2),
                is_degraded=is_anomaly,
                degradation_pct=100.0 if is_anomaly else 0.0,
            )
            readings.append(reading)

        return readings

    def generate_full_dataset(self, samples_per_asset: int = 1200) -> list[TelemetryPayload]:
        """Generate historical operational telemetry across all 5 industrial assets."""
        all_readings: list[TelemetryPayload] = []
        for asset_id in self.profiles.keys():
            logger.info("Generating %d operational historical records for %s...", samples_per_asset, asset_id)
            readings = self.generate_asset_history(asset_id, n_samples=samples_per_asset)
            all_readings.extend(readings)

        return all_readings


class ModelTrainer:
    """Manages feature engineering extraction, model training, and artifact persistence."""

    def __init__(self, artifacts_dir: Path | None = None, app_config: AppConfig | None = None):
        self.config = app_config or default_config
        self.artifacts_dir = artifacts_dir or (Path(__file__).resolve().parent.parent.parent / "artifacts")
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)

        self.feature_service = FeatureEngineeringService(window_size=30)
        self.dataset_generator = OperationalDatasetGenerator(self.config)

        # Trained model instances
        self.scaler: StandardScaler | None = None
        self.isolation_forest: IsolationForest | None = None
        self.lgbm_regressor: lgb.LGBMRegressor | None = None

        # Feature column definitions
        self.regressor_features = [
            "rpm",
            "pressure",
            "temp_c",
            "temp_rolling_mean",
            "rated_kw",
            "asset_code",
        ]

        self.anomaly_features = [
            "kw",
            "rpm",
            "temp_c",
            "vib_rms",
            "pressure",
            "kw_rolling_mean",
            "kw_rolling_std",
            "kw_peak_to_peak",
            "vib_rolling_mean",
            "vib_rolling_std",
            "vib_peak_to_peak",
            "temp_rolling_mean",
            "temp_rolling_std",
            "temp_peak_to_peak",
            "energy_to_throughput_ratio",
        ]

    def build_feature_dataframe(self, readings: list[TelemetryPayload]) -> pd.DataFrame:
        """Apply FeatureEngineeringService sliding window transformations across historical dataset."""
        logger.info("Transforming %d raw sensor readings into engineered features...", len(readings))

        # Reset sliding window state to ensure deterministic start
        self.feature_service.reset_window()

        engineered_list = []
        asset_rated_kw_map = {k: v.rated_kw for k, v in self.config.asset_profiles.items()}
        asset_code_map = {name: idx for idx, name in enumerate(self.config.asset_profiles.keys())}

        for r in readings:
            feat = self.feature_service.process_reading(r)
            feat_dict = feat.to_dict()
            feat_dict["rated_kw"] = asset_rated_kw_map.get(r.asset_id, 75.0)
            feat_dict["asset_code"] = asset_code_map.get(r.asset_id, 0)
            feat_dict["is_anomaly"] = r.is_degraded
            engineered_list.append(feat_dict)

        df = pd.DataFrame(engineered_list)
        logger.info("Engineered feature DataFrame created: shape %s", df.shape)
        return df

    def train_baseline_regressor(self, df: pd.DataFrame) -> Tuple[lgb.LGBMRegressor, dict[str, float]]:
        """
        Train LGBMRegressor to predict expected baseline power (predicted_kw)
        from RPM, pressure, and temperature.
        """
        logger.info("Training LightGBM Regressor for baseline active power (predicted_kw)...")

        # Train on non-anomalous baseline operational data
        baseline_df = df[~df["is_anomaly"]].copy() if "is_anomaly" in df.columns else df.copy()

        X = baseline_df[self.regressor_features]
        y = baseline_df["kw"]

        X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42)

        regressor = lgb.LGBMRegressor(
            n_estimators=150,
            learning_rate=0.05,
            num_leaves=31,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            verbose=-1,
        )
        regressor.fit(X_train, y_train)

        # Evaluate performance on validation split
        y_pred = regressor.predict(X_val)
        rmse = float(np.sqrt(mean_squared_error(y_val, y_pred)))
        mae = float(mean_absolute_error(y_val, y_pred))
        r2 = float(r2_score(y_val, y_pred))

        metrics = {"rmse": round(rmse, 4), "mae": round(mae, 4), "r2_score": round(r2, 4)}
        logger.info("LGBMRegressor Validation Results: R² = %.4f | RMSE = %.4f kW | MAE = %.4f kW", r2, rmse, mae)

        self.lgbm_regressor = regressor
        return regressor, metrics

    def train_isolation_forest(self, df: pd.DataFrame) -> Tuple[IsolationForest, StandardScaler]:
        """
        Train IsolationForest for unsupervised anomaly detection on scaled multi-sensor features.
        """
        logger.info("Training IsolationForest for unsupervised anomaly detection...")

        X = df[self.anomaly_features].copy()

        # Fit StandardScaler
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # Fit IsolationForest with expected contamination rate
        iso_forest = IsolationForest(
            n_estimators=100,
            contamination=0.035,
            max_samples="auto",
            random_state=42,
            n_jobs=-1,
        )
        iso_forest.fit(X_scaled)

        # Inspect anomaly predictions on dataset
        predictions = iso_forest.predict(X_scaled)
        anomaly_count = int(np.sum(predictions == -1))
        logger.info("IsolationForest detected %d / %d samples as anomalies (%.2f%%)",
                    anomaly_count, len(df), (anomaly_count / len(df)) * 100)

        self.scaler = scaler
        self.isolation_forest = iso_forest
        return iso_forest, scaler

    def save_artifacts(self, regressor_metrics: dict[str, float]) -> dict[str, Path]:
        """Save trained models, scaler, and metadata into artifacts directory."""
        logger.info("Saving trained artifacts to %s...", self.artifacts_dir)

        if self.isolation_forest is None or self.lgbm_regressor is None or self.scaler is None:
            raise RuntimeError("Models have not been trained yet.")

        iso_path = self.artifacts_dir / "isolation_forest.joblib"
        lgbm_path = self.artifacts_dir / "lightgbm_baseline.joblib"
        scaler_path = self.artifacts_dir / "scaler.joblib"
        meta_path = self.artifacts_dir / "metadata.joblib"

        # 1. Save Isolation Forest
        joblib.dump(self.isolation_forest, iso_path)
        logger.info("Saved: %s", iso_path.name)

        # 2. Save LightGBM Regressor
        joblib.dump(self.lgbm_regressor, lgbm_path)
        logger.info("Saved: %s", lgbm_path.name)

        # 3. Save Scaler
        joblib.dump(self.scaler, scaler_path)
        logger.info("Saved: %s", scaler_path.name)

        # 4. Save metadata dictionary for inference reference
        metadata = {
            "created_at": datetime.now().astimezone().isoformat(),
            "regressor_features": self.regressor_features,
            "anomaly_features": self.anomaly_features,
            "regressor_metrics": regressor_metrics,
            "assets": list(self.config.asset_profiles.keys()),
        }
        joblib.dump(metadata, meta_path)
        logger.info("Saved: %s", meta_path.name)

        return {
            "isolation_forest": iso_path,
            "lightgbm_baseline": lgbm_path,
            "scaler": scaler_path,
            "metadata": meta_path,
        }


def run_training_pipeline(samples_per_asset: int = 1200) -> dict[str, Any]:
    """Execute end-to-end dataset generation, feature transformation, training, and artifact persistence."""
    print("\n" + "=" * 76)
    print("[*] VIGILUX MACHINE LEARNING MODEL TRAINING PIPELINE")
    print("=" * 76)

    trainer = ModelTrainer()

    # Step 1: Generate historical dataset
    raw_readings = trainer.dataset_generator.generate_full_dataset(samples_per_asset=samples_per_asset)

    # Step 2: Extract statistical and sliding window features
    features_df = trainer.build_feature_dataframe(raw_readings)

    # Step 3: Train LightGBM Baseline Regressor
    regressor, metrics = trainer.train_baseline_regressor(features_df)

    # Step 4: Train IsolationForest & Scaler
    iso_forest, scaler = trainer.train_isolation_forest(features_df)

    # Step 5: Save artifacts using joblib
    saved_paths = trainer.save_artifacts(metrics)

    print("\n" + "=" * 76)
    print("[+] MODEL TRAINING COMPLETED SUCCESSFULLY!")
    print("=" * 76)
    print(f"[-] Artifacts Directory : {trainer.artifacts_dir}")
    print(f"[-] Isolation Forest    : {saved_paths['isolation_forest'].name} ({os.path.getsize(saved_paths['isolation_forest'])/1024:.1f} KB)")
    print(f"[-] LightGBM Baseline   : {saved_paths['lightgbm_baseline'].name} ({os.path.getsize(saved_paths['lightgbm_baseline'])/1024:.1f} KB)")
    print(f"[-] Feature Scaler      : {saved_paths['scaler'].name} ({os.path.getsize(saved_paths['scaler'])/1024:.1f} KB)")
    print(f"[-] Regressor Metrics   : R2 = {metrics['r2_score']} | RMSE = {metrics['rmse']} kW | MAE = {metrics['mae']} kW")
    print("=" * 76 + "\n")

    return {
        "metrics": metrics,
        "saved_paths": saved_paths,
        "total_samples": len(features_df),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Vigilux Machine Learning Models")
    parser.add_argument("--samples", type=int, default=1200, help="Number of historical samples per asset")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_training_pipeline(samples_per_asset=args.samples)


if __name__ == "__main__":
    main()

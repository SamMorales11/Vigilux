"""Main application entry point for the Vigilux ML Engine Industrial Telemetry Simulator and Real-time Inference."""

import argparse
import logging
import os
import signal
import sys
import time
from datetime import datetime

# Ensure standard output safely supports UTF-8 on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Clean import handling for both `python -m src.main` and `python src/main.py`
if __package__ is None or __package__ == "":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from src.config import AppConfig, config as default_config
    from src.services.client import TelemetryClient
    from src.services.generator import TelemetryGenerator
    from src.services.feature_engineering import FeatureEngineeringService, EngineeredFeatures
    from src.ml.predictor import RealTimePredictor, PredictionResult
else:
    from .config import AppConfig, config as default_config
    from .services.client import TelemetryClient
    from .services.generator import TelemetryGenerator
    from .services.feature_engineering import FeatureEngineeringService, EngineeredFeatures
    from .ml.predictor import RealTimePredictor, PredictionResult

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("VigiluxSimulator")


class TelemetrySimulatorApp:
    """
    Orchestrates 1 Hz industrial sensor telemetry generation, real-time feature engineering,
    machine learning inference (< 15 ms latency), and network transmission.
    """

    def __init__(self, app_config: AppConfig | None = None, window_size: int = 30):
        self.config = app_config or default_config
        self.generator = TelemetryGenerator(self.config)
        self.feature_service = FeatureEngineeringService(window_size=window_size)
        self.predictor = RealTimePredictor(app_config=self.config)
        self.client = TelemetryClient(self.config)
        self._running = False
        self.cycle_count = 0

    def start(self, max_cycles: int | None = None, dry_run: bool = False) -> None:
        """Run the simulation and ML inference loop at 1 Hz frequency."""
        self._running = True
        self._setup_signal_handlers()

        interval = self.config.sampling_interval_seconds
        backend_url = self.config.backend_api_url if not dry_run else "(DRY-RUN / No Network)"

        print("\n" + "=" * 88)
        print("[*] VIGILUX INDUSTRIAL TELEMETRY & REAL-TIME ML INFERENCE ENGINE (1 Hz)")
        print("=" * 88)
        print(f"[-] Backend Endpoint : {backend_url}")
        print(f"[-] Sampling Rate    : {1.0 / interval:.1f} Hz (Interval: {interval:.2f} s)")
        print(f"[-] Sliding Window   : {self.feature_service.window_size} time-steps (collections.deque)")
        print(f"[-] ML Models Loaded : LightGBM Baseline Regressor & IsolationForest Anomaly Detector")
        print(f"[-] Monitored Assets : {', '.join(self.config.asset_profiles.keys())}")
        print(f"[!] Failure Scenario : {'ACTIVE' if self.config.failure_scenario.enabled else 'DISABLED'}")
        if self.config.failure_scenario.enabled:
            fs = self.config.failure_scenario
            print(f"    Target Asset     : {fs.target_asset_id}")
            print(f"    Degradation Path : Bearing Wear (Vib {fs.vib_start_rms} -> {fs.vib_target_rms} mm/s, Temp +{fs.temp_increase_c} C, kW +{int(fs.power_surge_multiplier*100)}%)")
            print(f"    Progression Steps: {fs.total_steps} seconds (~{fs.total_steps/60:.1f} minutes)")
        print("=" * 88 + "\n")

        try:
            while self._running:
                start_time = time.monotonic()
                self.cycle_count += 1

                # Sync dynamic failure scenario state from backend every 2 cycles
                if not dry_run and self.cycle_count % 2 == 0:
                    backend_cfg = self.client.fetch_demo_status()
                    if backend_cfg:
                        remote_enabled = backend_cfg.get("enabled", False)
                        if remote_enabled != self.generator.failure_state._is_active:
                            self.generator.failure_state.set_enabled(remote_enabled)
                            if not remote_enabled:
                                self.generator.failure_state.reset()
                            else:
                                logger.info("Remote failure simulation activated for MOTOR-03")

                # 1. Generate realistic physical sensor telemetry for all 5 industrial assets
                readings = self.generator.generate_cycle(advance_failure_step=True)

                # 2. Extract real-time statistical rolling features per asset
                engineered_features = self.feature_service.process_batch(readings)

                # 3. Real-time Machine Learning Inference (target latency < 15 ms)
                ml_start = time.perf_counter()
                predictions = self.predictor.predict_batch(readings, engineered_features)
                ml_latency_ms = (time.perf_counter() - ml_start) * 1000.0

                # 4. Attach ML predictions directly into telemetry payload
                for r, pred in zip(readings, predictions):
                    r.predicted_kw = pred.predicted_kw
                    r.waste_gap_kw = pred.waste_gap_kw
                    r.waste_pct = pred.waste_pct
                    r.anomaly_score = pred.anomaly_score
                    r.status = pred.status

                # 5. Transmit complete payload with ML inferences to backend /api/v1/telemetry
                tx_status = "SKIPPED (DRY-RUN)"
                if not dry_run:
                    success = self.client.send_batch(readings)
                    tx_status = "DELIVERED (HTTP 2xx)" if success else "RETRY_EXHAUSTED (Backend Offline, Anti-Crash Safe)"

                # 6. Print structured diagnostic output to console
                self._display_cycle_metrics(readings, predictions, tx_status, ml_latency_ms)

                # Stop if max_cycles reached
                if max_cycles and self.cycle_count >= max_cycles:
                    logger.info("Target cycle count (%d) reached. Exiting.", max_cycles)
                    break

                # 7. Accurate 1 Hz timing (compensate for ML inference and network latency)
                elapsed = time.monotonic() - start_time
                sleep_time = max(0.0, interval - elapsed)
                time.sleep(sleep_time)

        except KeyboardInterrupt:
            logger.info("Simulation interrupted by user.")
        finally:
            self.stop()

    def _display_cycle_metrics(
        self,
        readings: list,
        predictions: list[PredictionResult],
        tx_status: str,
        ml_latency_ms: float
    ) -> None:
        """Display clean, structured operational metrics and ML predictions for current cycle."""
        state = self.generator.failure_state
        now_str = datetime.now().strftime("%H:%M:%S")

        preds_by_asset = {p.asset_id: p for p in predictions}

        print(f"[{now_str}] Cycle #{self.cycle_count:04d} | Status: {tx_status} | ML Overhead: {ml_latency_ms:.2f} ms")
        print(
            f"{'Asset ID':<10} | {'kW (Act)':>8} | {'kW (Pred)':>9} | {'Waste (kW)':>10} | "
            f"{'Waste %':>7} | {'Vib (RMS)':>9} | {'Anom Score':>10} | {'ML Status'}"
        )
        print("-" * 88)

        for r in readings:
            pred = preds_by_asset.get(r.asset_id)
            pred_kw_str = f"{pred.predicted_kw:.2f}" if pred else "-"
            waste_kw_str = f"{pred.waste_gap_kw:.2f}" if pred else "-"
            waste_pct_str = f"{pred.waste_pct:.1f}%" if pred else "-"
            score_str = f"{pred.anomaly_score:.3f}" if pred else "-"
            status_str = f"[{pred.status.upper()}]" if pred else "[UNKNOWN]"

            # Highlight specific scenario notes
            if r.asset_id == state.target_asset_id and r.is_degraded:
                status_str += f" Wear {r.degradation_pct:.0f}%"

            print(
                f"{r.asset_id:<10} | {r.kw:>8.2f} | {pred_kw_str:>9} | {waste_kw_str:>10} | "
                f"{waste_pct_str:>7} | {r.vib_rms:>9.2f} | {score_str:>10} | {status_str}"
            )

        if state.enabled and state.current_step > 0:
            print(f"[!] Failure State on {state.target_asset_id}: {state.status_description} "
                  f"(Step {state.current_step}/{state.total_steps})")
        print("-" * 88 + "\n")

    def _setup_signal_handlers(self) -> None:
        """Register graceful shutdown handlers."""
        def handle_signal(sig, _):
            logger.info("Received signal %s. Shutting down gracefully...", sig)
            self._running = False

        try:
            signal.signal(signal.SIGINT, handle_signal)
            signal.signal(signal.SIGTERM, handle_signal)
        except (ValueError, AttributeError):
            pass

    def stop(self) -> None:
        """Gracefully release resources."""
        self._running = False
        self.client.close()
        print("\n[-] Vigilux Telemetry Simulator cleanly stopped.")


def parse_arguments() -> argparse.Namespace:
    """Parse command line flags."""
    parser = argparse.ArgumentParser(description="Vigilux Industrial Sensor Telemetry & Real-Time ML Inference (1 Hz)")
    parser.add_argument("--cycles", type=int, default=None, help="Maximum number of 1 Hz cycles to run")
    parser.add_argument("--dry-run", action="store_true", help="Generate telemetry without transmitting over network")
    parser.add_argument("--once", action="store_true", help="Run a single test cycle and exit")
    parser.add_argument("--no-failure", action="store_true", help="Disable the progressive failure scenario injection")
    parser.add_argument("--window", type=int, default=30, help="Sliding window capacity in seconds (default: 30)")
    return parser.parse_args()


def main() -> None:
    """CLI execution entrypoint."""
    args = parse_arguments()

    app_config = AppConfig()
    if args.no_failure:
        app_config.failure_scenario.enabled = False

    app = TelemetrySimulatorApp(app_config=app_config, window_size=args.window)

    max_cycles = 1 if args.once else args.cycles
    app.start(max_cycles=max_cycles, dry_run=args.dry_run)


if __name__ == "__main__":
    main()

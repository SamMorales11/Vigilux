# Vigilux ML Engine - Industrial Telemetry & Real-Time ML Inference (1 Hz)

A high-performance, Clean Code Python application that generates real-time physical telemetry for industrial machinery assets, extracts statistical features, executes ML models at sub-15 ms latency, and transmits readings to the Vigilux server.

## Features
- **1 Hz Realistic Telemetry**: Simulates active electrical power (`kw`), rotational speed (`rpm`), bearing temperature (`temp_c` / `bearing_temp`), vibration root mean square velocity (`vib_rms` / `vibration_rms`), and pressure (`pressure`) with realistic Gaussian sensor noise.
- **5 Monitored Industrial Assets**:
  - `MOTOR-01`: 75 kW Induction Motor (Primary Conveyor)
  - `MOTOR-02`: 45 kW Induction Motor (Cooling Fan Drive)
  - `MOTOR-03`: 110 kW Heavy Crusher Motor
  - `PUMP-01`: 55 kW Centrifugal Slurry Pump
  - `COMP-01`: 90 kW Rotary Screw Air Compressor
- **In-Memory Feature Engineering**:
  - Sliding window (`collections.deque`, 30 time-steps) per asset.
  - Rolling mean, rolling sample standard deviation (`ddof=1`), and peak-to-peak amplitude for `kw`, `vib_rms`, and `temp_c`.
  - Energy-to-Throughput ratio (`kw / rpm`) with safe zero-division handling.
- **Phase 2 Real-Time Machine Learning Inference (< 15 ms Overhead)**:
  - **LightGBM Baseline Regressor**: Predicts expected healthy active power (`predicted_kw`) based on RPM, pressure, and temperature.
  - **Energy Waste Discrepancy**: Calculates `waste_gap_kw = max(0.0, kw - predicted_kw)` and `waste_pct`.
  - **IsolationForest Anomaly Detection**: Unsupervised multi-sensor evaluation smoothly normalized to `anomaly_score` in [0.00, 1.00].
  - **Tri-State Classification**:
    - `Healthy` if `anomaly_score < 0.65`
    - `Warning` if `0.65 <= anomaly_score <= 0.80`
    - `Critical` if `anomaly_score > 0.80`
- **Stateful Failure Scenario Injection**:
  - Progressively injects mechanical bearing wear on `MOTOR-03`.
  - Vibration RMS rises steadily from **1.8 mm/s towards 7.8 mm/s** (breaching ISO 10816 limits).
  - Bearing temperature increases by **+18°C** due to mechanical friction.
  - Electrical active power surges by **+34% kW** (surpassing rated load).
- **Network Resilience & Anti-Crash**:
  - Implements exponential backoff retries.
  - Gracefully handles offline backends, timeouts, and connection refusal without crashing the daemon.

## Installation

```bash
cd apps/ml-engine
pip install -r requirements.txt
```

## Model Training

```bash
# From workspace root
pnpm run train:ml

# Or directly in apps/ml-engine
python src/ml/trainer.py
```

## Usage

```bash
# Continuous 1 Hz simulation with live ML inference
pnpm run sim:ml

# Single test cycle in dry-run mode
pnpm run sim:ml -- --once --dry-run

# Run without failure scenario
pnpm run sim:ml -- --no-failure
```

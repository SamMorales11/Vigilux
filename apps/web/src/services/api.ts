/**
 * REST API Client Service for Vigilux Backend.
 *
 * Implements strict type checking and uniform error handling
 * for communicating with Fastify HTTP endpoints at /api/v1/*.
 */

import type {
  Asset,
  AssetMetricsSummary,
  DemoSimulationConfig,
  SimulateFailureRequest,
  TelemetryPayload,
  ApiResponse,
} from '@/types/telemetry';

const BASE_URL = '/api/v1';

export class ApiService {
  /**
   * Fetch all registered industrial assets enriched with live status from cache.
   */
  static async getAssets(): Promise<Asset[]> {
    const res = await fetch(`${BASE_URL}/assets`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`[ApiService] Failed to fetch assets: HTTP ${res.status} ${res.statusText}`);
    }

    const json: ApiResponse<Asset[]> = await res.json();
    if (!json.success || !json.data) {
      throw new Error(json.message || '[ApiService] Empty or invalid response from /assets');
    }

    // Normalize property names for consistency (ratedKw / rated_kw)
    return json.data.map((item) => ({
      ...item,
      rated_kw: item.rated_kw ?? item.ratedKw ?? 0,
      iso_vibration_limit: item.iso_vibration_limit ?? item.isoVibrationLimit ?? 4.5,
      status: (item.status?.toLowerCase() as Asset['status']) || 'healthy',
    }));
  }

  /**
   * Fetch asset performance summary: MTBF, Shift kWh, Energy Waste Gap, Recent Incidents.
   */
  static async getAssetMetrics(assetId: string): Promise<AssetMetricsSummary> {
    const res = await fetch(`${BASE_URL}/assets/${encodeURIComponent(assetId)}/metrics`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`[ApiService] Failed to fetch metrics for ${assetId}: HTTP ${res.status}`);
    }

    const json: ApiResponse<AssetMetricsSummary> = await res.json();
    if (!json.success || !json.data) {
      throw new Error(json.message || `[ApiService] Invalid response for asset ${assetId}`);
    }

    return json.data;
  }

  /**
   * Trigger or modify demo failure scenario on target machine (default: MOTOR-03).
   */
  static async simulateFailure(req: SimulateFailureRequest): Promise<DemoSimulationConfig> {
    const res = await fetch(`${BASE_URL}/demo/simulate-failure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        simulate_failure: req.simulate_failure,
        target_asset: req.target_asset ?? 'MOTOR-03',
        threshold: req.threshold ?? 0.8,
      }),
    });

    if (!res.ok) {
      throw new Error(`[ApiService] Failed to update simulation config: HTTP ${res.status}`);
    }

    const json: ApiResponse<DemoSimulationConfig> = await res.json();
    if (!json.config) {
      throw new Error('[ApiService] Missing config payload in simulation response');
    }

    return json.config;
  }

  /**
   * Retrieve current failure simulation configuration and sensitivity threshold.
   */
  static async getDemoStatus(): Promise<DemoSimulationConfig> {
    const res = await fetch(`${BASE_URL}/demo/status`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`[ApiService] Failed to fetch demo status: HTTP ${res.status}`);
    }

    const json: ApiResponse<DemoSimulationConfig> = await res.json();
    if (!json.config) {
      throw new Error('[ApiService] Missing config in /demo/status response');
    }

    return json.config;
  }

  /**
   * Fast in-memory cache lookup for all assets' latest telemetry.
   */
  static async getLatestTelemetry(): Promise<TelemetryPayload[]> {
    const res = await fetch(`${BASE_URL}/telemetry/latest`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`[ApiService] Failed to fetch latest telemetry: HTTP ${res.status}`);
    }

    const json: ApiResponse<TelemetryPayload[]> = await res.json();
    return json.data ?? [];
  }
}

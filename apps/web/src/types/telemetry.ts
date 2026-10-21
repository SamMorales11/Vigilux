/**
 * Strict TypeScript Type Contracts for Vigilux Telemetry & Asset Management.
 */

export type AssetStatus = 'healthy' | 'warning' | 'critical' | 'offline';

export interface Asset {
  id: string;
  name: string;
  type: string;
  rated_kw: number;
  iso_vibration_limit: number;
  status: AssetStatus;
  created_at?: string;
  // Normalized camelCase fallbacks
  ratedKw?: number;
  isoVibrationLimit?: number;
  // Dynamic enriched fields
  healthScore?: number;
  anomaly_score?: number;
  currentKw?: number | null;
  currentRpm?: number | null;
  currentTemp?: number | null;
  currentVibRms?: number | null;
  currentPressure?: number | null;
  predictedKw?: number | null;
  wasteGapKw?: number | null;
  wastePct?: number | null;
  lastUpdated?: string | null;
}

export interface EnrichedAsset extends Asset {
  dynamicStatus: AssetStatus;
  currentScore: number;
  currentKwValue: number;
  currentVibRmsValue: number;
  currentTempValue: number;
  wasteGapKwValue: number;
  lastSeenTime: string;
}

export interface TelemetryPayload {
  asset_id: string;
  timestamp: string;
  kw: number;
  rpm: number;
  temp_c: number;
  vib_rms: number;
  pressure: number;
  predicted_kw?: number;
  waste_gap_kw?: number;
  waste_pct?: number;
  anomaly_score?: number;
  status?: 'Healthy' | 'Warning' | 'Critical' | 'healthy' | 'warning' | 'critical' | string;
  // Normalized camelCase aliases
  assetId?: string;
  bearing_temp?: number;
  bearingTemp?: number;
  vibration_rms?: number;
  vibrationRms?: number;
  predictedKw?: number;
  wasteGapKw?: number;
  wastePct?: number;
  anomalyScore?: number;
}

export interface Incident {
  id?: string;
  asset_id: string;
  timestamp: string;
  anomaly_score: number;
  waste_kw: number;
  estimated_cost_per_hr: number;
  diagnostic_message: string;
  acknowledged?: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  // Normalized aliases
  assetId?: string;
  anomalyScore?: number;
  wasteKw?: number;
  estimatedCostPerHr?: number;
  diagnosticMessage?: string;
}

export interface AssetMetricsSummary {
  asset: {
    id: string;
    name: string;
    type: string;
    ratedKw: number;
    isoVibrationLimit: number;
    status: string;
  };
  health: {
    healthScore: number;
    anomalyScore: number;
    status: string;
    estimatedMtbfHours: number;
  };
  shiftMetrics: {
    shiftDurationHours: number;
    totalKwhConsumed: number;
    accumulatedWasteGapKwh: number;
    estimatedWasteCost: number;
  };
  latestTelemetry: TelemetryPayload | null;
  recentIncidents: Incident[];
}

export interface DemoSimulationConfig {
  enabled: boolean;
  target_asset: string;
  progression_steps?: number;
  anomaly_threshold: number;
  warning_threshold?: number;
  cooldown_period_seconds?: number;
  last_updated?: string;
}

export interface SimulateFailureRequest {
  simulate_failure: boolean;
  target_asset?: string;
  threshold?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  config?: DemoSimulationConfig;
  count?: number;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

// WebSocket Protocol Contracts
export type WsServerMessageType =
  | 'TELEMETRY_UPDATE'
  | 'INCIDENT_ALERT'
  | 'CONNECTION_ACK'
  | 'PONG'
  | 'telemetry'
  | 'incident'
  | 'pong';

export interface WsServerMessage<T = unknown> {
  type: WsServerMessageType | string;
  payload?: T;
  data?: T;
  timestamp: string;
}

export type WsMessage<T = unknown> = WsServerMessage<T>;

export interface WsPingMessage {
  type: 'PING';
  clientSentAt?: number;
}

export interface WsPongPayload {
  serverTime: string;
}

/**
 * Telemetry Service Layer (Clean Architecture).
 *
 * Implements:
 * 1. Low-latency instant WebSocket broadcasting (< 150 ms stream latency).
 * 2. In-memory latest operational metrics caching per asset.
 * 3. Micro-batching queue for PostgreSQL bulk insertion (every 10s or 15 rows).
 * 4. Automatic anomaly evaluation, threshold detection (0.80), incident logging,
 *    and anti-spam cooldown management.
 * 5. Asset health overview, performance summary (MTBF, Shift kWh, Energy Waste Gap).
 * 6. Demo failure simulation and alarm sensitivity synchronization.
 */

import { eq, desc } from 'drizzle-orm';
import {
  db as defaultDb,
  type Database,
  sensorTelemetry,
  anomalyIncidents,
  assetRegistry,
  type NewSensorTelemetry,
} from '../../db/index.js';
import { wsHub as defaultWsHub, TelemetryWebSocketHub } from './ws-hub.js';

export interface RawTelemetryInput {
  asset_id?: string;
  assetId?: string;
  timestamp?: string | Date;
  kw: number;
  rpm: number;
  temp_c?: number;
  bearing_temp?: number;
  bearingTemp?: number;
  vib_rms?: number;
  vibration_rms?: number;
  vibrationRms?: number;
  pressure: number;
  predicted_kw?: number | null;
  predictedKw?: number | null;
  waste_gap_kw?: number | null;
  wasteGapKw?: number | null;
  waste_pct?: number | null;
  wastePct?: number | null;
  anomaly_score?: number | null;
  anomalyScore?: number | null;
  status?: string | null;
  is_degraded?: boolean;
  degradation_pct?: number;
}

export interface LatestAssetTelemetry {
  assetId: string;
  timestamp: string;
  kw: number;
  rpm: number;
  bearingTemp: number;
  vibrationRms: number;
  pressure: number;
  predictedKw: number | null;
  wasteGapKw: number | null;
  wastePct: number | null;
  anomalyScore: number | null;
  status: string;
  receivedAt: Date;
}

export interface AssetOverview {
  id: string;
  name: string;
  type: string;
  ratedKw: number;
  isoVibrationLimit: number;
  status: string;
  healthScore: number;
  currentKw: number | null;
  currentRpm: number | null;
  currentTemp: number | null;
  currentVibRms: number | null;
  currentPressure: number | null;
  predictedKw: number | null;
  wasteGapKw: number | null;
  wastePct: number | null;
  anomalyScore: number | null;
  lastUpdated: string | null;
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
  latestTelemetry: LatestAssetTelemetry | null;
  recentIncidents: {
    id: string;
    timestamp: string;
    anomalyScore: number;
    wasteKw: number;
    estimatedCostPerHr: number;
    diagnosticMessage: string;
  }[];
}

export interface DemoSimulationConfig {
  enabled: boolean;
  target_asset: string;
  progression_steps: number;
  anomaly_threshold: number;
  warning_threshold: number;
  cooldown_period_seconds: number;
  last_updated: string;
}

export interface TelemetryServiceOptions {
  db?: Database;
  wsHub?: TelemetryWebSocketHub;
  batchSize?: number;            // Default: 15 rows
  batchIntervalMs?: number;      // Default: 10,000 ms (10 seconds)
  anomalyThreshold?: number;     // Default: 0.80
  warningThreshold?: number;     // Default: 0.65
  cooldownPeriodMs?: number;     // Default: 60,000 ms (60 seconds)
  electricityCostPerKwh?: number;// Default: $0.15 / kWh
}

export interface IngestResult {
  broadcastCount: number;
  queuedRowCount: number;
  bufferFlushed: boolean;
  incidentCreated: boolean;
}

export class TelemetryService {
  private readonly db: Database;
  private readonly wsHub: TelemetryWebSocketHub;

  // Micro-batching configuration
  private readonly batchSize: number;
  private readonly batchIntervalMs: number;
  private bufferQueue: NewSensorTelemetry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  // In-memory cache for latest telemetry states
  private readonly latestMetricsCache = new Map<string, LatestAssetTelemetry>();

  // Anomaly evaluation & cooldown management
  private anomalyThreshold: number;
  private warningThreshold: number;
  private cooldownPeriodMs: number;
  private readonly electricityCostPerKwh: number;
  private readonly incidentCooldownMap = new Map<string, number>();

  // Demo simulation state configuration
  private simulationConfig: DemoSimulationConfig;

  constructor(options: TelemetryServiceOptions = {}) {
    this.db = options.db ?? defaultDb;
    this.wsHub = options.wsHub ?? defaultWsHub;

    this.batchSize = options.batchSize ?? 15;
    this.batchIntervalMs = options.batchIntervalMs ?? 10_000;
    this.anomalyThreshold = options.anomalyThreshold ?? 0.80;
    this.warningThreshold = options.warningThreshold ?? 0.65;
    this.cooldownPeriodMs = options.cooldownPeriodMs ?? 60_000;
    this.electricityCostPerKwh = options.electricityCostPerKwh ?? 0.15;

    this.simulationConfig = {
      enabled: true,
      target_asset: 'MOTOR-03',
      progression_steps: 60,
      anomaly_threshold: this.anomalyThreshold,
      warning_threshold: this.warningThreshold,
      cooldown_period_seconds: Math.floor(this.cooldownPeriodMs / 1000),
      last_updated: new Date().toISOString(),
    };

    this.startMicroBatchTimer();
  }

  /**
   * Ingest raw sensor telemetry reading(s).
   * 1. Instantly broadcasts to WebSocket client streams (< 150 ms latency).
   * 2. Updates in-memory latest metrics cache.
   * 3. Queues record into micro-batching buffer.
   * 4. Evaluates anomaly score and registers incidents with cooldown protection.
   */
  public async ingestTelemetry(
    input: RawTelemetryInput | RawTelemetryInput[]
  ): Promise<IngestResult> {
    const rawList = Array.isArray(input) ? input : [input];
    if (rawList.length === 0) {
      return { broadcastCount: 0, queuedRowCount: 0, bufferFlushed: false, incidentCreated: false };
    }

    let broadcastCount = 0;
    let incidentCreated = false;

    for (const raw of rawList) {
      const normalized = this.normalizeInput(raw);

      // 1. Instant WebSocket broadcast (< 150 ms latency guarantee)
      this.wsHub.broadcastTelemetry(normalized);
      broadcastCount++;

      // 2. Update in-memory latest metrics cache
      this.updateCache(normalized);

      // 3. Add to micro-batching persistence queue
      this.bufferQueue.push({
        assetId: normalized.assetId,
        timestamp: new Date(normalized.timestamp),
        kw: normalized.kw,
        rpm: normalized.rpm,
        bearingTemp: normalized.bearingTemp,
        vibrationRms: normalized.vibrationRms,
        pressure: normalized.pressure,
        predictedKw: normalized.predictedKw,
        wasteGapKw: normalized.wasteGapKw,
        anomalyScore: normalized.anomalyScore,
      });

      // 4. Anomaly evaluation and incident management
      const incidentTriggered = await this.evaluateAnomaly(normalized);
      if (incidentTriggered) {
        incidentCreated = true;
      }
    }

    // 5. Trigger size-based flush if buffer reaches threshold (15 rows)
    let bufferFlushed = false;
    if (this.bufferQueue.length >= this.batchSize) {
      await this.flushBuffer();
      bufferFlushed = true;
    }

    return {
      broadcastCount,
      queuedRowCount: this.bufferQueue.length,
      bufferFlushed,
      incidentCreated,
    };
  }

  /**
   * Normalize flexible incoming telemetry properties into uniform structure.
   */
  private normalizeInput(raw: RawTelemetryInput): LatestAssetTelemetry {
    const assetId = raw.asset_id || raw.assetId;
    if (!assetId) {
      throw new Error('Telemetry reading is missing required asset_id');
    }

    const timestampStr = raw.timestamp
      ? (typeof raw.timestamp === 'string' ? raw.timestamp : raw.timestamp.toISOString())
      : new Date().toISOString();

    const bearingTemp = raw.bearingTemp ?? raw.bearing_temp ?? raw.temp_c ?? 0.0;
    const vibrationRms = raw.vibrationRms ?? raw.vibration_rms ?? raw.vib_rms ?? 0.0;
    const predictedKw = raw.predictedKw ?? raw.predicted_kw ?? null;
    const wasteGapKw = raw.wasteGapKw ?? raw.waste_gap_kw ?? (predictedKw !== null ? Math.max(0, raw.kw - predictedKw) : null);
    const wastePct = raw.wastePct ?? raw.waste_pct ?? (predictedKw && wasteGapKw ? (wasteGapKw / predictedKw) * 100 : null);
    const anomalyScore = raw.anomalyScore ?? raw.anomaly_score ?? null;

    let status = raw.status || 'Healthy';
    if (!raw.status && anomalyScore !== null) {
      if (anomalyScore >= this.anomalyThreshold) status = 'Critical';
      else if (anomalyScore >= this.warningThreshold) status = 'Warning';
      else status = 'Healthy';
    }

    return {
      assetId,
      timestamp: timestampStr,
      kw: Number(raw.kw),
      rpm: Number(raw.rpm),
      bearingTemp: Number(bearingTemp),
      vibrationRms: Number(vibrationRms),
      pressure: Number(raw.pressure),
      predictedKw: predictedKw !== null ? Number(predictedKw) : null,
      wasteGapKw: wasteGapKw !== null ? Number(wasteGapKw) : null,
      wastePct: wastePct !== null ? Number(wastePct) : null,
      anomalyScore: anomalyScore !== null ? Number(anomalyScore) : null,
      status,
      receivedAt: new Date(),
    };
  }

  /**
   * Update internal in-memory cache for fast lookups.
   */
  private updateCache(data: LatestAssetTelemetry): void {
    this.latestMetricsCache.set(data.assetId, data);
  }

  /**
   * Evaluate anomaly score against thresholds, update asset status,
   * and log incidents with anti-spam cooldown protection.
   */
  private async evaluateAnomaly(data: LatestAssetTelemetry): Promise<boolean> {
    const score = data.anomalyScore ?? 0.0;
    const assetId = data.assetId;

    // Check if score breaches critical threshold (default >= 0.80)
    if (score >= this.anomalyThreshold) {
      // 1. Update Asset Registry status to 'critical'
      await this.updateAssetStatus(assetId, 'critical');

      // 2. Check Cooldown timer to prevent 1 Hz duplicate log spam
      const lastLogged = this.incidentCooldownMap.get(assetId) ?? 0;
      const now = Date.now();

      if (now - lastLogged < this.cooldownPeriodMs) {
        // Still within cooldown window; skip creating duplicate incident row
        return false;
      }

      // 3. Cooldown expired or first incident: Log new incident
      this.incidentCooldownMap.set(assetId, now);

      const wasteKw = data.wasteGapKw ?? Math.max(0.0, data.kw * 0.25);
      const estimatedCostPerHr = Math.round(wasteKw * this.electricityCostPerKwh * 100) / 100;

      // Construct intelligent diagnostic message
      const diagnosticMessage = this.generateDiagnosticMessage(data, wasteKw);

      try {
        const [incident] = await this.db
          .insert(anomalyIncidents)
          .values({
            assetId,
            timestamp: new Date(data.timestamp),
            anomalyScore: score,
            wasteKw,
            estimatedCostPerHr,
            diagnosticMessage,
          })
          .returning();

        // 4. Immediately broadcast incident notification to frontend clients
        if (incident) {
          this.wsHub.broadcastIncident(incident);
        }

        return true;
      } catch (err) {
        console.error(`❌ Failed to record anomaly incident for ${assetId}:`, err);
        return false;
      }
    } else if (score >= this.warningThreshold) {
      // Moderate anomaly: update status to 'warning'
      await this.updateAssetStatus(assetId, 'warning');
      return false;
    } else {
      // Normal healthy operation: if previously in cooldown/alert, restore to operational
      if (this.incidentCooldownMap.has(assetId)) {
        this.incidentCooldownMap.delete(assetId);
        await this.updateAssetStatus(assetId, 'operational');
      }
      return false;
    }
  }

  /**
   * Generate descriptive diagnostic message based on telemetry metrics.
   */
  private generateDiagnosticMessage(data: LatestAssetTelemetry, wasteKw: number): string {
    const assetId = data.assetId;
    const vib = data.vibrationRms.toFixed(2);
    const temp = data.bearingTemp.toFixed(1);
    const waste = wasteKw.toFixed(1);

    if (data.vibrationRms > 4.5) {
      return `High Friction Warning: ${assetId} drawing excess ${waste} kW due to bearing vibration spike (${vib} mm/s, temp: ${temp}°C)`;
    } else if (data.bearingTemp > 80.0) {
      return `Thermal Degradation Alert: ${assetId} bearing temp surged to ${temp}°C with ${waste} kW energy gap`;
    } else {
      return `Operational Anomaly: ${assetId} detected abnormal signature (Anomaly Score: ${(data.anomalyScore ?? 0).toFixed(2)}, Waste: ${waste} kW)`;
    }
  }

  /**
   * Update operational status of asset in asset_registry table.
   */
  private async updateAssetStatus(assetId: string, status: string): Promise<void> {
    try {
      await this.db
        .update(assetRegistry)
        .set({
          status,
          updatedAt: new Date(),
        })
        .where(eq(assetRegistry.id, assetId));
    } catch (err) {
      console.error(`❌ Failed to update status for asset ${assetId}:`, err);
    }
  }

  /**
   * Perform bulk insert of buffered telemetry records to Neon PostgreSQL.
   */
  public async flushBuffer(): Promise<number> {
    if (this.isFlushing || this.bufferQueue.length === 0) {
      return 0;
    }

    this.isFlushing = true;
    const recordsToInsert = this.bufferQueue.splice(0, this.bufferQueue.length);

    try {
      await this.db.insert(sensorTelemetry).values(recordsToInsert);
      return recordsToInsert.length;
    } catch (error) {
      console.error('❌ Error during micro-batch bulk insert to sensor_telemetry:', error);
      // Re-queue recent uninserted records if buffer is not excessively large
      if (this.bufferQueue.length < 500) {
        this.bufferQueue.unshift(...recordsToInsert.slice(-this.batchSize));
      }
      return 0;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Initialize background interval timer for time-based micro-batching (10 seconds).
   */
  private startMicroBatchTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.bufferQueue.length > 0) {
        void this.flushBuffer();
      }
    }, this.batchIntervalMs);

    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * Retrieve list of all registered assets enriched with live/cached metrics.
   */
  public async getAllAssets(): Promise<AssetOverview[]> {
    const assets = await this.db.select().from(assetRegistry);

    return assets.map((asset) => {
      const live = this.latestMetricsCache.get(asset.id);
      const anomalyScore = live?.anomalyScore ?? null;
      const healthScore = anomalyScore !== null
        ? Math.max(0, Math.min(100, Math.round((1 - anomalyScore) * 100)))
        : 100;

      return {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        ratedKw: asset.ratedKw,
        isoVibrationLimit: asset.isoVibrationLimit,
        status: asset.status,
        healthScore,
        currentKw: live?.kw ?? null,
        currentRpm: live?.rpm ?? null,
        currentTemp: live?.bearingTemp ?? null,
        currentVibRms: live?.vibrationRms ?? null,
        currentPressure: live?.pressure ?? null,
        predictedKw: live?.predictedKw ?? null,
        wasteGapKw: live?.wasteGapKw ?? null,
        wastePct: live?.wastePct ?? null,
        anomalyScore,
        lastUpdated: live?.timestamp ?? asset.updatedAt.toISOString(),
      };
    });
  }

  /**
   * Retrieve comprehensive performance metrics for a specific asset:
   * MTBF, shift kWh consumption, accumulated Energy Waste Gap, recent incidents, health score.
   */
  public async getAssetMetricsSummary(assetId: string): Promise<AssetMetricsSummary> {
    const [asset] = await this.db
      .select()
      .from(assetRegistry)
      .where(eq(assetRegistry.id, assetId))
      .limit(1);

    if (!asset) {
      throw new Error(`Asset '${assetId}' not found in registry`);
    }

    // 1. Fetch recent incidents
    const incidents = await this.db
      .select()
      .from(anomalyIncidents)
      .where(eq(anomalyIncidents.assetId, assetId))
      .orderBy(desc(anomalyIncidents.timestamp))
      .limit(10);

    // 2. Resolve latest telemetry
    const cached = this.latestMetricsCache.get(assetId);
    let latest = cached ?? null;

    if (!latest) {
      const [dbLatest] = await this.db
        .select()
        .from(sensorTelemetry)
        .where(eq(sensorTelemetry.assetId, assetId))
        .orderBy(desc(sensorTelemetry.timestamp))
        .limit(1);

      if (dbLatest) {
        latest = {
          assetId: dbLatest.assetId,
          timestamp: dbLatest.timestamp.toISOString(),
          kw: dbLatest.kw,
          rpm: dbLatest.rpm,
          bearingTemp: dbLatest.bearingTemp,
          vibrationRms: dbLatest.vibrationRms,
          pressure: dbLatest.pressure,
          predictedKw: dbLatest.predictedKw,
          wasteGapKw: dbLatest.wasteGapKw,
          wastePct: dbLatest.predictedKw && dbLatest.wasteGapKw
            ? (dbLatest.wasteGapKw / dbLatest.predictedKw) * 100
            : 0,
          anomalyScore: dbLatest.anomalyScore,
          status: dbLatest.anomalyScore && dbLatest.anomalyScore >= this.anomalyThreshold ? 'Critical' : (dbLatest.anomalyScore && dbLatest.anomalyScore >= this.warningThreshold ? 'Warning' : 'Healthy'),
          receivedAt: dbLatest.timestamp,
        };
      }
    }

    // 3. Health & MTBF Calculations
    const anomalyScore = latest?.anomalyScore ?? 0.12;
    const healthScore = Math.max(0, Math.min(100, Math.round((1 - anomalyScore) * 100)));

    let nominalMtbf = 3500; // Industrial induction motor standard (hours)
    if (asset.type.toLowerCase().includes('pump')) nominalMtbf = 2800;
    else if (asset.type.toLowerCase().includes('comp')) nominalMtbf = 2400;

    const healthDerating = Math.max(0.12, 1.0 - 0.78 * anomalyScore);
    const incidentPenalty = 1.0 + (incidents.length * 0.35);
    const estimatedMtbfHours = Math.round((nominalMtbf * healthDerating) / incidentPenalty);

    // 4. Shift Operational Metrics (standard 8-hour industrial shift)
    const shiftDurationHours = 8.0;
    const currentKw = latest?.kw ?? (asset.ratedKw * 0.75);
    const totalKwhConsumed = Math.round((currentKw * shiftDurationHours) * 10) / 10;

    const currentWasteKw = latest?.wasteGapKw ?? (currentKw * 0.05);
    const accumulatedWasteGapKwh = Math.round((currentWasteKw * shiftDurationHours) * 10) / 10;
    const estimatedWasteCost = Math.round(accumulatedWasteGapKwh * this.electricityCostPerKwh * 100) / 100;

    return {
      asset: {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        ratedKw: asset.ratedKw,
        isoVibrationLimit: asset.isoVibrationLimit,
        status: asset.status,
      },
      health: {
        healthScore,
        anomalyScore: roundTo(anomalyScore, 3),
        status: latest?.status ?? (asset.status === 'critical' ? 'Critical' : (asset.status === 'warning' ? 'Warning' : 'Healthy')),
        estimatedMtbfHours,
      },
      shiftMetrics: {
        shiftDurationHours,
        totalKwhConsumed,
        accumulatedWasteGapKwh,
        estimatedWasteCost,
      },
      latestTelemetry: latest,
      recentIncidents: incidents.map((inc) => ({
        id: inc.id,
        timestamp: inc.timestamp.toISOString(),
        anomalyScore: inc.anomalyScore,
        wasteKw: inc.wasteKw,
        estimatedCostPerHr: inc.estimatedCostPerHr,
        diagnosticMessage: inc.diagnosticMessage,
      })),
    };
  }

  /**
   * Get current failure simulation & threshold configuration.
   */
  public getSimulationConfig(): DemoSimulationConfig {
    return { ...this.simulationConfig };
  }

  /**
   * Dynamically update failure scenario and alarm thresholds.
   */
  public setSimulationConfig(input: Partial<DemoSimulationConfig>): DemoSimulationConfig {
    if (typeof input.enabled === 'boolean') {
      this.simulationConfig.enabled = input.enabled;
    }
    if (input.target_asset) {
      this.simulationConfig.target_asset = input.target_asset;
    }
    if (typeof input.anomaly_threshold === 'number') {
      this.anomalyThreshold = input.anomaly_threshold;
      this.simulationConfig.anomaly_threshold = input.anomaly_threshold;
    }
    if (typeof input.warning_threshold === 'number') {
      this.warningThreshold = input.warning_threshold;
      this.simulationConfig.warning_threshold = input.warning_threshold;
    }
    if (typeof input.cooldown_period_seconds === 'number') {
      this.cooldownPeriodMs = input.cooldown_period_seconds * 1000;
      this.simulationConfig.cooldown_period_seconds = input.cooldown_period_seconds;
    }

    this.simulationConfig.last_updated = new Date().toISOString();

    // Broadcast simulation state update to WebSocket clients
    this.wsHub.broadcast('SIMULATION_STATE_CHANGED', this.simulationConfig);

    return this.getSimulationConfig();
  }

  /**
   * Retrieve latest cached operational metrics for an asset.
   */
  public getLatestMetrics(assetId: string): LatestAssetTelemetry | undefined {
    return this.latestMetricsCache.get(assetId);
  }

  /**
   * Retrieve latest cached operational metrics for all assets.
   */
  public getAllLatestMetrics(): LatestAssetTelemetry[] {
    return Array.from(this.latestMetricsCache.values());
  }

  /**
   * Current count of queued items awaiting database flush.
   */
  public get queuedCount(): number {
    return this.bufferQueue.length;
  }

  /**
   * Graceful shutdown: flushes remaining buffer to database and clears timers.
   */
  public async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.bufferQueue.length > 0) {
      await this.flushBuffer();
    }
  }
}

function roundTo(num: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}

// Global singleton instance for injection across server
export const telemetryService = new TelemetryService();

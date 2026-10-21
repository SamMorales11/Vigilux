/**
 * Telemetry Pinia Store (Clean Architecture).
 *
 * Implements:
 * 1. Resilient WebSocket connection to ws://localhost:3000/ws/telemetry/live
 *    with automatic backoff reconnect and live ping round-trip latency tracking.
 * 2. Sliding-window time-series storage (max 90 data points per asset) to guarantee
 *    zero memory leaks and smooth 60 FPS rendering.
 * 3. `isStreamPaused` toggle for jitter-free chart hovering & inspection.
 * 4. `sortedAssets` computed getter sorting machines by highest anomaly score descending
 *    and dynamically re-evaluating status (Healthy, Warning, Critical) against the user's
 *    live `alarmThreshold` slider (default 0.80).
 * 5. Action to trigger POST /api/v1/demo/simulate-failure.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  Asset,
  EnrichedAsset,
  TelemetryPayload,
  Incident,
  DemoSimulationConfig,
  WsServerMessage,
  AssetStatus,
} from '@/types/telemetry';
import { ApiService } from '@/services/api';

// Max time-series points per asset (sliding window for 60 FPS performance)
const MAX_HISTORY_POINTS = 90;

export const useTelemetryStore = defineStore('telemetry', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const assets = ref<Asset[]>([]);
  const selectedAssetId = ref<string>('MOTOR-03');
  const latestTelemetry = ref<Record<string, TelemetryPayload>>({});
  const telemetryHistory = ref<Record<string, TelemetryPayload[]>>({});
  const recentIncidents = ref<Incident[]>([]);
  const selectedAssetSummary = ref<import('@/types/telemetry').AssetMetricsSummary | null>(null);

  // Connection & Latency
  const isConnected = ref<boolean>(false);
  const isConnecting = ref<boolean>(false);
  const pingMs = ref<number | null>(null);
  const lastHeartbeat = ref<string | null>(null);

  // Inspection & Live Control
  const isStreamPaused = ref<boolean>(false);
  const alarmThreshold = ref<number>(0.8); // Default 0.80

  // Failure Simulation State
  const simulationConfig = ref<DemoSimulationConfig>({
    enabled: false,
    target_asset: 'MOTOR-03',
    anomaly_threshold: 0.8,
    warning_threshold: 0.65,
    cooldown_period_seconds: 60,
    last_updated: new Date().toISOString(),
  });

  const isLoading = ref<boolean>(false);

  // Internal WebSocket references
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pingSentTimestamp = 0;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 30;

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  /**
   * Computed getter: Automatically sorts fleet assets by highest anomaly score descending
   * and dynamically re-evaluates each machine's semantic status (Healthy, Warning, Critical)
   * in real-time when the `alarmThreshold` slider is changed by the user.
   */
  const sortedAssets = computed<EnrichedAsset[]>(() => {
    const currentThreshold = alarmThreshold.value;
    // Warning threshold defaults to proportional 81.25% of alarm threshold (0.65 when alarm is 0.80)
    const warningThreshold = Number((currentThreshold * 0.8125).toFixed(3));

    return assets.value
      .map((asset) => {
        const live = latestTelemetry.value[asset.id];
        const score = live?.anomaly_score ?? asset.anomaly_score ?? 0;

        // Dynamic status evaluation against user's live alarm slider
        let dynamicStatus: AssetStatus;
        if (score >= currentThreshold) {
          dynamicStatus = 'critical';
        } else if (score >= warningThreshold) {
          dynamicStatus = 'warning';
        } else {
          dynamicStatus = 'healthy';
        }

        const enriched: EnrichedAsset = {
          ...asset,
          dynamicStatus,
          currentScore: Number(score.toFixed(3)),
          currentKwValue: live?.kw ?? asset.currentKw ?? asset.rated_kw,
          currentVibRmsValue: live?.vib_rms ?? asset.currentVibRms ?? 1.8,
          currentTempValue: live?.temp_c ?? live?.bearing_temp ?? asset.currentTemp ?? 45,
          wasteGapKwValue: live?.waste_gap_kw ?? asset.wasteGapKw ?? 0,
          lastSeenTime: live?.timestamp ?? asset.lastUpdated ?? new Date().toISOString(),
        };

        return enriched;
      })
      .sort((a, b) => {
        // Highest anomaly score first
        if (b.currentScore !== a.currentScore) {
          return b.currentScore - a.currentScore;
        }
        // Fallback secondary sort by asset ID
        return a.id.localeCompare(b.id);
      });
  });

  const selectedAsset = computed<EnrichedAsset | null>(() => {
    return sortedAssets.value.find((a) => a.id === selectedAssetId.value) || null;
  });

  const selectedTelemetry = computed<TelemetryPayload | null>(() => {
    return latestTelemetry.value[selectedAssetId.value] || null;
  });

  const selectedHistory = computed<TelemetryPayload[]>(() => {
    return telemetryHistory.value[selectedAssetId.value] || [];
  });

  const criticalCount = computed<number>(() => {
    return sortedAssets.value.filter((a) => a.dynamicStatus === 'critical').length;
  });

  const warningCount = computed<number>(() => {
    return sortedAssets.value.filter((a) => a.dynamicStatus === 'warning').length;
  });

  const healthyCount = computed<number>(() => {
    return sortedAssets.value.filter((a) => a.dynamicStatus === 'healthy').length;
  });

  const isSimulatingFailure = computed<boolean>(() => {
    return simulationConfig.value.enabled;
  });

  const totalDailyWasteCost = computed<number>(() => {
    const totalWasteKw = sortedAssets.value.reduce((sum, a) => sum + Math.max(0, a.wasteGapKwValue), 0);
    // Estimated daily cost = totalWasteKw * 24 hours * $0.15/kWh electricity tariff
    return totalWasteKw * 24 * 0.15;
  });

  const energyToThroughputRatio = computed<number>(() => {
    const tele = selectedTelemetry.value;
    if (!tele || !tele.rpm || tele.rpm <= 0) return 0;
    return Number((tele.kw / tele.rpm).toFixed(5));
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Fetch initial fleet asset list from REST API.
   */
  async function fetchAssets(): Promise<void> {
    isLoading.value = true;
    try {
      const data = await ApiService.getAssets();
      assets.value = data;
    } catch (err) {
      console.error('[TelemetryStore] Failed to fetch assets:', err);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Fetch demo simulation configuration and alarm threshold from REST API.
   */
  async function fetchDemoStatus(): Promise<void> {
    try {
      const config = await ApiService.getDemoStatus();
      simulationConfig.value = config;
      if (config.anomaly_threshold) {
        alarmThreshold.value = config.anomaly_threshold;
      }
    } catch (err) {
      console.error('[TelemetryStore] Failed to fetch demo status:', err);
    }
  }

  /**
   * Trigger demo failure simulation (injected bearing wear on MOTOR-03)
   * and synchronize alarm sensitivity threshold with backend.
   */
  async function triggerSimulateFailure(enabled: boolean, threshold?: number): Promise<void> {
    try {
      const effectiveThreshold = threshold ?? alarmThreshold.value;
      const updatedConfig = await ApiService.simulateFailure({
        simulate_failure: enabled,
        target_asset: 'MOTOR-03',
        threshold: effectiveThreshold,
      });

      simulationConfig.value = updatedConfig;
      alarmThreshold.value = updatedConfig.anomaly_threshold;
    } catch (err) {
      console.error('[TelemetryStore] Failed to trigger simulation:', err);
    }
  }

  /**
   * Update the live alarm sensitivity threshold via slider.
   */
  function setAlarmThreshold(value: number): void {
    const clamped = Math.min(1.0, Math.max(0.1, Number(value.toFixed(2))));
    alarmThreshold.value = clamped;
  }

  /**
   * Toggle or set the stream paused state for inspecting charts without layout shift.
   */
  function togglePauseStream(): void {
    isStreamPaused.value = !isStreamPaused.value;
  }

  function setStreamPaused(paused: boolean): void {
    isStreamPaused.value = paused;
  }

  /**
   * Select an asset to inspect in dashboard and load its performance summary.
   */
  async function selectAsset(assetId: string): Promise<void> {
    selectedAssetId.value = assetId;
    await fetchSelectedAssetMetrics(assetId);
  }

  /**
   * Fetch historical summary and MTBF for selected asset.
   */
  async function fetchSelectedAssetMetrics(assetId: string): Promise<void> {
    try {
      const summary = await ApiService.getAssetMetrics(assetId);
      selectedAssetSummary.value = summary;
    } catch (err) {
      console.warn(`[TelemetryStore] Could not load metrics summary for ${assetId}:`, err);
    }
  }

  /**
   * Internal processor for incoming telemetry updates (1 Hz per asset).
   * Implements strict sliding-window of max 90 points to avoid memory leaks.
   */
  function processIncomingTelemetry(raw: any): void {
    const assetId = raw.asset_id || raw.assetId;
    if (!assetId) return;

    const payload: TelemetryPayload = {
      asset_id: assetId,
      timestamp: raw.timestamp || new Date().toISOString(),
      kw: Number(raw.kw ?? 0),
      rpm: Number(raw.rpm ?? 0),
      temp_c: Number(raw.temp_c ?? raw.bearing_temp ?? raw.bearingTemp ?? 0),
      vib_rms: Number(raw.vib_rms ?? raw.vibration_rms ?? raw.vibrationRms ?? 0),
      pressure: Number(raw.pressure ?? 0),
      predicted_kw: raw.predicted_kw ?? raw.predictedKw,
      waste_gap_kw: raw.waste_gap_kw ?? raw.wasteGapKw,
      waste_pct: raw.waste_pct ?? raw.wastePct,
      anomaly_score: raw.anomaly_score ?? raw.anomalyScore,
      status: raw.status,
    };

    // Store in latest telemetry map
    latestTelemetry.value[assetId] = payload;

    // Time-series sliding window (Max 90 points)
    // If stream is paused AND this is the actively inspected asset, skip pushing to chart history
    // to preserve tooltip and hover inspections.
    if (isStreamPaused.value && assetId === selectedAssetId.value) {
      return;
    }

    if (!telemetryHistory.value[assetId]) {
      telemetryHistory.value[assetId] = [];
    }

    const history = telemetryHistory.value[assetId];
    history.push(payload);

    // Enforce sliding window limit
    if (history.length > MAX_HISTORY_POINTS) {
      history.shift();
    }
  }

  /**
   * Internal processor for incoming anomaly incident alerts.
   */
  function processIncomingIncident(raw: any): void {
    const incident: Incident = {
      id: raw.id,
      asset_id: raw.asset_id || raw.assetId || 'UNKNOWN',
      timestamp: raw.timestamp || new Date().toISOString(),
      anomaly_score: Number(raw.anomaly_score ?? raw.anomalyScore ?? 0),
      waste_kw: Number(raw.waste_kw ?? raw.wasteKw ?? 0),
      estimated_cost_per_hr: Number(raw.estimated_cost_per_hr ?? raw.estimatedCostPerHr ?? 0),
      diagnostic_message: raw.diagnostic_message ?? raw.diagnosticMessage ?? 'High anomaly detected',
    };

    recentIncidents.value.unshift(incident);
    if (recentIncidents.value.length > 25) {
      recentIncidents.value.pop();
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket Manager (ws://localhost:3000/ws/telemetry/live)
  // ---------------------------------------------------------------------------

  function resolveWsUrl(): string {
    if (typeof window !== 'undefined') {
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocalhost) {
        return 'ws://localhost:3000/ws/telemetry/live';
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}/ws/telemetry/live`;
    }
    return 'ws://localhost:3000/ws/telemetry/live';
  }

  /**
   * Connect to real-time WebSocket server with latency ping measurement and auto-reconnect.
   */
  function initWebSocket(): void {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = resolveWsUrl();
    isConnecting.value = true;

    try {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        isConnected.value = true;
        isConnecting.value = false;
        reconnectAttempts = 0;
        startPingHeartbeat();
      };

      socket.onmessage = (event: MessageEvent) => {
        try {
          const message: WsServerMessage = JSON.parse(event.data);
          const type = message.type?.toUpperCase();

          switch (type) {
            case 'TELEMETRY_UPDATE':
            case 'TELEMETRY':
              processIncomingTelemetry(message.payload || message.data);
              break;

            case 'INCIDENT_ALERT':
            case 'INCIDENT':
              processIncomingIncident(message.payload || message.data);
              break;

            case 'PONG': {
              const now = performance.now();
              if (pingSentTimestamp > 0) {
                pingMs.value = Math.max(1, Math.round(now - pingSentTimestamp));
              }
              lastHeartbeat.value = new Date().toISOString();
              break;
            }

            case 'CONNECTION_ACK':
              lastHeartbeat.value = new Date().toISOString();
              break;

            default:
              // Fallback for generic payloads
              if (message.payload || message.data) {
                processIncomingTelemetry(message.payload || message.data);
              }
              break;
          }
        } catch (err) {
          console.warn('[TelemetryStore] Failed to parse WebSocket message:', err);
        }
      };

      socket.onclose = () => {
        cleanupPingHeartbeat();
        isConnected.value = false;
        isConnecting.value = false;
        scheduleReconnect();
      };

      socket.onerror = (err) => {
        console.warn('[TelemetryStore] WebSocket encountered error:', err);
        isConnected.value = false;
      };
    } catch (err) {
      isConnecting.value = false;
      scheduleReconnect();
    }
  }

  function startPingHeartbeat(): void {
    cleanupPingHeartbeat();
    // Measure ping latency every 5 seconds
    pingTimer = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        pingSentTimestamp = performance.now();
        socket.send(JSON.stringify({ type: 'PING' }));
      }
    }, 5000);

    // Initial immediate ping
    if (socket && socket.readyState === WebSocket.OPEN) {
      pingSentTimestamp = performance.now();
      socket.send(JSON.stringify({ type: 'PING' }));
    }
  }

  function cleanupPingHeartbeat(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.warn('[TelemetryStore] Max reconnect attempts reached');
      return;
    }

    // Exponential backoff capped at 10 seconds
    const delay = Math.min(1500 * Math.pow(1.3, reconnectAttempts), 10000);
    reconnectAttempts++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      initWebSocket();
    }, delay);
  }

  function disconnectWebSocket(): void {
    cleanupPingHeartbeat();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.close();
      socket = null;
    }
    isConnected.value = false;
  }

  return {
    // State
    assets,
    selectedAssetId,
    latestTelemetry,
    telemetryHistory,
    recentIncidents,
    selectedAssetSummary,
    isConnected,
    isConnecting,
    pingMs,
    lastHeartbeat,
    isStreamPaused,
    alarmThreshold,
    simulationConfig,
    isLoading,
    // Getters
    sortedAssets,
    selectedAsset,
    selectedTelemetry,
    selectedHistory,
    criticalCount,
    warningCount,
    healthyCount,
    isSimulatingFailure,
    totalDailyWasteCost,
    energyToThroughputRatio,
    // Actions
    fetchAssets,
    fetchDemoStatus,
    fetchSelectedAssetMetrics,
    triggerSimulateFailure,
    setAlarmThreshold,
    togglePauseStream,
    setStreamPaused,
    selectAsset,
    initWebSocket,
    disconnectWebSocket,
  };
});

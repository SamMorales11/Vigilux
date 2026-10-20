/**
 * Telemetry and Asset Performance Route Definitions.
 *
 * Exposes all REST contracts required by the PRD:
 * - POST /api/v1/telemetry
 * - GET  /api/v1/assets
 * - GET  /api/v1/assets/:asset_id/metrics
 * - POST /api/v1/demo/simulate-failure
 * - GET  /api/v1/demo/status
 */

import type { FastifyInstance } from 'fastify';
import { telemetryController } from './telemetry.controller.js';

export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  // 1. Ingestion Endpoint
  app.post('/api/v1/telemetry', telemetryController.ingestTelemetry.bind(telemetryController));

  // 2. Asset Registry & Performance Metrics
  app.get('/api/v1/assets', telemetryController.getAssets.bind(telemetryController));
  app.get('/api/v1/assets/:asset_id/metrics', telemetryController.getAssetMetrics.bind(telemetryController));

  // 3. Demo Failure Simulation & Sensitivity Thresholds
  app.post('/api/v1/demo/simulate-failure', telemetryController.simulateFailure.bind(telemetryController));
  app.get('/api/v1/demo/status', telemetryController.getDemoStatus.bind(telemetryController));

  // 4. In-Memory Live Cache Lookups
  app.get('/api/v1/telemetry/latest', telemetryController.getLatestMetrics.bind(telemetryController));
  app.get('/api/v1/telemetry/latest/:asset_id', telemetryController.getLatestAssetMetrics.bind(telemetryController));
}

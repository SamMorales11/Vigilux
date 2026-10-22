/**
 * Telemetry & Asset Management Controller.
 *
 * Implements HTTP handlers conforming to Clean Architecture,
 * handling input validation, business orchestration, and response formatting.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  telemetryIngestSchema,
  assetIdParamSchema,
} from './telemetry.schema.js';
import { telemetryService } from './telemetry.service.js';
import { telemetryEngine } from './telemetry-engine.service.js';

export class TelemetryController {
  /**
   * POST /api/v1/telemetry
   * Ingest telemetry packet(s) from simulator / ML Engine.
   */
  public async ingestTelemetry(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const validated = telemetryIngestSchema.parse(request.body);
    const result = await telemetryService.ingestTelemetry(validated);

    return reply.status(202).send({
      success: true,
      message: 'Telemetry payload ingested, broadcasted, and queued',
      result,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * GET /api/v1/assets
   * List all registered industrial assets enriched with live health status.
   */
  public async getAssets(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const assets = await telemetryService.getAllAssets();

    return reply.status(200).send({
      success: true,
      count: assets.length,
      data: assets,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * GET /api/v1/assets/:asset_id/metrics
   * Performance summary: MTBF, Shift kWh, Energy Waste Gap, Recent Incidents, Health Score.
   */
  public async getAssetMetrics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { asset_id } = assetIdParamSchema.parse(request.params);

    try {
      const summary = await telemetryService.getAssetMetricsSummary(asset_id);
      return reply.status(200).send({
        success: true,
        data: summary,
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Asset not found';
      return reply.status(404).send({
        success: false,
        error: {
          code: 'ASSET_NOT_FOUND',
          message,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * GET/POST /api/v1/telemetry/tick
   * High-precision 1 Hz serverless telemetry tick & real-time ML inference.
   */
  public async tick(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await telemetryEngine.generateTick();
    return reply.status(200).send(result);
  }

  /**
   * POST /api/v1/demo/simulate-failure
   * Toggle bearing wear degradation on target asset and configure alarm sensitivity.
   */
  public async simulateFailure(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = (request.body as Record<string, any>) || {};
    const enabled = typeof body.enabled === 'boolean'
      ? body.enabled
      : typeof body.simulate_failure === 'boolean'
        ? body.simulate_failure
        : true;
    const targetAsset = body.target_asset || 'MOTOR-03';
    const threshold = typeof body.anomaly_threshold === 'number'
      ? body.anomaly_threshold
      : typeof body.threshold === 'number'
        ? body.threshold
        : 0.8;

    const config = telemetryService.setSimulationConfig({
      enabled,
      target_asset: targetAsset,
      anomaly_threshold: threshold,
    });

    telemetryEngine.setSimulationConfig({
      enabled,
      target_asset: targetAsset,
      threshold,
    });

    return reply.status(200).send({
      success: true,
      message: `Failure simulation scenario ${config.enabled ? 'activated' : 'deactivated'} for target [${config.target_asset}]`,
      config,
      simulation: telemetryEngine.getSimulationState(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * GET /api/v1/demo/status
   * Read current failure simulation scenario and sensitivity threshold configuration.
   */
  public async getDemoStatus(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const config = telemetryService.getSimulationConfig();
    const simulation = telemetryEngine.getSimulationState();

    return reply.status(200).send({
      success: true,
      config,
      simulation,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * GET /api/v1/telemetry/latest
   * Fast in-memory cache lookup of all assets' current metrics.
   */
  public async getLatestMetrics(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const data = telemetryService.getAllLatestMetrics();
    return reply.status(200).send({
      success: true,
      count: data.length,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * GET /api/v1/telemetry/latest/:asset_id
   * Fast in-memory cache lookup of a single asset's current metrics.
   */
  public async getLatestAssetMetrics(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { asset_id } = assetIdParamSchema.parse(request.params);
    const metrics = telemetryService.getLatestMetrics(asset_id);

    if (!metrics) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'METRICS_NOT_FOUND',
          message: `No active cached telemetry found for asset ${asset_id}`,
        },
        timestamp: new Date().toISOString(),
      });
    }

    return reply.status(200).send({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    });
  }
}

export const telemetryController = new TelemetryController();

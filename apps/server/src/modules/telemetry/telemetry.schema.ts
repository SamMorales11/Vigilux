/**
 * Zod Validation Schemas for Telemetry & Asset Management APIs.
 */

import { z } from 'zod';

/**
 * Single telemetry reading schema with optional ML inference fields.
 */
export const telemetryPayloadSchema = z.object({
  asset_id: z.string().min(1, 'asset_id is required'),
  timestamp: z.string().or(z.date()).optional(),
  kw: z.coerce.number({ message: 'kw must be a valid number' }),
  rpm: z.coerce.number({ message: 'rpm must be a valid number' }),
  temp_c: z.coerce.number().optional(),
  bearing_temp: z.coerce.number().optional(),
  bearingTemp: z.coerce.number().optional(),
  vib_rms: z.coerce.number().optional(),
  vibration_rms: z.coerce.number().optional(),
  vibrationRms: z.coerce.number().optional(),
  pressure: z.coerce.number().default(0.0),
  predicted_kw: z.coerce.number().nullable().optional(),
  predictedKw: z.coerce.number().nullable().optional(),
  waste_gap_kw: z.coerce.number().nullable().optional(),
  wasteGapKw: z.coerce.number().nullable().optional(),
  waste_pct: z.coerce.number().nullable().optional(),
  wastePct: z.coerce.number().nullable().optional(),
  anomaly_score: z.coerce.number().nullable().optional(),
  anomalyScore: z.coerce.number().nullable().optional(),
  status: z.string().nullable().optional(),
  is_degraded: z.boolean().optional(),
  degradation_pct: z.coerce.number().optional(),
});

/**
 * Ingestion input can be a single telemetry payload or a batch array.
 */
export const telemetryIngestSchema = z.union([
  telemetryPayloadSchema,
  z.array(telemetryPayloadSchema).min(1, 'Array must contain at least 1 reading'),
]);

/**
 * URL parameter validation for :asset_id
 */
export const assetIdParamSchema = z.object({
  asset_id: z.string().min(1, 'asset_id parameter is required'),
});

/**
 * Request body for POST /api/v1/demo/simulate-failure
 */
export const simulateFailureSchema = z.object({
  enabled: z.boolean({ message: 'enabled boolean field is required' }),
  target_asset: z.string().default('MOTOR-03').optional(),
  anomaly_threshold: z.coerce
    .number()
    .min(0.0, 'Threshold must be between 0.0 and 1.0')
    .max(1.0, 'Threshold must be between 0.0 and 1.0')
    .optional(),
  warning_threshold: z.coerce
    .number()
    .min(0.0)
    .max(1.0)
    .optional(),
  cooldown_period_seconds: z.coerce
    .number()
    .positive('Cooldown period must be positive')
    .optional(),
});

export type TelemetryPayloadDto = z.infer<typeof telemetryPayloadSchema>;
export type TelemetryIngestDto = z.infer<typeof telemetryIngestSchema>;
export type AssetIdParamDto = z.infer<typeof assetIdParamSchema>;
export type SimulateFailureDto = z.infer<typeof simulateFailureSchema>;

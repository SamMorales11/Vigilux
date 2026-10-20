import {
  pgTable,
  varchar,
  text,
  doublePrecision,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * 1. ASSET REGISTRY
 * Menyimpan konfigurasi dan metadata aset mesin industri:
 * id, name, type, rated_kw, iso_vibration_limit, status, created_at, updated_at
 */
export const assetRegistry = pgTable('asset_registry', {
  id: varchar('id', { length: 50 }).primaryKey(), // Contoh: 'MOTOR-01', 'PUMP-01'
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // Motor, Pump, Compressor, dll.
  ratedKw: doublePrecision('rated_kw').notNull(),
  isoVibrationLimit: doublePrecision('iso_vibration_limit').notNull(),
  status: varchar('status', { length: 50 }).default('operational').notNull(), // operational, warning, critical, maintenance
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 2. SENSOR TELEMETRY
 * Menyimpan data time-series sensor:
 * id, asset_id, timestamp (dengan index B-tree dan BRIN), kw, rpm, bearing_temp,
 * vibration_rms, pressure, predicted_kw, waste_gap_kw, anomaly_score
 */
export const sensorTelemetry = pgTable(
  'sensor_telemetry',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: varchar('asset_id', { length: 50 })
      .notNull()
      .references(() => assetRegistry.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    kw: doublePrecision('kw').notNull(),
    rpm: doublePrecision('rpm').notNull(),
    bearingTemp: doublePrecision('bearing_temp').notNull(),
    vibrationRms: doublePrecision('vibration_rms').notNull(),
    pressure: doublePrecision('pressure').notNull(),
    predictedKw: doublePrecision('predicted_kw'),
    wasteGapKw: doublePrecision('waste_gap_kw'),
    anomalyScore: doublePrecision('anomaly_score'),
  },
  (table) => [
    index('sensor_telemetry_asset_id_idx').on(table.assetId),
    index('sensor_telemetry_timestamp_idx').on(table.timestamp),
    index('sensor_telemetry_timestamp_brin_idx').using('brin', table.timestamp),
    index('sensor_telemetry_asset_time_idx').on(table.assetId, table.timestamp),
  ]
);

/**
 * 3. ANOMALY INCIDENTS
 * Menyimpan data deteksi anomali operasional dan estimasi biaya pemborosan energi:
 * id, asset_id, timestamp, anomaly_score, waste_kw, estimated_cost_per_hr, diagnostic_message
 */
export const anomalyIncidents = pgTable(
  'anomaly_incidents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: varchar('asset_id', { length: 50 })
      .notNull()
      .references(() => assetRegistry.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    anomalyScore: doublePrecision('anomaly_score').notNull(),
    wasteKw: doublePrecision('waste_kw').notNull(),
    estimatedCostPerHr: doublePrecision('estimated_cost_per_hr').notNull(),
    diagnosticMessage: text('diagnostic_message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('anomaly_incidents_asset_id_idx').on(table.assetId),
    index('anomaly_incidents_timestamp_idx').on(table.timestamp),
  ]
);

/**
 * Tabel Users (untuk modul autentikasi / pengguna sistem)
 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Relasi antar tabel Drizzle ORM
 */
export const assetRegistryRelations = relations(assetRegistry, ({ many }) => ({
  telemetries: many(sensorTelemetry),
  incidents: many(anomalyIncidents),
}));

export const sensorTelemetryRelations = relations(sensorTelemetry, ({ one }) => ({
  asset: one(assetRegistry, {
    fields: [sensorTelemetry.assetId],
    references: [assetRegistry.id],
  }),
}));

export const anomalyIncidentsRelations = relations(anomalyIncidents, ({ one }) => ({
  asset: one(assetRegistry, {
    fields: [anomalyIncidents.assetId],
    references: [assetRegistry.id],
  }),
}));

// Type Definitions
export type Asset = typeof assetRegistry.$inferSelect;
export type NewAsset = typeof assetRegistry.$inferInsert;

export type SensorTelemetry = typeof sensorTelemetry.$inferSelect;
export type NewSensorTelemetry = typeof sensorTelemetry.$inferInsert;

export type AnomalyIncident = typeof anomalyIncidents.$inferSelect;
export type NewAnomalyIncident = typeof anomalyIncidents.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

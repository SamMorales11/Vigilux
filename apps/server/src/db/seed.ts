import { db, closeDatabaseConnection } from './index.js';
import {
  assetRegistry,
  sensorTelemetry,
  anomalyIncidents,
  type NewAsset,
  type NewSensorTelemetry,
  type NewAnomalyIncident,
} from './schema.js';

/**
 * Data awal mesin industri (Industrial Assets)
 */
const initialAssets: NewAsset[] = [
  {
    id: 'MOTOR-01',
    name: 'Induction Motor #01 (Primary Conveyor)',
    type: 'Motor',
    ratedKw: 75.0,
    isoVibrationLimit: 4.5,
    status: 'operational',
  },
  {
    id: 'MOTOR-02',
    name: 'Induction Motor #02 (Cooling Fan Drive)',
    type: 'Motor',
    ratedKw: 45.0,
    isoVibrationLimit: 4.5,
    status: 'operational',
  },
  {
    id: 'MOTOR-03',
    name: 'Induction Motor #03 (Heavy Crusher)',
    type: 'Motor',
    ratedKw: 110.0,
    isoVibrationLimit: 7.1,
    status: 'warning',
  },
  {
    id: 'PUMP-01',
    name: 'Centrifugal Slurry Pump #01',
    type: 'Pump',
    ratedKw: 55.0,
    isoVibrationLimit: 4.5,
    status: 'operational',
  },
  {
    id: 'COMP-01',
    name: 'Rotary Screw Air Compressor #01',
    type: 'Compressor',
    ratedKw: 90.0,
    isoVibrationLimit: 3.5,
    status: 'critical',
  },
];

/**
 * Data awal sensor telemetry untuk setiap mesin industri
 */
function generateInitialTelemetries(now: Date): NewSensorTelemetry[] {
  return [
    {
      assetId: 'MOTOR-01',
      timestamp: new Date(now.getTime() - 1000 * 60 * 5),
      kw: 68.4,
      rpm: 1485.0,
      bearingTemp: 58.2,
      vibrationRms: 2.1,
      pressure: 0.0,
      predictedKw: 67.8,
      wasteGapKw: 0.6,
      anomalyScore: 0.08,
    },
    {
      assetId: 'MOTOR-02',
      timestamp: new Date(now.getTime() - 1000 * 60 * 4),
      kw: 39.8,
      rpm: 2950.0,
      bearingTemp: 52.0,
      vibrationRms: 1.8,
      pressure: 0.0,
      predictedKw: 40.1,
      wasteGapKw: 0.0,
      anomalyScore: 0.05,
    },
    {
      assetId: 'MOTOR-03',
      timestamp: new Date(now.getTime() - 1000 * 60 * 3),
      kw: 104.5,
      rpm: 1470.0,
      bearingTemp: 84.7,
      vibrationRms: 6.8,
      pressure: 0.0,
      predictedKw: 89.3,
      wasteGapKw: 15.2,
      anomalyScore: 0.76,
    },
    {
      assetId: 'PUMP-01',
      timestamp: new Date(now.getTime() - 1000 * 60 * 2),
      kw: 48.2,
      rpm: 1750.0,
      bearingTemp: 61.4,
      vibrationRms: 3.2,
      pressure: 6.2,
      predictedKw: 47.9,
      wasteGapKw: 0.3,
      anomalyScore: 0.12,
    },
    {
      assetId: 'COMP-01',
      timestamp: new Date(now.getTime() - 1000 * 60 * 1),
      kw: 88.9,
      rpm: 3200.0,
      bearingTemp: 92.6,
      vibrationRms: 5.4,
      pressure: 9.8,
      predictedKw: 66.4,
      wasteGapKw: 22.5,
      anomalyScore: 0.94,
    },
  ];
}

/**
 * Data awal insiden anomali terdeteksi
 */
function generateInitialIncidents(now: Date): NewAnomalyIncident[] {
  return [
    {
      assetId: 'MOTOR-03',
      timestamp: new Date(now.getTime() - 1000 * 60 * 3),
      anomalyScore: 0.76,
      wasteKw: 15.2,
      estimatedCostPerHr: 22.8,
      diagnosticMessage:
        'Elevated bearing temperature (84.7°C) with noticeable load gap (+15.2 kW above predicted baseline). Vibration approaching ISO 7.1 mm/s limit.',
    },
    {
      assetId: 'COMP-01',
      timestamp: new Date(now.getTime() - 1000 * 60 * 1),
      anomalyScore: 0.94,
      wasteKw: 22.5,
      estimatedCostPerHr: 33.75,
      diagnosticMessage:
        'CRITICAL: Discharge pressure surge (9.8 bar) with vibration exceeding threshold (5.4 mm/s vs 3.5 mm/s limit). Thermal runaway risk in main bearing.',
    },
  ];
}

export async function runSeed(): Promise<void> {
  console.log('====================================================');
  console.log('🌱 Starting Database Seeding (Neon PostgreSQL)...');
  console.log('====================================================');

  const now = new Date();

  try {
    // 1. Seed Asset Registry (Idempotent upsert by id)
    console.log(`📦 Seeding ${initialAssets.length} Industrial Assets...`);
    for (const asset of initialAssets) {
      await db
        .insert(assetRegistry)
        .values(asset)
        .onConflictDoUpdate({
          target: assetRegistry.id,
          set: {
            name: asset.name,
            type: asset.type,
            ratedKw: asset.ratedKw,
            isoVibrationLimit: asset.isoVibrationLimit,
            status: asset.status,
            updatedAt: now,
          },
        });
      console.log(`   ✔ Asset [${asset.id}] - ${asset.name} (${asset.status})`);
    }

    // 2. Seed Sensor Telemetry
    const telemetries = generateInitialTelemetries(now);
    console.log(`📡 Seeding ${telemetries.length} Sensor Telemetry records...`);
    await db.insert(sensorTelemetry).values(telemetries);
    console.log('   ✔ Telemetry data successfully recorded.');

    // 3. Seed Anomaly Incidents
    const incidents = generateInitialIncidents(now);
    console.log(`⚠️  Seeding ${incidents.length} Anomaly Incidents...`);
    await db.insert(anomalyIncidents).values(incidents);
    for (const inc of incidents) {
      console.log(`   ✔ Incident on [${inc.assetId}] - Score: ${inc.anomalyScore} (Waste: ${inc.wasteKw} kW)`);
    }

    console.log('====================================================');
    console.log('✅ Database Seeding completed successfully!');
    console.log('====================================================');
  } catch (error) {
    console.error('❌ Error during database seeding:', error);
    throw error;
  } finally {
    await closeDatabaseConnection();
  }
}

// Auto-run if executed directly via tsx/node
runSeed().catch(() => {
  process.exit(1);
});

/**
 * Industrial machinery baseline profiles and parameters.
 */

export interface MachineProfile {
  id: string;
  name: string;
  type: string;
  ratedKw: number;
  baseKw: number;
  baseRpm: number;
  baseTempC: number;
  baseVibRms: number;
  basePressure: number;
  isoVibrationLimit: number;
  nomBaselineKw: number; // Steady LightGBM baseline prediction under nominal conditions
}

export const MACHINE_PROFILES: MachineProfile[] = [
  {
    id: 'MOTOR-01',
    name: 'Induction Motor #01 (Primary Conveyor)',
    type: 'Motor',
    ratedKw: 75.0,
    baseKw: 66.5,
    baseRpm: 1485.0,
    baseTempC: 58.0,
    baseVibRms: 2.1,
    basePressure: 0.0,
    isoVibrationLimit: 4.5,
    nomBaselineKw: 67.5,
  },
  {
    id: 'MOTOR-02',
    name: 'Induction Motor #02 (Cooling Fan Drive)',
    type: 'Motor',
    ratedKw: 45.0,
    baseKw: 38.2,
    baseRpm: 1490.0,
    baseTempC: 52.0,
    baseVibRms: 1.8,
    basePressure: 0.0,
    isoVibrationLimit: 4.5,
    nomBaselineKw: 38.0,
  },
  {
    id: 'MOTOR-03',
    name: 'Induction Motor #03 (Heavy Crusher)',
    type: 'Motor',
    ratedKw: 110.0,
    baseKw: 85.5,
    baseRpm: 1475.0,
    baseTempC: 65.0,
    baseVibRms: 2.2,
    basePressure: 0.0,
    isoVibrationLimit: 4.5, // Aligned with ISO 10816-3 Class II
    nomBaselineKw: 78.0,   // Steady LightGBM baseline (~77.8 - 78.2 kW)
  },
  {
    id: 'PUMP-01',
    name: 'Centrifugal Slurry Pump #01',
    type: 'Pump',
    ratedKw: 55.0,
    baseKw: 42.0,
    baseRpm: 2950.0,
    baseTempC: 61.0,
    baseVibRms: 2.8,
    basePressure: 6.2,
    isoVibrationLimit: 4.5,
    nomBaselineKw: 41.5,
  },
  {
    id: 'COMP-01',
    name: 'Rotary Screw Air Compressor #01',
    type: 'Compressor',
    ratedKw: 90.0,
    baseKw: 74.5,
    baseRpm: 2980.0,
    baseTempC: 78.0,
    baseVibRms: 3.1,
    basePressure: 7.8,
    isoVibrationLimit: 3.5,
    nomBaselineKw: 73.8,
  },
];

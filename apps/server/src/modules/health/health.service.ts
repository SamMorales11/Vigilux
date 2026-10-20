import { checkDatabaseConnection } from '../../db/index.js';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  timestamp: string;
  services: {
    database: 'connected' | 'disconnected';
  };
}

export class HealthService {
  async check(): Promise<HealthStatus> {
    const isDbConnected = await checkDatabaseConnection();
    return {
      status: isDbConnected ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      services: {
        database: isDbConnected ? 'connected' : 'disconnected',
      },
    };
  }
}

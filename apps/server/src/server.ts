/**
 * Server Bootstrap & Lifecycle Management.
 *
 * Starts the Fastify server, binds network listeners,
 * verifies database connectivity, and handles graceful shutdowns.
 */

import { buildApp } from './app.js';
import { env } from './config/index.js';
import { checkDatabaseConnection, closeDatabaseConnection } from './db/index.js';
import { wsHub } from './modules/telemetry/ws-hub.js';
import { telemetryService } from './modules/telemetry/telemetry.service.js';

async function bootstrap(): Promise<void> {
  console.log('====================================================');
  console.log(`🚀 Vigilux Fastify Server Bootstrapping [${env.NODE_ENV}]`);
  console.log('====================================================');

  // Verify database connection at startup
  const isDbReady = await checkDatabaseConnection();
  if (isDbReady) {
    console.log('✔ Neon PostgreSQL Database: CONNECTED');
  } else {
    console.warn('⚠️ Neon PostgreSQL Database: DISCONNECTED (Degraded Mode)');
  }

  // Build configured Fastify instance
  const app = await buildApp();

  try {
    const address = await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    console.log(`📡 HTTP Server running on: ${address}`);
    console.log(`🔌 WebSocket Stream live at: ${address.replace(/^http/, 'ws')}/ws/telemetry/live`);
    console.log(`🩺 Health check available at: ${address}/health`);
    console.log('====================================================');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown lifecycle management
  let isShuttingDown = false;

  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);

    try {
      // 1. Terminate WebSocket client connections
      console.log(' - Disposing WebSocket Hub...');
      wsHub.dispose();

      // 2. Flush remaining micro-batching telemetry buffer to database
      console.log(' - Flushing telemetry queue to PostgreSQL...');
      await telemetryService.dispose();

      // 3. Close Fastify HTTP server
      console.log(' - Closing Fastify HTTP Server...');
      await app.close();

      // 4. Close Database connection pool
      console.log(' - Closing Neon PostgreSQL connection pool...');
      await closeDatabaseConnection();

      console.log('👋 Vigilux Server gracefully shut down.');
      process.exit(0);
    } catch (shutdownError) {
      console.error('❌ Error during shutdown:', shutdownError);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void handleShutdown('SIGINT'));
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    void handleShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    void handleShutdown('unhandledRejection');
  });
}

bootstrap().catch((err: unknown) => {
  console.error('❌ Fatal bootstrap failure:', err);
  process.exit(1);
});

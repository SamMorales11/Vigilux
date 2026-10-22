/**
 * Fastify Application Factory & Core Server Configuration.
 *
 * Configures CORS, WebSocket streaming, global error handlers,
 * API route registration, and base health diagnostics using Clean Architecture principles.
 */

import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { env } from './config/index.js';
import { wsHub } from './modules/telemetry/ws-hub.js';
import { telemetryRoutes } from './modules/telemetry/telemetry.routes.js';
import { telemetryService } from './modules/telemetry/telemetry.service.js';
import { checkDatabaseConnection } from './db/index.js';

export async function buildApp(options: { isServerless?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV !== 'production'
          ? {
              target: 'pino/file',
              options: { destination: 1 }, // stdout
            }
          : undefined,
    },
  });

  // 1. Configure CORS
  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
  });

  // 2. Configure WebSocket Engine (only in persistent/local runtime, skip in serverless)
  if (!options.isServerless) {
    await app.register(websocket, {
      options: {
        maxPayload: 1024 * 1024, // 1MB limit for packets
      },
    });

    // 3. Register WebSocket Route: WS /ws/telemetry/live
    app.get('/ws/telemetry/live', { websocket: true }, (socket, req) => {
      wsHub.handleConnection(socket, req);
    });
  }

  // 4. Global Error Handler
  app.setErrorHandler((error: FastifyError | Error | unknown, request, reply) => {
    request.log.error(error);

    // Handle Zod Validation Errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request payload or query parameter validation failed',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
        timestamp: new Date().toISOString(),
      });
    }

    const err = error as Partial<FastifyError> & { message?: string };

    // Handle standard Fastify / HTTP errors
    const statusCode =
      typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;

    const isInternal = statusCode === 500;
    const message =
      isInternal && env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : err.message || 'An unexpected error occurred';

    return reply.status(statusCode).send({
      success: false,
      error: {
        code: err.code || (isInternal ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR'),
        message,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // 5. Global 404 Not Found Handler
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Resource ${request.method} ${request.url} not found`,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // 6. Register Modular PRD API Routes
  await app.register(telemetryRoutes);

  // 7. Base Diagnostic & Health Routes
  const getRootInfo = async () => ({
    service: 'Vigilux Industrial IoT Server',
    status: 'online',
    environment: env.NODE_ENV,
    runtime: options.isServerless ? 'Vercel Serverless Function' : 'Node.js Daemon',
    architecture: 'Hybrid Serverless & WebSocket',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });

  app.get('/', getRootInfo);
  app.get('/api', getRootInfo);

  const getHealthInfo = async () => {
    const isDbConnected = await checkDatabaseConnection();
    return {
      status: isDbConnected ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database: isDbConnected ? 'connected' : 'disconnected (in-memory mode)',
      websocketClients: wsHub.clientCount,
      bufferedTelemetryQueue: telemetryService.queuedCount,
      cachedAssetsCount: telemetryService.getAllLatestMetrics().length,
      mode: options.isServerless ? 'serverless' : 'persistent',
    };
  };

  app.get('/health', getHealthInfo);
  app.get('/api/health', getHealthInfo);

  return app;
}

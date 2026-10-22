/**
 * Vercel Serverless Function Entrypoint for Vigilux Backend API.
 *
 * Boots Fastify in hybrid serverless mode (cached per lambda instance container),
 * with high-precision in-memory & Neon PostgreSQL telemetry simulation and ML inference.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../apps/server/src/app.js';

let cachedApp: FastifyInstance | null = null;
let initPromise: Promise<FastifyInstance> | null = null;

async function getFastifyServerless(): Promise<FastifyInstance> {
  if (cachedApp) return cachedApp;

  if (!initPromise) {
    initPromise = (async () => {
      const app = await buildApp({ isServerless: true });
      await app.ready();
      cachedApp = app;
      return app;
    })();
  }

  return initPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Normalize URL in case Vercel rewrites stripped the path
  const forwardUri = req.headers['x-forwarded-uri'] as string | undefined;
  if (forwardUri && (!req.url || req.url === '/api' || req.url === '/api/')) {
    req.url = forwardUri;
  }

  try {
    const app = await getFastifyServerless();
    app.server.emit('request', req, res);
  } catch (error: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: 'SERVERLESS_FUNCTION_ERROR',
          message: error?.message || 'Internal Serverless Execution Error',
        },
        timestamp: new Date().toISOString(),
      })
    );
  }
}

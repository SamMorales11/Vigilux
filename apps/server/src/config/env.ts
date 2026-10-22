import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Support loading .env from CWD or server root
loadDotenv();
try {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  loadDotenv({ path: path.resolve(currentDir, '../../.env') });
} catch {
  // Ignore fallback error
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/vigilux'),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;

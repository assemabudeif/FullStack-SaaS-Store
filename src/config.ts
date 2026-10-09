import 'dotenv/config';

export interface Config {
  nodeEnv: string;
  host: string;
  port: number;
  jwtSecret: string;
  databaseUrl?: string;
  dataDir: string;
  corsOrigins: string[];
  sandboxBilling: boolean;
  logger: boolean | { level: string };
  paymobApiKey?: string;
  paymobIntegrationId?: number;
  paymobIframeId?: number;
  paymobHmac?: string;
}

export function loadConfig(): Config {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test, or production.');
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith('replace-')) {
    throw new Error('Set JWT_SECRET to a random value of at least 32 characters. See .env.example.');
  }
  if (nodeEnv === 'production' && !process.env.DATABASE_URL) {
    throw new Error('Production requires DATABASE_URL (PostgreSQL).');
  }
  if (nodeEnv === 'production' && process.env.ENABLE_SANDBOX_BILLING === 'true') {
    throw new Error('Sandbox billing must be disabled in production.');
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  return {
    nodeEnv, jwtSecret, port, host: process.env.HOST ?? '127.0.0.1',
    databaseUrl: process.env.DATABASE_URL || undefined,
    dataDir: process.env.PGLITE_DATA_DIR ?? './data/postgres',
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    sandboxBilling: process.env.ENABLE_SANDBOX_BILLING === 'true',
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    paymobApiKey: process.env.PAYMOB_API_KEY || undefined,
    paymobIntegrationId: process.env.PAYMOB_INTEGRATION_ID ? Number(process.env.PAYMOB_INTEGRATION_ID) : undefined,
    paymobIframeId: process.env.PAYMOB_IFRAME_ID ? Number(process.env.PAYMOB_IFRAME_ID) : undefined,
    paymobHmac: process.env.PAYMOB_HMAC || undefined,
  };
}

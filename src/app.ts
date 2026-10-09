import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Config } from './config.js';
import { connectDatabase, type Database } from './db/database.js';
import { migrate } from './db/migrate.js';
import { ApiError } from './lib/errors.js';
import { tenantRoutes } from './lib/context.js';
import { authRoutes } from './modules/auth.js';
import { storeRoutes } from './modules/stores.js';
import { catalogRoutes } from './modules/catalog.js';
import { customerRoutes } from './modules/customers.js';
import { orderRoutes } from './modules/orders.js';
import { analyticsRoutes } from './modules/analytics.js';
import { checkoutRoutes } from './modules/checkout.js';

export async function buildApp(config: Config, database?: Database) {
  const app = Fastify({
    logger: config.logger ? { ...(typeof config.logger === 'object' ? config.logger : {}),
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.refreshToken'] } : false,
    bodyLimit: 1024 * 1024,
    // Reject unexpected properties rather than silently stripping them.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array' } },
    requestTimeout: 30000,
  });
  const db = database ?? await connectDatabase(config);
  app.decorate('db', db);
  app.decorate('config', config);
  app.decorateRequest('identity', null);
  app.decorateRequest('tenant', null);
  app.decorateRequest('allowedRoles', null);
  app.addHook('onClose', async () => { await db.close(); });
  try {
    await migrate(db);
    await app.register(cors, { origin: config.corsOrigins, exposedHeaders: ['X-Request-ID', 'Idempotency-Replayed'] });
    await app.register(helmet);
    await app.register(rateLimit, {
      max: 120, timeWindow: '1 minute',
      // A Redis-backed limiter is required before horizontally scaling.
    });
    await app.register(jwt, {
      secret: config.jwtSecret,
      sign: { iss: 'advanced-store-saas', aud: 'advanced-store-api' },
      verify: { allowedIss: 'advanced-store-saas', allowedAud: 'advanced-store-api', algorithms: ['HS256'] },
    });
    await app.register(swagger, {
      openapi: {
        info: { title: 'Advanced Store SaaS API', version: '1.0.0',
          description: 'Tenant-scoped store management. Use Bearer auth and X-Tenant-ID for private store APIs. Amounts are integer cents.' },
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      },
      transform: ({ schema, url }) => {
        if (url.startsWith('/api/v1/') && !url.includes('/auth/') && !url.includes('/storefront/') && !url.includes('/payments/')) {
          return { url, schema: { ...schema, security: [{ bearerAuth: [] }],
            headers: { type: 'object', properties: { 'x-tenant-id': { type: 'string', format: 'uuid' },
              ...((schema.headers as any)?.properties ?? {}) },
              required: ['x-tenant-id', ...((schema.headers as any)?.required ?? [])] },
          } };
        }
        return { schema, url };
      },
    });
    await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
    app.addHook('onRequest', async (request, reply) => { reply.header('X-Request-ID', request.id); });
    app.setErrorHandler((error: any, request, reply) => {
      let status = 500, code = 'INTERNAL_ERROR', message = 'An unexpected error occurred.';
      if (error instanceof ApiError) {
        status = error.statusCode; code = error.code; message = error.message;
      } else if (error.validation) {
        status = 400; code = 'VALIDATION_ERROR'; message = error.message;
      } else if (error.code === '23505') {
        status = 409; code = 'CONFLICT'; message = 'A record with these unique values already exists.';
      } else if (error.code === '23503') {
        status = 409; code = 'REFERENCE_CONFLICT'; message = 'Resource is referenced or a related resource is unavailable.';
      } else if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        status = error.statusCode; code = status === 429 ? 'RATE_LIMITED' : 'REQUEST_ERROR'; message = error.message;
      } else { request.log.error({ err: error }, 'Request failed'); }
      reply.code(status).send({ error: { code, message, requestId: request.id } });
    });
    app.setNotFoundHandler((request, reply) => reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: request.id },
    }));
    app.get('/health', { schema: { tags: ['Health'] } }, async () => ({ status: 'ok' }));
    app.get('/ready', { schema: { tags: ['Health'] } }, async () => {
      await db.query('SELECT 1');
      return { status: 'ready' };
    });
    await app.register(authRoutes);
    tenantRoutes(app, async (scope) => {
      await storeRoutes(scope); await catalogRoutes(scope); await customerRoutes(scope);
      await orderRoutes(scope); await analyticsRoutes(scope);
    });
    await app.register(checkoutRoutes);
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

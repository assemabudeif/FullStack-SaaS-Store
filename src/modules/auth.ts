import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Sql } from '../db/database.js';
import { authenticate } from '../lib/context.js';
import { ApiError } from '../lib/errors.js';
import { digest, hashPassword, refreshToken, verifyPassword } from '../lib/security.js';
import { Email, Obj, Password, Text, Type } from '../lib/schemas.js';

async function issueSession(app: FastifyInstance, tx: Sql, userId: string) {
  const id = randomUUID();
  const refresh = refreshToken();
  await tx.query("INSERT INTO sessions(id,user_id,refresh_hash,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",
    [id, userId, digest(refresh)]);
  return {
    accessToken: app.jwt.sign({ sub: userId, sid: id }, { expiresIn: '15m' }),
    refreshToken: refresh, tokenType: 'Bearer', expiresIn: 900,
  };
}

export async function authRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const authRate = { rateLimit: { max: 10, timeWindow: '1 minute' } };
  app.post('/api/v1/auth/register', {
    config: authRate,
    schema: { tags: ['Auth'], summary: 'Create an account and its first store', body: Obj({
      name: Text(100), email: Email, password: Password, storeName: Text(100),
      storeSlug: Type.String({ minLength: 3, maxLength: 60, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
      currency: Type.Optional(Type.Union([Type.Literal('USD'), Type.Literal('EUR'), Type.Literal('GBP'), Type.Literal('EGP')])),
    }) },
  }, async (request, reply) => {
    const body = request.body;
    // Do expensive hashing outside the transaction.
    const passwordHash = await hashPassword(body.password);
    const result = await app.db.transaction(async (tx) => {
      const userId = randomUUID(), tenantId = randomUUID();
      await tx.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',
        [userId, body.email.toLowerCase(), body.name, passwordHash]);
      await tx.query('INSERT INTO tenants(id,name,slug,currency) VALUES($1,$2,$3,$4)',
        [tenantId, body.storeName, body.storeSlug, body.currency ?? 'USD']);
      await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [tenantId, userId]);
      await tx.query('INSERT INTO subscriptions(tenant_id) VALUES($1)', [tenantId]);
      return { user: { id: userId, name: body.name, email: body.email.toLowerCase() },
        store: { id: tenantId, name: body.storeName, slug: body.storeSlug }, ...await issueSession(app, tx, userId) };
    });
    return reply.code(201).send(result);
  });

  // A fixed dummy hash keeps unknown-email login on the same scrypt path.
  const dummyHash = await hashPassword(randomUUID());
  app.post('/api/v1/auth/login', {
    config: authRate,
    schema: { tags: ['Auth'], body: Obj({ email: Email, password: Type.String({ minLength: 1, maxLength: 128 }) }) },
  }, async (request) => {
    const [user] = await app.db.query('SELECT * FROM users WHERE email=$1', [request.body.email.toLowerCase()]);
    const valid = await verifyPassword(request.body.password, user?.password_hash ?? dummyHash);
    if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    const tokens = await app.db.transaction((tx) => issueSession(app, tx, user.id));
    return { user: { id: user.id, email: user.email, name: user.name }, ...tokens };
  });

  app.post('/api/v1/auth/refresh', {
    config: authRate,
    schema: { tags: ['Auth'], summary: 'Rotate a single-use refresh token', body: Obj({
      refreshToken: Type.String({ minLength: 32, maxLength: 200 }),
    }) },
  }, async (request) => app.db.transaction(async (tx) => {
    const [session] = await tx.query(
      'SELECT * FROM sessions WHERE refresh_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',
      [digest(request.body.refreshToken)],
    );
    if (!session) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token expired, revoked, or already used.');
    await tx.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [session.id]);
    return issueSession(app, tx, session.user_id);
  }));
  app.post('/api/v1/auth/logout', {
    preHandler: authenticate, schema: { tags: ['Auth'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    await app.db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [request.identity!.sessionId]);
    return reply.code(204).send();
  });
  app.get('/api/v1/auth/me', {
    preHandler: authenticate, schema: { tags: ['Auth'], security: [{ bearerAuth: [] }] },
  }, async (request) => {
    const [user] = await app.db.query('SELECT id,email,name,created_at FROM users WHERE id=$1', [request.identity!.userId]);
    const stores = await app.db.query(
      'SELECT t.*,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=$1 ORDER BY t.created_at',
      [request.identity!.userId]);
    return { user, stores };
  });
}

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database, Sql } from '../db/database.js';
import type { Config } from '../config.js';
import { ApiError, notFound } from './errors.js';

declare module 'fastify' {
  interface FastifyInstance { db: Database; config: Config; }
  interface FastifyRequest {
    identity: { userId: string; sessionId: string } | null;
    tenant: { id: string; role: string } | null;
    allowedRoles: string[] | null;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT { payload: { sub: string; sid: string }; user: { sub: string; sid: string }; }
}

export async function authenticate(request: FastifyRequest): Promise<void> {
  try { await request.jwtVerify(); }
  catch { throw new ApiError(401, 'UNAUTHORIZED', 'A valid access token is required.'); }
  const [session] = await request.server.db.query(
    'SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at > now()',
    [request.user.sid, request.user.sub],
  );
  if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Session expired or revoked.');
  request.identity = { userId: request.user.sub, sessionId: request.user.sid };
}

export async function tenantContext(request: FastifyRequest): Promise<void> {
  await authenticate(request);
  const id = request.headers['x-tenant-id'];
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiError(400, 'TENANT_REQUIRED', 'Supply a UUID in the X-Tenant-ID header.');
  }
  const [membership] = await request.server.db.query(
    'SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2', [id, request.identity!.userId],
  );
  if (!membership) notFound('Store');
  request.tenant = { id, role: membership.role };
}
export function permit(...roles: string[]) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.tenant || !roles.includes(request.tenant.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Your store role cannot perform this action.');
    }
    request.allowedRoles = roles;
  };
}
export const writers = permit('owner', 'admin', 'staff');
export const admins = permit('owner', 'admin');
export const owner = permit('owner');

export async function audit(tx: Sql, request: FastifyRequest, action: string, entityId?: string, details = {}) {
  await tx.query('INSERT INTO audit_logs(id,tenant_id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), request.tenant!.id, request.identity!.userId, action, entityId ?? null, JSON.stringify(details)]);
}

export const plans = {
  free: { products: 50, members: 3, ordersPerMonth: 100 },
  pro: { products: 1000, members: 15, ordersPerMonth: 5000 },
  business: { products: 10000, members: 100, ordersPerMonth: 50000 },
} as const;

export async function lockStore(tx: Sql, tenantId: string) {
  const [store] = await tx.query('SELECT * FROM tenants WHERE id=$1 FOR UPDATE', [tenantId]);
  if (!store) notFound('Store');
  return store;
}

// Recheck authorization AFTER obtaining the store lock. Otherwise a request
// queued behind a member's removal could still execute with its old role.
export async function storeTransaction<T>(app: FastifyInstance, request: FastifyRequest, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return app.db.transaction(async (tx) => {
    if (request.method !== 'GET') {
      await lockStore(tx, request.tenant!.id);
      const [member] = await tx.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2',
        [request.tenant!.id, request.identity!.userId]);
      if (!member || !request.allowedRoles?.includes(member.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Store access was removed or your role changed.');
      }
      const [subscription] = await tx.query('SELECT status FROM subscriptions WHERE tenant_id=$1', [request.tenant!.id]);
      if (subscription?.status !== 'active') {
        throw new ApiError(403, 'SUBSCRIPTION_INACTIVE', 'Subscription is inactive; the store is read-only.');
      }
    }
    return fn(tx);
  });
}
export async function enforceQuota(tx: Sql, tenantId: string, resource: 'products' | 'members' | 'ordersPerMonth') {
  const [subscription] = await tx.query('SELECT * FROM subscriptions WHERE tenant_id=$1', [tenantId]);
  if (!subscription || subscription.status !== 'active') throw new ApiError(403, 'SUBSCRIPTION_INACTIVE', 'Subscription is inactive.');
  const plan = plans[subscription.plan as keyof typeof plans];
  const queries = {
    products: 'SELECT count(*)::int AS count FROM products WHERE tenant_id=$1 AND active=true',
    members: 'SELECT count(*)::int AS count FROM memberships WHERE tenant_id=$1',
    ordersPerMonth: "SELECT count(*)::int AS count FROM orders WHERE tenant_id=$1 AND created_at >= date_trunc('month',now())",
  };
  const [usage] = await tx.query(queries[resource], [tenantId]);
  if (usage!.count >= plan[resource]) throw new ApiError(403, 'PLAN_LIMIT', `Your ${subscription.plan} plan's ${resource} limit has been reached.`);
}

export function tenantRoutes(app: FastifyInstance, plugin: (scope: FastifyInstance) => Promise<void>) {
  app.register(async (scope) => {
    scope.addHook('preHandler', tenantContext);
    await plugin(scope);
  }, { prefix: '/api/v1' });
}

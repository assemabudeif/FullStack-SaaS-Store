import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { storeTransaction, admins, audit, enforceQuota, lockStore, owner, plans } from '../lib/context.js';
import { ApiError, conflict, notFound } from '../lib/errors.js';
import { Email, Id, Money, Obj, Pagination, Role, Text, Type } from '../lib/schemas.js';

export async function storeRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  app.get('/store', { schema: { tags: ['Store'] } }, async (r) => {
    const [store] = await app.db.query('SELECT * FROM tenants WHERE id=$1', [r.tenant!.id]);
    return { ...store, role: r.tenant!.role };
  });
  app.patch('/store', {
    preHandler: admins,
    schema: { tags: ['Store'], body: Obj({
      name: Type.Optional(Text(100)),
      taxBasisPoints: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
      shippingCents: Type.Optional(Money),
      paymobApiKey: Type.Optional(Type.String({ maxLength: 500 })),
      paymobIntegrationId: Type.Optional(Type.Integer({ minimum: 1 })),
      paymobIframeId: Type.Optional(Type.Integer({ minimum: 1 })),
      paymobHmac: Type.Optional(Type.String({ maxLength: 500 })),
    }) },
  }, async (r) => storeTransaction(app, r, async (tx) => {
    await lockStore(tx, r.tenant!.id);
    const [store] = await tx.query(`UPDATE tenants SET name=COALESCE($2,name),
      tax_basis_points=COALESCE($3,tax_basis_points), shipping_cents=COALESCE($4,shipping_cents),
      paymob_api_key=COALESCE($5,paymob_api_key), paymob_integration_id=COALESCE($6,paymob_integration_id),
      paymob_iframe_id=COALESCE($7,paymob_iframe_id), paymob_hmac=COALESCE($8,paymob_hmac)
      WHERE id=$1 RETURNING *`,
    [r.tenant!.id, r.body.name ?? null, r.body.taxBasisPoints ?? null, r.body.shippingCents ?? null,
      r.body.paymobApiKey ?? null, r.body.paymobIntegrationId ?? null, r.body.paymobIframeId ?? null, r.body.paymobHmac ?? null]);
    await audit(tx, r, 'store.updated', r.tenant!.id, r.body);
    return store;
  }));

  app.get('/members', { preHandler: admins, schema: { tags: ['Team'] } }, async (r) => ({
    data: await app.db.query(`SELECT u.id,u.name,u.email,m.role,m.created_at FROM memberships m
      JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 ORDER BY m.created_at`, [r.tenant!.id]),
  }));
  app.post('/members', {
    preHandler: owner, schema: { tags: ['Team'], summary: 'Add an existing registered account to this store',
      body: Obj({ email: Email, role: Type.Union([Type.Literal('admin'), Type.Literal('staff'), Type.Literal('viewer')]) }) },
  }, async (r, reply) => {
    const member = await storeTransaction(app, r, async (tx) => {
      await lockStore(tx, r.tenant!.id);
      await enforceQuota(tx, r.tenant!.id, 'members');
      const [user] = await tx.query('SELECT id,name,email FROM users WHERE email=$1', [r.body.email.toLowerCase()]);
      if (!user) notFound('Registered user');
      await tx.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [r.tenant!.id, user.id, r.body.role]);
      await audit(tx, r, 'member.added', user.id, { role: r.body.role });
      return { ...user, role: r.body.role };
    });
    return reply.code(201).send(member);
  });
  app.patch('/members/:id', {
    preHandler: owner, schema: { tags: ['Team'], params: Obj({ id: Id }), body: Obj({ role: Role }) },
  }, async (r) => storeTransaction(app, r, async (tx) => {
    await lockStore(tx, r.tenant!.id);
    const [existing] = await tx.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2',
      [r.tenant!.id, r.params.id]);
    if (!existing) notFound('Member');
    if (existing.role === 'owner' && r.body.role !== 'owner') {
      const [count] = await tx.query("SELECT count(*)::int AS count FROM memberships WHERE tenant_id=$1 AND role='owner'", [r.tenant!.id]);
      if (count!.count <= 1) conflict('A store must retain at least one owner.');
    }
    await tx.query('UPDATE memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2', [r.tenant!.id, r.params.id, r.body.role]);
    await audit(tx, r, 'member.role_changed', r.params.id, { role: r.body.role });
    return { id: r.params.id, role: r.body.role };
  }));
  app.delete('/members/:id', {
    preHandler: owner, schema: { tags: ['Team'], params: Obj({ id: Id }) },
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      await lockStore(tx, r.tenant!.id);
      const [member] = await tx.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2', [r.tenant!.id, r.params.id]);
      if (!member) notFound('Member');
      if (member.role === 'owner') {
        const [count] = await tx.query("SELECT count(*)::int AS count FROM memberships WHERE tenant_id=$1 AND role='owner'", [r.tenant!.id]);
        if (count!.count <= 1) conflict('A store must retain at least one owner.');
      }
      await tx.query('DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2', [r.tenant!.id, r.params.id]);
      await audit(tx, r, 'member.removed', r.params.id);
    });
    return reply.code(204).send();
  });

  app.get('/subscription', { preHandler: admins, schema: { tags: ['Subscriptions'] } }, async (r) => {
    const [subscription] = await app.db.query('SELECT * FROM subscriptions WHERE tenant_id=$1', [r.tenant!.id]);
    const [usage] = await app.db.query(`SELECT
      (SELECT count(*)::int FROM products WHERE tenant_id=$1 AND active) AS products,
      (SELECT count(*)::int FROM memberships WHERE tenant_id=$1) AS members,
      (SELECT count(*)::int FROM orders WHERE tenant_id=$1 AND created_at>=date_trunc('month',now())) AS "ordersPerMonth"`,
    [r.tenant!.id]);
    return { ...subscription, limits: plans[subscription!.plan as keyof typeof plans], usage, sandbox: app.config.sandboxBilling };
  });
  app.post('/subscription/sandbox-plan', {
    preHandler: owner,
    schema: { tags: ['Subscriptions'], summary: 'Development-only plan change (does NOT charge money)', body: Obj({
      plan: Type.Union([Type.Literal('free'), Type.Literal('pro'), Type.Literal('business')]),
    }) },
  }, async (r) => {
    if (!app.config.sandboxBilling || app.config.nodeEnv === 'production') {
      throw new ApiError(403, 'SANDBOX_DISABLED', 'Sandbox billing is disabled. Integrate a verified billing provider for paid plans.');
    }
    return storeTransaction(app, r, async (tx) => {
      await lockStore(tx, r.tenant!.id);
      const [usage] = await tx.query(`SELECT
        (SELECT count(*)::int FROM products WHERE tenant_id=$1 AND active) AS products,
        (SELECT count(*)::int FROM memberships WHERE tenant_id=$1) AS members,
        (SELECT count(*)::int FROM orders WHERE tenant_id=$1 AND created_at>=date_trunc('month',now())) AS orders`,
      [r.tenant!.id]);
      const limits = plans[r.body.plan];
      if (usage!.products > limits.products || usage!.members > limits.members || usage!.orders > limits.ordersPerMonth) {
        conflict('Current usage exceeds the requested plan. Reduce usage before downgrading.');
      }
      const [subscription] = await tx.query('UPDATE subscriptions SET plan=$2,updated_at=now() WHERE tenant_id=$1 RETURNING *',
        [r.tenant!.id, r.body.plan]);
      await audit(tx, r, 'subscription.sandbox_changed', r.tenant!.id, r.body);
      return subscription;
    });
  });
  app.get('/audit-logs', {
    preHandler: admins, schema: { tags: ['Audit'], querystring: Pagination },
  }, async (r) => {
    const { page = 1, limit = 20 } = r.query;
    return { data: await app.db.query('SELECT * FROM audit_logs WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',
      [r.tenant!.id, limit, (page - 1) * limit]), page, limit };
  });
}

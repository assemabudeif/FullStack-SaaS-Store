import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { admins } from '../lib/context.js';
import { Obj, Pagination, Type } from '../lib/schemas.js';
import { ApiError, notFound } from '../lib/errors.js';

export async function analyticsRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  app.get('/analytics/summary', {
    preHandler: admins, schema: { tags: ['Analytics'], querystring: Obj({
      from: Type.Optional(Type.String({ format: 'date' })),
      to: Type.Optional(Type.String({ format: 'date' })),
    }) },
  }, async (r) => {
    if (r.query.from && r.query.to && r.query.from > r.query.to) throw new ApiError(400, 'INVALID_RANGE', 'from must precede to.');
    const [summary] = await app.db.query(`SELECT count(*)::int AS orders,
      count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
      count(*) FILTER (WHERE status='completed')::int AS completed,
      COALESCE(sum(total_cents) FILTER (WHERE status='completed'),0)::text AS completed_sales_cents,
      COALESCE(sum(total_cents) FILTER (WHERE status IN ('pending','confirmed','shipped')),0)::text AS open_order_value_cents
      FROM orders WHERE tenant_id=$1 AND ($2::date IS NULL OR created_at >= $2::date)
      AND ($3::date IS NULL OR created_at < $3::date + interval '1 day')`,
    [r.tenant!.id, r.query.from ?? null, r.query.to ?? null]);
    const [inventory] = await app.db.query(`SELECT count(*)::int AS active_products,
      count(*) FILTER (WHERE stock<=5)::int AS low_stock_products FROM products WHERE tenant_id=$1 AND active`, [r.tenant!.id]);
    const [store] = await app.db.query('SELECT currency FROM tenants WHERE id=$1', [r.tenant!.id]);
    return { ...summary, ...inventory, currency: store!.currency,
      note: 'Sales are completed order values, not verified payment receipts. Large aggregates are decimal strings.' };
  });
}

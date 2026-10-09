import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { storeTransaction, admins, audit, writers } from '../lib/context.js';
import { notFound } from '../lib/errors.js';
import { Address, Email, Obj, Pagination, ParamsId, Text, Type } from '../lib/schemas.js';

const Customer = Obj({
  name: Text(150), email: Email, phone: Type.Optional(Type.String({ maxLength: 40 })),
  address: Type.Optional(Address),
});
export async function customerRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  app.get('/customers', { schema: { tags: ['Customers'], querystring: Pagination } }, async (r) => {
    const { page = 1, limit = 20 } = r.query;
    const [count] = await app.db.query('SELECT count(*)::int AS total FROM customers WHERE tenant_id=$1', [r.tenant!.id]);
    return { data: await app.db.query('SELECT * FROM customers WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',
      [r.tenant!.id, limit, (page - 1) * limit]), total: count!.total, page, limit };
  });
  app.post('/customers', { preHandler: writers, schema: { tags: ['Customers'], body: Customer } }, async (r, reply) => {
    const customer = await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query('INSERT INTO customers(id,tenant_id,name,email,phone,address) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [randomUUID(), r.tenant!.id, r.body.name, r.body.email.toLowerCase(), r.body.phone ?? '', JSON.stringify(r.body.address ?? {})]);
      await audit(tx, r, 'customer.created', row!.id);
      return row;
    });
    return reply.code(201).send(customer);
  });
  app.get('/customers/:id', { schema: { tags: ['Customers'], params: ParamsId } }, async (r) => {
    const [row] = await app.db.query('SELECT * FROM customers WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.params.id]);
    if (!row) notFound('Customer');
    return row;
  });
  app.patch('/customers/:id', {
    preHandler: writers, schema: { tags: ['Customers'], params: ParamsId, body: Type.Partial(Customer) },
  }, async (r) => storeTransaction(app, r, async (tx) => {
    const [row] = await tx.query(`UPDATE customers SET name=COALESCE($3,name),email=COALESCE($4,email),
      phone=COALESCE($5,phone),address=COALESCE($6::jsonb,address) WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [r.tenant!.id, r.params.id, r.body.name ?? null, r.body.email?.toLowerCase() ?? null, r.body.phone ?? null,
      r.body.address ? JSON.stringify(r.body.address) : null]);
    if (!row) notFound('Customer');
    await audit(tx, r, 'customer.updated', row.id);
    return row;
  }));
  app.delete('/customers/:id', {
    preHandler: admins, schema: { tags: ['Customers'], params: ParamsId },
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query('DELETE FROM customers WHERE tenant_id=$1 AND id=$2 RETURNING id', [r.tenant!.id, r.params.id]);
      if (!row) notFound('Customer');
      await audit(tx, r, 'customer.deleted', row.id);
    });
    return reply.code(204).send();
  });
}

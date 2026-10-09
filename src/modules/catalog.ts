import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { storeTransaction, admins, audit, enforceQuota, lockStore, writers } from '../lib/context.js';
import { ApiError, notFound } from '../lib/errors.js';
import { Id, Money, Obj, Pagination, ParamsId, Text, Type } from '../lib/schemas.js';

const productFields = {
  name: Text(), description: Type.Optional(Type.String({ maxLength: 10000 })),
  sku: Type.String({ minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9._-]+$' }),
  priceCents: Money, categoryId: Type.Optional(Type.Union([Id, Type.Null()])),
  imageUrl: Type.Optional(Type.String({ maxLength: 2000 })),
};

export async function catalogRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  app.get('/categories', { schema: { tags: ['Categories'] } }, async (r) => ({
    data: await app.db.query('SELECT * FROM categories WHERE tenant_id=$1 ORDER BY name', [r.tenant!.id]),
  }));
  app.post('/categories', {
    preHandler: admins, schema: { tags: ['Categories'], body: Obj({ name: Text(100) }) },
  }, async (r, reply) => {
    const category = await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query('INSERT INTO categories(id,tenant_id,name) VALUES($1,$2,$3) RETURNING *',
        [randomUUID(), r.tenant!.id, r.body.name]);
      await audit(tx, r, 'category.created', row!.id);
      return row;
    });
    return reply.code(201).send(category);
  });
  app.patch('/categories/:id', {
    preHandler: admins, schema: { tags: ['Categories'], params: ParamsId, body: Obj({ name: Text(100) }) },
  }, async (r) => storeTransaction(app, r, async (tx) => {
    const [row] = await tx.query('UPDATE categories SET name=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *',
      [r.tenant!.id, r.params.id, r.body.name]);
    if (!row) notFound('Category');
    await audit(tx, r, 'category.updated', row.id);
    return row;
  }));
  app.delete('/categories/:id', {
    preHandler: admins, schema: { tags: ['Categories'], params: ParamsId },
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query('DELETE FROM categories WHERE tenant_id=$1 AND id=$2 RETURNING id', [r.tenant!.id, r.params.id]);
      if (!row) notFound('Category');
      await audit(tx, r, 'category.deleted', row.id);
    });
    return reply.code(204).send();
  });

  app.get('/products', {
    schema: { tags: ['Products'], querystring: Obj({
      ...Pagination.properties, search: Type.Optional(Type.String({ maxLength: 100 })),
      categoryId: Type.Optional(Id), active: Type.Optional(Type.Boolean()),
    }) },
  }, async (r) => {
    const { page = 1, limit = 20, search, categoryId, active } = r.query;
    const where = 'tenant_id=$1 AND ($2::text IS NULL OR name ILIKE $2 OR sku ILIKE $2) AND ($3::uuid IS NULL OR category_id=$3) AND ($4::boolean IS NULL OR active=$4)';
    const values = [r.tenant!.id, search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null, categoryId ?? null, active ?? null];
    return storeTransaction(app, r, async (tx) => {
      const [count] = await tx.query(`SELECT count(*)::int AS total FROM products WHERE ${where}`, values);
      const data = await tx.query(`SELECT * FROM products WHERE ${where} ORDER BY created_at DESC,id LIMIT $5 OFFSET $6`,
        [...values, limit, (page - 1) * limit]);
      return { data, total: count!.total, page, limit };
    });
  });
  app.post('/products', {
    preHandler: writers, schema: { tags: ['Products'], body: Obj({
      ...productFields, initialStock: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
    }) },
  }, async (r, reply) => {
    const product = await storeTransaction(app, r, async (tx) => {
      await lockStore(tx, r.tenant!.id);
      await enforceQuota(tx, r.tenant!.id, 'products');
      if (r.body.categoryId) {
        const [category] = await tx.query('SELECT id FROM categories WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.body.categoryId]);
        if (!category) notFound('Category');
      }
      const id = randomUUID(), stock = r.body.initialStock ?? 0;
      const [row] = await tx.query(`INSERT INTO products(id,tenant_id,name,description,sku,price_cents,category_id,stock,image_url)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, r.tenant!.id, r.body.name, r.body.description ?? '', r.body.sku, r.body.priceCents, r.body.categoryId ?? null, stock, r.body.imageUrl ?? null]);
      if (stock) await tx.query(`INSERT INTO inventory_movements(id,tenant_id,product_id,delta,reason,actor_id)
        VALUES($1,$2,$3,$4,'initial stock',$5)`, [randomUUID(), r.tenant!.id, id, stock, r.identity!.userId]);
      await audit(tx, r, 'product.created', id);
      return row;
    });
    return reply.code(201).send(product);
  });
  app.get('/products/:id', {
    schema: { tags: ['Products'], params: ParamsId },
  }, async (r) => {
    const [product] = await app.db.query('SELECT * FROM products WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.params.id]);
    if (!product) notFound('Product');
    return product;
  });
  app.patch('/products/:id', {
    preHandler: writers, schema: { tags: ['Products'], params: ParamsId, body: Type.Partial(Obj({
      ...productFields, active: Type.Boolean(),
    })) },
  }, async (r) => storeTransaction(app, r, async (tx) => {
    await lockStore(tx, r.tenant!.id);
    const [existing] = await tx.query('SELECT * FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [r.tenant!.id, r.params.id]);
    if (!existing) notFound('Product');
    if (r.body.active && !existing.active) await enforceQuota(tx, r.tenant!.id, 'products');
    if (r.body.categoryId) {
      const [category] = await tx.query('SELECT id FROM categories WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.body.categoryId]);
      if (!category) notFound('Category');
    }
    const [row] = await tx.query(`UPDATE products SET name=$3,description=$4,sku=$5,price_cents=$6,
      category_id=$7,active=$8,image_url=COALESCE($9,image_url),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [r.tenant!.id, r.params.id, r.body.name ?? existing.name, r.body.description ?? existing.description,
      r.body.sku ?? existing.sku, r.body.priceCents ?? existing.price_cents,
      r.body.categoryId === undefined ? existing.category_id : r.body.categoryId, r.body.active ?? existing.active,
      r.body.imageUrl === undefined ? null : r.body.imageUrl]);
    await audit(tx, r, 'product.updated', r.params.id, r.body);
    return row;
  }));
  app.delete('/products/:id', {
    preHandler: admins, schema: { tags: ['Products'], summary: 'Archive a product, preserving order history', params: ParamsId },
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      await lockStore(tx, r.tenant!.id);
      const [row] = await tx.query('UPDATE products SET active=false,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id',
        [r.tenant!.id, r.params.id]);
      if (!row) notFound('Product');
      await audit(tx, r, 'product.archived', row.id);
    });
    return reply.code(204).send();
  });
  app.post('/products/:id/inventory', {
    preHandler: writers, schema: { tags: ['Inventory'], params: ParamsId, body: Obj({
      delta: Type.Integer({ minimum: -1000000, maximum: 1000000 }),
      reason: Text(500),
    }) },
  }, async (r) => {
    if (r.body.delta === 0) throw new ApiError(400, 'INVALID_ADJUSTMENT', 'Stock adjustment must be nonzero.');
    return storeTransaction(app, r, async (tx) => {
      await lockStore(tx, r.tenant!.id);
      const [row] = await tx.query(`UPDATE products SET stock=stock+$3,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND stock+$3 BETWEEN 0 AND 100000000 RETURNING *`,
      [r.tenant!.id, r.params.id, r.body.delta]);
      if (!row) {
        const [exists] = await tx.query('SELECT id FROM products WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.params.id]);
        if (!exists) notFound('Product');
        throw new ApiError(409, 'INVALID_STOCK', 'Adjustment would produce invalid stock.');
      }
      await tx.query('INSERT INTO inventory_movements(id,tenant_id,product_id,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), r.tenant!.id, r.params.id, r.body.delta, r.body.reason, r.identity!.userId]);
      await audit(tx, r, 'inventory.adjusted', r.params.id, r.body);
      return row;
    });
  });
  app.get('/inventory/movements', {
    schema: { tags: ['Inventory'], querystring: Obj({ ...Pagination.properties, productId: Type.Optional(Id) }) },
  }, async (r) => {
    const { page = 1, limit = 20 } = r.query;
    return { data: await app.db.query(`SELECT * FROM inventory_movements WHERE tenant_id=$1
      AND ($2::uuid IS NULL OR product_id=$2) ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,
    [r.tenant!.id, r.query.productId ?? null, limit, (page - 1) * limit]), page, limit };
  });
}

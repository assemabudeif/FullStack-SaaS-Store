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

  // Wishlist Management
  app.get('/customers/:customerId/wishlists', {
    schema: {
      tags: ['Wishlists'],
      params: ParamsId,
      querystring: Pagination
    }
  }, async (r) => {
    // Verify customer belongs to tenant
    const [customer] = await app.db.query(
      'SELECT id FROM customers WHERE tenant_id=$1 AND id=$2',
      [r.tenant!.id, r.params.customerId]
    );
    if (!customer) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }

    const { page = 1, limit = 20 } = r.query;
    const [count] = await app.db.query(
      'SELECT count(*)::int AS total FROM wishlists WHERE tenant_id=$1 AND customer_id=$2',
      [r.tenant!.id, r.params.customerId]
    );
    const data = await app.db.query(
      'SELECT * FROM wishlists WHERE tenant_id=$1 AND customer_id=$2 ORDER BY is_default DESC, created_at DESC LIMIT $3 OFFSET $4',
      [r.tenant!.id, r.params.customerId, limit, (page - 1) * limit]
    );
    return { data, total: count!.total, page, limit };
  });

  app.post('/customers/:customerId/wishlists', {
    schema: {
      tags: ['Wishlists'],
      params: ParamsId,
      body: Obj({ name: Type.Optional(Text(100)) })
    }
  }, async (r, reply) => {
    // Verify customer belongs to tenant
    const [customer] = await app.db.query(
      'SELECT id FROM customers WHERE tenant_id=$1 AND id=$2',
      [r.tenant!.id, r.params.customerId]
    );
    if (!customer) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }

    const wishlist = await storeTransaction(app, r, async (tx) => {
      // Check if this should be the default wishlist (no existing default)
      const isDefault = r.body.name === undefined; // First wishlist without name becomes default
      if (!isDefault) {
        const [existingDefault] = await tx.query(
          'SELECT id FROM wishlists WHERE tenant_id=$1 AND customer_id=$2 AND is_default=true',
          [r.tenant!.id, r.params.customerId]
        );
        isDefault = !existingDefault;
      }

      const [row] = await tx.query(
        'INSERT INTO wishlists(id,tenant_id,customer_id,name,is_default) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [randomUUID(), r.tenant!.id, r.params.customerId, r.body.name ?? null, isDefault]
      );
      await audit(tx, r, 'wishlist.created', row.id);
      return row;
    });
    return reply.code(201).send(wishlist);
  });

  app.get('/wishlists/:wishlistId/items', {
    schema: {
      tags: ['Wishlist Items'],
      params: Type.Object({ id: Id }),
      querystring: Pagination
    }
  }, async (r) => {
    // Verify wishlist belongs to tenant
    const [wishlist] = await app.db.query(
      'SELECT id FROM wishlists WHERE tenant_id=$1 AND id=$2',
      [r.tenant!.id, r.params.wishlistId]
    );
    if (!wishlist) {
      throw new ApiError(404, 'WISHLIST_NOT_FOUND', 'Wishlist not found');
    }

    const { page = 1, limit = 20 } = r.query;
    const [count] = await app.db.query(
      'SELECT count(*)::int AS total FROM wishlist_items WHERE tenant_id=$1 AND wishlist_id=$2',
      [r.tenant!.id, r.params.wishlistId]
    );
    const data = await app.db.query(
      `SELECT wi.*,
        p.name as product_name, p.sku as product_sku, p.price_cents as product_price_cents,
        pv.sku as variant_sku, pv.price_cents_integer_adjustment as variant_price_adjustment
      FROM wishlist_items wi
      LEFT JOIN products p ON wi.product_id = p.id AND wi.tenant_id = p.tenant_id
      LEFT JOIN product_variants pv ON wi.variant_id = pv.id AND wi.tenant_id = pv.tenant_id
      WHERE wi.tenant_id=$1 AND wi.wishlist_id=$2
      ORDER BY wi.created_at DESC
      LIMIT $3 OFFSET $4`,
      [r.tenant!.id, r.params.wishlistId, limit, (page - 1) * limit]
    );
    return { data, total: count!.total, page, limit };
  });

  app.post('/wishlists/:wishlistId/items', {
    schema: {
      tags: ['Wishlist Items'],
      params: Type.Object({ id: Id }),
      body: Obj({
        productId: Id,
        variantId: Type.Optional(Id)
      })
    }
  }, async (r, reply) => {
    // Verify wishlist belongs to tenant
    const [wishlist] = await app.db.query(
      'SELECT id FROM wishlists WHERE tenant_id=$1 AND id=$2',
      [r.tenant!.id, r.params.wishlistId]
    );
    if (!wishlist) {
      throw new ApiError(404, 'WISHLIST_NOT_FOUND', 'Wishlist not found');
    }

    // Verify product belongs to tenant and is active
    const [product] = await app.db.query(
      'SELECT id FROM products WHERE tenant_id=$1 AND id=$2 AND active=true',
      [r.tenant!.id, r.body.productId]
    );
    if (!product) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found or inactive');
    }

    // Verify variant belongs to tenant and product if provided
    if (r.body.variantId) {
      const [variant] = await app.db.query(
        'SELECT id FROM product_variants WHERE tenant_id=$1 AND id=$2 AND product_id=$3 AND is_active=true',
        [r.tenant!.id, r.body.variantId, r.body.productId]
      );
      if (!variant) {
        throw new ApiError(404, 'VARIANT_NOT_FOUND', 'Variant not found, inactive, or does not belong to product');
      }
    }

    const wishlistItem = await storeTransaction(app, r, async (tx) => {
      // Check if item already exists in wishlist
      const [existing] = await tx.query(
        'SELECT id FROM wishlist_items WHERE tenant_id=$1 AND wishlist_id=$2 AND product_id=$3 AND variant_id=$4',
        [r.tenant!.id, r.params.wishlistId, r.body.productId, r.body.variantId ?? null]
      );
      if (existing) {
        throw new ApiError(409, 'ITEM_ALREADY_IN_WISHLIST', 'Item is already in wishlist');
      }

      const [row] = await tx.query(
        'INSERT INTO wishlist_items(id,tenant_id,wishlist_id,product_id,variant_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [randomUUID(), r.tenant!.id, r.params.wishlistId, r.body.productId, r.body.variantId ?? null]
      );
      await audit(tx, r, 'wishlist_item.added', row.id, { productId: r.body.productId, variantId: r.body.variantId });
      return row;
    });
    return reply.code(201).send(wishlistItem);
  });

  app.delete('/wishlists/:wishlistId/items/:itemId', {
    schema: {
      tags: ['Wishlist Items'],
      params: Type.Object({ wishlistId: Id, itemId: Id })
    }
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      // Verify wishlist belongs to tenant
      const [wishlist] = await app.db.query(
        'SELECT id FROM wishlists WHERE tenant_id=$1 AND id=$2',
        [r.tenant!.id, r.params.wishlistId]
      );
      if (!wishlist) {
        throw new ApiError(404, 'WISHLIST_NOT_FOUND', 'Wishlist not found');
      }

      // Delete wishlist item
      const [row] = await tx.query(
        'DELETE FROM wishlist_items WHERE tenant_id=$1 AND id=$2 AND wishlist_id=$3 RETURNING id',
        [r.tenant!.id, r.params.itemId, r.params.wishlistId]
      );
      if (!row) {
        throw new ApiError(404, 'WISHLIST_ITEM_NOT_FOUND', 'Wishlist item not found');
      }

      await audit(tx, r, 'wishlist_item.removed', r.params.itemId);
    });
    return reply.code(204).send();
  });

  app.patch('/wishlists/:wishlistId/default', {
    schema: {
      tags: ['Wishlists'],
      params: ParamsId
    }
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      // Verify wishlist belongs to tenant
      const [wishlist] = await app.db.query(
        'SELECT id FROM wishlists WHERE tenant_id=$1 AND id=$2',
        [r.tenant!.id, r.params.wishlistId]
      );
      if (!wishlist) {
        throw new ApiError(404, 'WISHLIST_NOT_FOUND', 'Wishlist not found');
      }

      // Remove default from all other wishlists for this customer
      await tx.query(
        'UPDATE wishlists SET is_default=false WHERE tenant_id=$1 AND customer_id=(SELECT customer_id FROM wishlists WHERE tenant_id=$2 AND id=$3) AND is_default=true',
        [r.tenant!.id, r.tenant!.id, r.params.wishlistId]
      );

      // Set this wishlist as default
      const [row] = await tx.query(
        'UPDATE wishlists SET is_default=true,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *',
        [r.tenant!.id, r.params.wishlistId]
      );

      if (!row) {
        throw new ApiError(404, 'WISHLIST_NOT_FOUND', 'Wishlist not found');
      }

      await audit(tx, r, 'wishlist.set_as_default', r.params.wishlistId);
    });
    return reply.code(200).send(wishlist);
  });

  // Get customer's default wishlist with items
  app.get('/customers/:customerId/default-wishlist', {
    schema: {
      tags: ['Wishlists'],
      params: ParamsId
    }
  }, async (r) => {
    // Verify customer belongs to tenant
    const [customer] = await app.db.query(
      'SELECT id FROM customers WHERE tenant_id=$1 AND id=$2',
      [r.tenant!.id, r.params.customerId]
    );
    if (!customer) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }

    const [wishlist] = await app.db.query(
      'SELECT w.* FROM wishlists w WHERE w.tenant_id=$1 AND w.customer_id=$2 AND w.is_default=true',
      [r.tenant!.id, r.params.customerId]
    );

    if (!wishlist) {
      // Return empty wishlist structure if no default exists
      return {
        id: null,
        tenant_id: r.tenant!.id,
        customer_id: r.params.customerId,
        name: null,
        is_default: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        items: []
      };
    }

    const items = await app.db.query(
      `SELECT wi.*,
        p.name as product_name, p.sku as product_sku, p.price_cents as product_price_cents,
        pv.sku as variant_sku, pv.price_cents_integer_adjustment as variant_price_adjustment
      FROM wishlist_items wi
      LEFT JOIN products p ON wi.product_id = p.id AND wi.tenant_id = p.tenant_id
      LEFT JOIN product_variants pv ON wi.variant_id = pv.id AND wi.tenant_id = pv.tenant_id
      WHERE wi.tenant_id=$1 AND wi.wishlist_id=$2
      ORDER BY wi.created_at DESC`,
      [r.tenant!.id, wishlist.id]
    );

    return {
      ...wishlist,
      items
    };
  });
}
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Sql } from '../db/database.js';
import { storeTransaction, admins, audit, enforceQuota, lockStore, writers } from '../lib/context.js';
import { ApiError, conflict, notFound } from '../lib/errors.js';
import { digest } from '../lib/security.js';
import { Address, Id, Obj, Pagination, ParamsId, Type } from '../lib/schemas.js';

const Status = Type.Union(['pending', 'confirmed', 'shipped', 'completed', 'cancelled'].map((s) => Type.Literal(s)));
const transitions: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'],
  shipped: ['completed'], completed: [], cancelled: [],
};

async function getOrder(tx: Sql, tenantId: string, id: string) {
  const [order] = await tx.query('SELECT * FROM orders WHERE tenant_id=$1 AND id=$2', [tenantId, id]);
  if (!order) notFound('Order');
  const items = await tx.query('SELECT * FROM order_items WHERE tenant_id=$1 AND order_id=$2 ORDER BY id', [tenantId, id]);
  return { ...order, items };
}

export async function orderRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  app.get('/orders', {
    schema: { tags: ['Orders'], querystring: Obj({ ...Pagination.properties, status: Type.Optional(Status), customerId: Type.Optional(Id) }) },
  }, async (r) => {
    const { page = 1, limit = 20 } = r.query;
    const where = 'tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::uuid IS NULL OR customer_id=$3)';
    const args = [r.tenant!.id, r.query.status ?? null, r.query.customerId ?? null];
    const [count] = await app.db.query(`SELECT count(*)::int AS total FROM orders WHERE ${where}`, args);
    return { data: await app.db.query(`SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC,id LIMIT $4 OFFSET $5`,
      [...args, limit, (page - 1) * limit]), total: count!.total, page, limit };
  });
  app.get('/orders/:id', { schema: { tags: ['Orders'], params: ParamsId } }, async (r) =>
    storeTransaction(app, r, (tx) => getOrder(tx, r.tenant!.id, r.params.id)));
  app.post('/orders', {
    preHandler: writers,
    schema: { tags: ['Orders'], summary: 'Place an order atomically; all prices are calculated on the server',
      headers: Type.Object({ 'idempotency-key': Type.String({ minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }) }),
      body: Obj({
        customerId: Id,
        items: Type.Array(Obj({ productId: Id, quantity: Type.Integer({ minimum: 1, maximum: 1000 }) }), { minItems: 1, maxItems: 100 }),
        couponCode: Type.Optional(Type.String({ minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$' })),
        shippingAddress: Type.Optional(Address),
        paymentMethod: Type.Optional(Type.Union([Type.Literal('cod'), Type.Literal('paymob')])),
      }),
    },
  }, async (r, reply) => {
    // Canonical form ensures property ordering/item ordering do not affect retries.
    const items = [...r.body.items].sort((a, b) => a.productId.localeCompare(b.productId));
    if (new Set(items.map((i) => i.productId)).size !== items.length) {
      throw new ApiError(400, 'DUPLICATE_PRODUCT', 'Combine duplicate products into a single order item.');
    }
    const address = r.body.shippingAddress ?? {};
    const canonicalAddress = Object.fromEntries(Object.entries(address).sort(([a], [b]) => a.localeCompare(b)));
    const requestHash = digest(JSON.stringify({
      customerId: r.body.customerId, items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      couponCode: r.body.couponCode?.toUpperCase() ?? null, shippingAddress: canonicalAddress,
    }));
    const result = await storeTransaction(app, r, async (tx) => {
      const store = await lockStore(tx, r.tenant!.id);
      const [existing] = await tx.query('SELECT id,request_hash FROM orders WHERE tenant_id=$1 AND idempotency_key=$2',
        [r.tenant!.id, r.headers['idempotency-key']]);
      if (existing) {
        if (existing.request_hash !== requestHash) conflict('Idempotency key was already used for a different request.');
        return { order: await getOrder(tx, r.tenant!.id, existing.id), replay: true };
      }
      await enforceQuota(tx, r.tenant!.id, 'ordersPerMonth');
      const [customer] = await tx.query('SELECT * FROM customers WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.body.customerId]);
      if (!customer) notFound('Customer');
      const lines: { product: Record<string, any>; quantity: number }[] = [];
      let subtotal = 0;
      for (const item of items) {
        const [product] = await tx.query('SELECT * FROM products WHERE tenant_id=$1 AND id=$2 AND active=true FOR UPDATE',
          [r.tenant!.id, item.productId]);
        if (!product) notFound('Active product');
        if (product.stock < item.quantity) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Not enough stock for ${product.sku}.`);
        subtotal += product.price_cents * item.quantity;
        lines.push({ product, quantity: item.quantity });
      }
      let coupon: Record<string, any> | undefined, discount = 0;
      if (r.body.couponCode) {
        [coupon] = await tx.query(`SELECT * FROM coupons WHERE tenant_id=$1 AND code=$2
          AND active AND expires_at>now() AND used<max_uses FOR UPDATE`, [r.tenant!.id, r.body.couponCode.toUpperCase()]);
        if (!coupon) throw new ApiError(400, 'INVALID_COUPON', 'Coupon is invalid, expired, or exhausted.');
        discount = Math.floor(subtotal * coupon.percent / 100);
      }
      const tax = Math.round((subtotal - discount) * store.tax_basis_points / 10000);
      const total = subtotal - discount + tax + store.shipping_cents;
      if (subtotal > 2_000_000_000 || total > 2_000_000_000) {
        throw new ApiError(400, 'ORDER_TOO_LARGE', 'Order value exceeds the supported limit.');
      }
      const id = randomUUID();
      const paymentMethod = r.body.paymentMethod ?? 'cod';
      await tx.query(`INSERT INTO orders(id,tenant_id,customer_id,created_by,currency,subtotal_cents,discount_cents,
        tax_cents,shipping_cents,total_cents,coupon_id,shipping_address,idempotency_key,request_hash,payment_method,payment_status,customer_email,customer_phone)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, r.tenant!.id, customer.id, r.identity!.userId, store.currency, subtotal, discount, tax, store.shipping_cents,
        total, coupon?.id ?? null, JSON.stringify(r.body.shippingAddress ?? customer.address), r.headers['idempotency-key'], requestHash,
        paymentMethod, 'unpaid', customer.email, customer.phone]);
      for (const { product, quantity } of lines) {
        await tx.query(`INSERT INTO order_items(id,tenant_id,order_id,product_id,name,sku,quantity,unit_price_cents)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), r.tenant!.id, id, product.id, product.name, product.sku, quantity, product.price_cents]);
        await tx.query('UPDATE products SET stock=stock-$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',
          [r.tenant!.id, product.id, quantity]);
        await tx.query(`INSERT INTO inventory_movements(id,tenant_id,product_id,delta,reason,order_id,actor_id)
          VALUES($1,$2,$3,$4,'order placed',$5,$6)`,
        [randomUUID(), r.tenant!.id, product.id, -quantity, id, r.identity!.userId]);
      }
      if (coupon) await tx.query('UPDATE coupons SET used=used+1 WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, coupon.id]);
      await audit(tx, r, 'order.created', id, { totalCents: total, paymentMethod });
      
      // Send order confirmation email
      try {
        const orderDetails = {
          items: lines.map(line => ({
            name: line.product.name,
            sku: line.product.sku,
            quantity: line.quantity,
            price: (line.product.price_cents / 100).toFixed(2)
          })),
          subtotal: (subtotal / 100).toFixed(2),
          discount: (discount / 100).toFixed(2),
          tax: (tax / 100).toFixed(2),
          shipping: (store.shipping_cents / 100).toFixed(2),
          total: (total / 100).toFixed(2),
          paymentMethod: paymentMethod === 'cod' ? 'الدفع عند الاستلام' : 'بطاقة ائتمان عبر Paymob',
          storeUrl: process.env.STORE_URL || 'http://localhost:5173'
        };
        
        await app.notificationService.sendOrderConfirmation(
          customer.email,
          customer.name,
          id,
          orderDetails
        );
      } catch (emailError) {
        // Don't fail the order if email sending fails
        app.log.error('Failed to send order confirmation email:', emailError);
      }
      
      return { order: await getOrder(tx, r.tenant!.id, id), replay: false };
    });
    reply.header('Idempotency-Replayed', String(result.replay));
    return reply.code(result.replay ? 200 : 201).send(result.order);
  });
  app.patch('/orders/:id/status', {
    preHandler: writers, schema: { tags: ['Orders'], params: ParamsId, body: Obj({ status: Status }) },
  }, async (r) => storeTransaction(app, r, async (tx) => {
    await lockStore(tx, r.tenant!.id);
    const [order] = await tx.query('SELECT * FROM orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [r.tenant!.id, r.params.id]);
    if (!order) notFound('Order');
    if (order.status === r.body.status) return getOrder(tx, r.tenant!.id, r.params.id);
    if (!transitions[order.status]?.includes(r.body.status)) conflict(`Cannot change ${order.status} to ${r.body.status}.`);
    if (r.body.status === 'cancelled') {
      const items = await tx.query('SELECT * FROM order_items WHERE tenant_id=$1 AND order_id=$2 ORDER BY product_id',
        [r.tenant!.id, order.id]);
      for (const item of items) {
        await tx.query('UPDATE products SET stock=stock+$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',
          [r.tenant!.id, item.product_id, item.quantity]);
        await tx.query(`INSERT INTO inventory_movements(id,tenant_id,product_id,delta,reason,order_id,actor_id)
          VALUES($1,$2,$3,$4,'order cancelled',$5,$6)`,
        [randomUUID(), r.tenant!.id, item.product_id, item.quantity, order.id, r.identity!.userId]);
      }
      if (order.coupon_id) await tx.query('UPDATE coupons SET used=GREATEST(0,used-1) WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, order.coupon_id]);
    }
    await tx.query('UPDATE orders SET status=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',
      [r.tenant!.id, order.id, r.body.status]);
    await audit(tx, r, 'order.status_changed', order.id, { from: order.status, to: r.body.status });
    
    // Send status update emails
    try {
      const customerName = `${order.customer_email.split('@')[0]}`; // Fallback if we don't have name
      // In a real implementation, we'd fetch the customer name from the customer record
      
      if (r.body.status === 'confirmed') {
        await app.notificationService.sendOrderConfirmation(
          order.customer_email,
          customerName,
          order.id,
          {
            items: order.items.map(item => ({
              name: item.name,
              sku: item.sku,
              quantity: item.quantity,
              price: (item.unit_price_cents / 100).toFixed(2)
            })),
            subtotal: (order.subtotal_cents / 100).toFixed(2),
            discount: (order.discount_cents / 100).toFixed(2),
            tax: (order.tax_cents / 100).toFixed(2),
            shipping: (order.shipping_cents / 100).toFixed(2),
            total: (order.total_cents / 100).toFixed(2),
            paymentMethod: order.payment_method === 'cod' ? 'الدفع عند الاستلام' : 'بطاقة ائتمان عبر Paymob',
            storeUrl: process.env.STORE_URL || 'http://localhost:5173'
          }
        );
      } else if (r.body.status === 'shipped') {
        // In a real implementation, we'd get tracking info from shipping provider
        await app.notificationService.sendOrderShipped(
          order.customer_email,
          customerName,
          order.id,
          {
            trackingNumber: `TRK${Math.floor(Math.random() * 1000000)}`,
            carrier: 'شركة الشحن',
            estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString() // 3 days from now
          }
        );
      } else if (r.body.status === 'completed') {
        await app.notificationService.sendOrderDelivered(
          order.customer_email,
          customerName,
          order.id
        );
      }
    } catch (emailError) {
      // Don't fail the status update if email sending fails
      app.log.error('Failed to send order status email:', emailError);
    }
    
    return getOrder(tx, r.tenant!.id, order.id);
  }));
  app.patch('/orders/:id/payment', {
    preHandler: writers, schema: { tags: ['Orders'], params: ParamsId, body: Obj({
      paymentStatus: Type.Union([Type.Literal('unpaid'), Type.Literal('paid'), Type.Literal('refunded')]),
      paymentReference: Type.Optional(Type.String({ maxLength: 200 })),
    }) },
  }, async (r) => storeTransaction(app, r, async (tx) => {
    await lockStore(tx, r.tenant!.id);
    const [order] = await tx.query('SELECT * FROM orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [r.tenant!.id, r.params.id]);
    if (!order) notFound('Order');
    await tx.query('UPDATE orders SET payment_status=$3,payment_reference=COALESCE($4,payment_reference),updated_at=now() WHERE tenant_id=$1 AND id=$2',
      [r.tenant!.id, order.id, r.body.paymentStatus, r.body.paymentReference ?? null]);
    await audit(tx, r, 'order.payment_updated', order.id, r.body);
    return getOrder(tx, r.tenant!.id, order.id);
  }));

  app.get('/coupons', { preHandler: admins, schema: { tags: ['Coupons'], querystring: Pagination } }, async (r) => {
    const { page = 1, limit = 20 } = r.query;
    return { data: await app.db.query('SELECT * FROM coupons WHERE tenant_id=$1 ORDER BY code LIMIT $2 OFFSET $3',
      [r.tenant!.id, limit, (page - 1) * limit]), page, limit };
  });
  app.post('/coupons', {
    preHandler: admins, schema: { tags: ['Coupons'], body: Obj({
      code: Type.String({ minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$' }),
      percent: Type.Integer({ minimum: 1, maximum: 100 }),
      maxUses: Type.Integer({ minimum: 1, maximum: 1000000 }),
      expiresAt: Type.String({ format: 'date-time' }),
    }) },
  }, async (r, reply) => {
    if (new Date(r.body.expiresAt).getTime() <= Date.now()) throw new ApiError(400, 'INVALID_EXPIRY', 'Expiry must be in the future.');
    const coupon = await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query('INSERT INTO coupons(id,tenant_id,code,percent,max_uses,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [randomUUID(), r.tenant!.id, r.body.code.toUpperCase(), r.body.percent, r.body.maxUses, r.body.expiresAt]);
      await audit(tx, r, 'coupon.created', row!.id);
      return row;
    });
    return reply.code(201).send(coupon);
  });
  app.delete('/coupons/:id', { preHandler: admins, schema: { tags: ['Coupons'], params: ParamsId } }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query('UPDATE coupons SET active=false WHERE tenant_id=$1 AND id=$2 RETURNING id', [r.tenant!.id, r.params.id]);
      if (!row) notFound('Coupon');
      await audit(tx, r, 'coupon.disabled', row.id);
    });
    return reply.code(204).send();
  });
}

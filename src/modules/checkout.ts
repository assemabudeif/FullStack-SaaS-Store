import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Sql } from '../db/database.js';
import { enforceQuota, lockStore } from '../lib/context.js';
import { ApiError, conflict, notFound } from '../lib/errors.js';
import { digest } from '../lib/security.js';
import { Address, Email, Id, Obj, Pagination, Text, Type } from '../lib/schemas.js';
import { createPaymobPaymentSession, verifyPaymobHmac } from '../lib/paymob.js';

interface OrderRecord {
  id: string;
  tenant_id: string;
  total_cents: number;
  currency: string;
  status: string;
  payment_method: string;
  payment_status: string;
  [key: string]: any;
}

async function getOrderDetails(sql: Sql, tenantId: string, orderId: string): Promise<OrderRecord & { items: any[] }> {
  const [order] = await sql.query<OrderRecord>('SELECT * FROM orders WHERE tenant_id=$1 AND id=$2', [tenantId, orderId]);
  if (!order) notFound('Order');
  const items = await sql.query('SELECT * FROM order_items WHERE tenant_id=$1 AND order_id=$2 ORDER BY id', [tenantId, orderId]);
  return { ...order, items };
}

export async function checkoutRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();

  // 1. Categories for storefront
  app.get('/api/v1/storefront/:slug/categories', {
    schema: {
      tags: ['Storefront'],
      params: Obj({ slug: Type.String({ minLength: 3, maxLength: 60, pattern: '^[a-z0-9-]+$' }) }),
    },
  }, async (r) => {
    const [store] = await app.db.query('SELECT id FROM tenants WHERE slug=$1', [r.params.slug]);
    if (!store) notFound('Store');
    const categories = await app.db.query('SELECT id, name FROM categories WHERE tenant_id=$1 ORDER BY name', [store.id]);
    return { data: categories };
  });

  // 2. Public Storefront Products with Category filter, Search, and image_url
  app.get('/api/v1/storefront/:slug/products', {
    schema: {
      tags: ['Storefront'],
      params: Obj({ slug: Type.String({ minLength: 3, maxLength: 60, pattern: '^[a-z0-9-]+$' }) }),
      querystring: Obj({
        ...Pagination.properties,
        search: Type.Optional(Type.String({ maxLength: 100 })),
        categoryId: Type.Optional(Id),
      }),
    },
  }, async (r) => {
    const [store] = await app.db.query('SELECT id,name,slug,currency,shipping_cents,tax_basis_points FROM tenants WHERE slug=$1', [r.params.slug]);
    if (!store) notFound('Store');
    const { page = 1, limit = 24, search, categoryId } = r.query;
    const where = 'tenant_id=$1 AND active=true AND ($2::text IS NULL OR name ILIKE $2 OR description ILIKE $2) AND ($3::uuid IS NULL OR category_id=$3)';
    const values = [store.id, search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null, categoryId ?? null];

    const [count] = await app.db.query(`SELECT count(*)::int AS total FROM products WHERE ${where}`, values);
    const products = await app.db.query(`SELECT id,name,description,price_cents,category_id,(stock>0) AS in_stock,image_url
      FROM products WHERE ${where} ORDER BY created_at DESC,id LIMIT $4 OFFSET $5`,
    [...values, limit, (page - 1) * limit]);

    return {
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
        currency: store.currency,
        shipping_cents: store.shipping_cents,
        tax_basis_points: store.tax_basis_points,
      },
      data: products,
      total: count!.total,
      page,
      limit,
    };
  });

  // 3. Customer Storefront Checkout (Cash on Delivery or Paymob)
  app.post('/api/v1/storefront/:slug/checkout', {
    schema: {
      tags: ['Storefront'],
      summary: 'Place a customer order with Cash on Delivery or Paymob payment gateway',
      params: Obj({ slug: Type.String({ minLength: 3, maxLength: 60, pattern: '^[a-z0-9-]+$' }) }),
      headers: Type.Object({
        'idempotency-key': Type.String({ minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }),
      }),
      body: Obj({
        customerName: Text(150),
        customerEmail: Email,
        customerPhone: Type.String({ minLength: 6, maxLength: 40 }),
        shippingAddress: Address,
        items: Type.Array(
          Obj({ productId: Id, quantity: Type.Integer({ minimum: 1, maximum: 1000 }) }),
          { minItems: 1, maxItems: 100 },
        ),
        couponCode: Type.Optional(Type.String({ minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$' })),
        paymentMethod: Type.Union([Type.Literal('cod'), Type.Literal('paymob')]),
      }),
    },
  }, async (r, reply) => {
    const [store] = await app.db.query('SELECT * FROM tenants WHERE slug=$1', [r.params.slug]);
    if (!store) notFound('Store');
    const paymobConfig = {
      apiKey: store.paymob_api_key || app.config.paymobApiKey,
      integrationId: store.paymob_integration_id || app.config.paymobIntegrationId,
      iframeId: store.paymob_iframe_id || app.config.paymobIframeId,
      hmacSecret: store.paymob_hmac || app.config.paymobHmac,
    };
    if (r.body.paymentMethod === 'paymob' && app.config.nodeEnv === 'production' &&
        (!paymobConfig.apiKey || !paymobConfig.integrationId || !paymobConfig.hmacSecret)) {
      throw new ApiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Paymob is not fully configured.');
    }

    const items = [...r.body.items].sort((a, b) => a.productId.localeCompare(b.productId));
    if (new Set(items.map((i) => i.productId)).size !== items.length) {
      throw new ApiError(400, 'DUPLICATE_PRODUCT', 'Combine duplicate products into a single order item.');
    }

    const canonicalAddress = Object.fromEntries(
      Object.entries(r.body.shippingAddress).sort(([a], [b]) => a.localeCompare(b)),
    );
    const requestHash = digest(JSON.stringify({
      email: r.body.customerEmail.toLowerCase(),
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      couponCode: r.body.couponCode?.toUpperCase() ?? null,
      shippingAddress: canonicalAddress,
      paymentMethod: r.body.paymentMethod,
    }));

    const result = await app.db.transaction(async (tx) => {
      await lockStore(tx, store.id);

      // Check subscription
      const [subscription] = await tx.query('SELECT status FROM subscriptions WHERE tenant_id=$1', [store.id]);
      if (subscription?.status !== 'active') {
        throw new ApiError(403, 'STORE_UNAVAILABLE', 'This store is temporarily unavailable for orders.');
      }

      // Check idempotency
      const [existing] = await tx.query(
        'SELECT id,request_hash FROM orders WHERE tenant_id=$1 AND idempotency_key=$2',
        [store.id, r.headers['idempotency-key']],
      );
      if (existing) {
        if (existing.request_hash !== requestHash) {
          conflict('Idempotency key was already used for a different request.');
        }
        return { order: await getOrderDetails(tx, store.id, existing.id), replay: true };
      }

      // Quota check
      await enforceQuota(tx, store.id, 'ordersPerMonth');

      // Link or Create customer
      let [customer] = await tx.query(
        'SELECT id FROM customers WHERE tenant_id=$1 AND email=$2',
        [store.id, r.body.customerEmail.toLowerCase()],
      );
      if (!customer) {
        const customerId = randomUUID();
        [customer] = await tx.query(
          `INSERT INTO customers(id,tenant_id,name,email,phone,address)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            customerId,
            store.id,
            r.body.customerName,
            r.body.customerEmail.toLowerCase(),
            r.body.customerPhone,
            JSON.stringify(r.body.shippingAddress),
          ],
        );
      } else {
        await tx.query(
          `UPDATE customers SET name=$3, phone=$4, address=$5 WHERE tenant_id=$1 AND id=$2`,
          [store.id, customer.id, r.body.customerName, r.body.customerPhone, JSON.stringify(r.body.shippingAddress)],
        );
      }

      // Verify stock & calculate subtotal
      const lines: { product: Record<string, any>; quantity: number }[] = [];
      let subtotal = 0;
      for (const item of items) {
        const [product] = await tx.query(
          'SELECT * FROM products WHERE tenant_id=$1 AND id=$2 AND active=true FOR UPDATE',
          [store.id, item.productId],
        );
        if (!product) notFound('Active product');
        if (product.stock < item.quantity) {
          throw new ApiError(409, 'INSUFFICIENT_STOCK', `Not enough stock available for ${product.name}.`);
        }
        subtotal += product.price_cents * item.quantity;
        lines.push({ product, quantity: item.quantity });
      }

      // Coupon application
      let coupon: Record<string, any> | undefined;
      let discount = 0;
      if (r.body.couponCode) {
        [coupon] = await tx.query(
          `SELECT * FROM coupons WHERE tenant_id=$1 AND code=$2 AND active AND expires_at>now() AND used<max_uses FOR UPDATE`,
          [store.id, r.body.couponCode.toUpperCase()],
        );
        if (!coupon) throw new ApiError(400, 'INVALID_COUPON', 'Coupon is invalid, expired, or exhausted.');
        discount = Math.floor((subtotal * coupon.percent) / 100);
      }

      const tax = Math.round(((subtotal - discount) * store.tax_basis_points) / 10000);
      const total = subtotal - discount + tax + store.shipping_cents;
      if (total > 2_000_000_000) {
        throw new ApiError(400, 'ORDER_TOO_LARGE', 'Order value exceeds supported limit.');
      }

      const orderId = randomUUID();
      const paymentMethod = r.body.paymentMethod;

      await tx.query(
        `INSERT INTO orders(id,tenant_id,customer_id,currency,subtotal_cents,discount_cents,
         tax_cents,shipping_cents,total_cents,coupon_id,shipping_address,idempotency_key,request_hash,
         payment_method,payment_status,customer_email,customer_phone)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          orderId,
          store.id,
          customer!.id,
          store.currency,
          subtotal,
          discount,
          tax,
          store.shipping_cents,
          total,
          coupon?.id ?? null,
          JSON.stringify(r.body.shippingAddress),
          r.headers['idempotency-key'],
          requestHash,
          paymentMethod,
          'unpaid',
          r.body.customerEmail.toLowerCase(),
          r.body.customerPhone,
        ],
      );

      for (const { product, quantity } of lines) {
        await tx.query(
          `INSERT INTO order_items(id,tenant_id,order_id,product_id,name,sku,quantity,unit_price_cents)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), store.id, orderId, product.id, product.name, product.sku, quantity, product.price_cents],
        );
        await tx.query(
          'UPDATE products SET stock=stock-$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',
          [store.id, product.id, quantity],
        );
        await tx.query(
          `INSERT INTO inventory_movements(id,tenant_id,product_id,delta,reason,order_id)
           VALUES($1,$2,$3,$4,'storefront checkout',$5)`,
          [randomUUID(), store.id, product.id, -quantity, orderId],
        );
      }

      if (coupon) {
        await tx.query('UPDATE coupons SET used=used+1 WHERE tenant_id=$1 AND id=$2', [store.id, coupon.id]);
      }

      return { order: await getOrderDetails(tx, store.id, orderId), replay: false };
    });

    const order = result.order;
    let paymentData: Record<string, any> = { method: r.body.paymentMethod };

    if (r.body.paymentMethod === 'paymob') {
      const paymobSession = await createPaymobPaymentSession(paymobConfig, {
        amountCents: order.total_cents,
        currency: order.currency,
        merchantOrderId: order.id,
        customer: {
          name: r.body.customerName,
          email: r.body.customerEmail,
          phone: r.body.customerPhone,
          line1: r.body.shippingAddress.line1,
          city: r.body.shippingAddress.city,
          country: r.body.shippingAddress.country,
        },
        slug: store.slug,
      }, { allowSimulation: app.config.nodeEnv !== 'production' });

      // Save payment reference
      await app.db.query(
        'UPDATE orders SET payment_reference=$2 WHERE id=$1',
        [order.id, paymobSession.paymobOrderId],
      );

      paymentData = {
        method: 'paymob',
        paymobOrderId: paymobSession.paymobOrderId,
        paymentKey: paymobSession.paymentKey,
        paymentUrl: paymobSession.paymentUrl,
        isSimulated: paymobSession.isSimulated,
      };
    } else {
      paymentData = {
        method: 'cod',
        message: 'Order created successfully with Cash on Delivery. Cash will be collected upon delivery.',
      };
    }

    reply.header('Idempotency-Replayed', String(result.replay));
    return reply.code(result.replay ? 200 : 201).send({
      order,
      payment: paymentData,
    });
  });

  // 4. Public Order Tracking (Customers can check order by ID)
  app.get('/api/v1/storefront/:slug/orders/:id', {
    schema: {
      tags: ['Storefront'],
      params: Obj({
        slug: Type.String({ minLength: 3, maxLength: 60, pattern: '^[a-z0-9-]+$' }),
        id: Id,
      }),
    },
  }, async (r) => {
    const [store] = await app.db.query('SELECT id, name, slug, currency FROM tenants WHERE slug=$1', [r.params.slug]);
    if (!store) notFound('Store');
    const order = await getOrderDetails(app.db, store.id, r.params.id);
    return {
      store,
      order: {
        id: order.id,
        status: order.status,
        payment_status: order.payment_status,
        payment_method: order.payment_method,
        currency: order.currency,
        created_at: order.created_at,
        subtotal_cents: order.subtotal_cents,
        discount_cents: order.discount_cents,
        tax_cents: order.tax_cents,
        shipping_cents: order.shipping_cents,
        total_cents: order.total_cents,
        items: order.items.map(({ name, sku, quantity, unit_price_cents }) => ({ name, sku, quantity, unit_price_cents })),
      },
    };
  });

  // 5. Paymob Webhook / Callback Handler
  app.post('/api/v1/payments/paymob/webhook', {
    schema: { tags: ['Payments'] },
  }, async (r, reply) => {
    const body = r.body as Record<string, any>;
    const obj = body.obj || body;
    const orderId = obj.order?.merchant_order_id || obj.merchant_order_id;
    const success = obj.success === true || obj.success === 'true';

    if (!orderId) {
      return reply.code(400).send({ error: 'Missing merchant_order_id' });
    }

    const [order] = await app.db.query('SELECT * FROM orders WHERE id=$1', [orderId]);
    if (!order) return reply.code(404).send({ error: 'Order not found' });

    const [store] = await app.db.query('SELECT paymob_hmac FROM tenants WHERE id=$1', [order.tenant_id]);
    const hmacSecret = store?.paymob_hmac || app.config.paymobHmac;

    if (!hmacSecret) {
      return reply.code(503).send({ error: 'Paymob webhook HMAC is not configured' });
    }
    if (!verifyPaymobHmac(obj, hmacSecret)) {
      return reply.code(400).send({ error: 'Invalid HMAC signature' });
    }
    if (order.payment_method !== 'paymob' || !order.payment_reference ||
        Number(obj.amount_cents) !== Number(order.total_cents) ||
        String(obj.currency) !== String(order.currency) ||
        String(obj.order?.id) !== String(order.payment_reference)) {
      return reply.code(400).send({ error: 'Payment details do not match the order' });
    }

    if (success) {
      await app.db.query(
        `UPDATE orders SET payment_status='paid', status=CASE WHEN status='pending' THEN 'confirmed' ELSE status END,
         updated_at=now() WHERE id=$1`,
        [order.id],
      );
    }

    return reply.code(200).send({ status: 'ok', success });
  });

  // 6. Interactive Paymob Simulator Confirmation (for testing and demo)
  app.post('/api/v1/payments/paymob/mock-pay', {
    schema: {
      tags: ['Payments'],
      body: Obj({
        orderId: Id,
        success: Type.Boolean(),
        transactionId: Type.Optional(Type.String()),
      }),
    },
  }, async (r) => {
    if (app.config.nodeEnv === 'production') notFound('Payment simulator');
    const [order] = await app.db.query('SELECT * FROM orders WHERE id=$1', [r.body.orderId]);
    if (!order) notFound('Order');
    if (order.payment_method !== 'paymob' || !String(order.payment_reference ?? '').startsWith('pm_ord_')) {
      notFound('Simulated payment');
    }

    if (r.body.success) {
      await app.db.query(
        `UPDATE orders SET payment_status='paid', status=CASE WHEN status='pending' THEN 'confirmed' ELSE status END,
         updated_at=now() WHERE id=$1`,
        [order.id],
      );
    }

    return getOrderDetails(app.db, order.tenant_id, order.id);
  });
}

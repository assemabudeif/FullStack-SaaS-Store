import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const config: Config = {
  nodeEnv: 'test', host: '127.0.0.1', port: 3000,
  jwtSecret: 'test-secret-only-not-for-production-0123456789',
  dataDir: 'memory://', corsOrigins: ['http://localhost:5173'], sandboxBilling: true, logger: false,
};
let app: Awaited<ReturnType<typeof buildApp>>;
let owner: any, other: any, member: any, product: any, customer: any, category: any;
const auth = (account = owner, tenant = account.store.id) => ({
  authorization: `Bearer ${account.accessToken}`, 'x-tenant-id': tenant,
});
async function register(email: string, slug: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register',
    payload: { name: email, email, password: 'Secure-password-123!', storeName: slug, storeSlug: slug } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}
async function createOrder(quantity = 1, key: string = randomUUID(), extras = {}) {
  return app.inject({ method: 'POST', url: '/api/v1/orders',
    headers: { ...auth(), 'idempotency-key': key }, payload: { customerId: customer.id, items: [{ productId: product.id, quantity }], ...extras } });
}
beforeAll(async () => {
  // Set TEST_DATABASE_URL to exercise exactly the same suite against a real PostgreSQL server.
  app = await buildApp({ ...config, databaseUrl: process.env.TEST_DATABASE_URL });
  owner = await register('owner@test.com', 'test-store');
  other = await register('other@test.com', 'other-store');
  member = await register('member@test.com', 'member-store');
});
afterAll(async () => { await app?.close(); });

describe('infrastructure and authentication', () => {
  it('serves health, readiness and OpenAPI documentation', async () => {
    for (const url of ['/health', '/ready', '/docs/json', '/docs/']) {
      const response = await app.inject({ url });
      expect(response.statusCode, response.body).toBe(200);
    }
    const spec = (await app.inject({ url: '/docs/json' })).json();
    expect(spec.paths['/api/v1/products']).toBeDefined();
    const headers = spec.paths['/api/v1/orders'].post.parameters;
    expect(headers.some((p: any) => p.name === 'x-tenant-id' && p.required)).toBe(true);
    expect(headers.some((p: any) => p.name === 'idempotency-key' && p.required)).toBe(true);
  });
  it('rejects weak passwords, unexpected fields and duplicate accounts', async () => {
    const base = { name: 'User', email: 'new@test.com', password: 'short', storeName: 'New', storeSlug: 'new-store' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: base })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: {
      ...base, password: 'Secure-password-123!', role: 'owner',
    } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: {
      ...base, password: 'Secure-password-123!', email: 'owner@test.com',
    } })).statusCode).toBe(409);
  });
  it('authenticates case-insensitive email and rejects incorrect credentials', async () => {
    const good = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
      payload: { email: 'OWNER@test.com', password: 'Secure-password-123!' } });
    expect(good.statusCode).toBe(200);
    expect(good.json().user).not.toHaveProperty('password_hash');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@test.com', password: 'wrong' } });
    expect(bad.statusCode).toBe(401);
  });
  it('rotates single-use refresh tokens and invalidates previous access tokens', async () => {
    const rotated = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: other.refreshToken } });
    expect(rotated.statusCode, rotated.body).toBe(200);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: auth(other) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: other.refreshToken } })).statusCode).toBe(401);
    Object.assign(other, rotated.json());
    expect((await app.inject({ url: '/api/v1/auth/me', headers: auth(other) })).statusCode).toBe(200);
  });
  it('requires authentication and a valid tenant header', async () => {
    expect((await app.inject({ url: '/api/v1/products' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/products', headers: { authorization: auth().authorization } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/v1/products', headers: auth(owner, other.store.id) })).statusCode).toBe(404);
  });
});

describe('catalog, customers, and tenant isolation', () => {
  it('creates category, product and customer records', async () => {
    const cat = await app.inject({ method: 'POST', url: '/api/v1/categories', headers: auth(), payload: { name: 'Electronics' } });
    expect(cat.statusCode, cat.body).toBe(201); category = cat.json();
    const prod = await app.inject({ method: 'POST', url: '/api/v1/products', headers: auth(),
      payload: { name: 'Keyboard', sku: 'KB-001', priceCents: 1000, initialStock: 20, categoryId: category.id } });
    expect(prod.statusCode, prod.body).toBe(201); product = prod.json();
    const cust = await app.inject({ method: 'POST', url: '/api/v1/customers', headers: auth(),
      payload: { name: 'Customer', email: 'customer@test.com', address: { city: 'Cairo', country: 'EG' } } });
    expect(cust.statusCode, cust.body).toBe(201); customer = cust.json();
  });
  it('prevents cross-tenant reads, updates, category references and order references', async () => {
    expect((await app.inject({ url: `/api/v1/products/${product.id}`, headers: auth(other) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/products/${product.id}`, headers: auth(other), payload: { name: 'Stolen' } })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/customers/${customer.id}`, headers: auth(other) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/products', headers: auth(other),
      payload: { name: 'Bad', sku: 'BAD', priceCents: 1, categoryId: category.id } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { ...auth(other), 'idempotency-key': randomUUID() },
      payload: { customerId: customer.id, items: [{ productId: product.id, quantity: 1 }] } })).statusCode).toBe(404);
    const list = await app.inject({ url: '/api/v1/products', headers: auth(other) });
    expect(list.json().total).toBe(0);
  });
  it('validates money and pagination and rejects price mass assignment', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/products', headers: auth(),
      payload: { name: 'Bad', sku: 'BAD', priceCents: 1.1 } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/v1/products?limit=1000', headers: auth() })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/v1/products?search=Key&active=true', headers: auth() })).json().total).toBe(1);
    const response = await createOrder(1, randomUUID(), { totalCents: 1 });
    expect(response.statusCode).toBe(400);
  });
  it('exposes only safe active product fields publicly', async () => {
    const response = await app.inject({ url: '/api/v1/storefront/test-store/products' });
    expect(response.statusCode).toBe(200);
    const publicProduct = response.json().data[0];
    expect(publicProduct.name).toBe('Keyboard');
    for (const field of ['tenant_id', 'stock', 'sku']) expect(publicProduct).not.toHaveProperty(field);
  });
  it('supports category and customer updates without losing order-safe references', async () => {
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/categories/${category.id}`, headers: auth(), payload: { name: 'Accessories' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/customers/${customer.id}`, headers: auth(), payload: { phone: '+20123456789' } })).json().phone).toBe('+20123456789');
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/categories/${category.id}`, headers: auth() })).statusCode).toBe(409);
  });
});

describe('transactional commerce', () => {
  it('computes discount, tax, shipping and stock on the server', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/store', headers: auth(),
      payload: { taxBasisPoints: 1000, shippingCents: 200 } })).statusCode).toBe(200);
    const coupon = await app.inject({ method: 'POST', url: '/api/v1/coupons', headers: auth(),
      payload: { code: 'SAVE10', percent: 10, maxUses: 10, expiresAt: new Date(Date.now() + 86400000).toISOString() } });
    expect(coupon.statusCode, coupon.body).toBe(201);
    const response = await createOrder(2, 'price-check-001', { couponCode: 'save10' });
    expect(response.statusCode, response.body).toBe(201);
    const order = response.json();
    expect(order.subtotal_cents).toBe(2000);
    expect(order.discount_cents).toBe(200);
    expect(order.tax_cents).toBe(180);
    expect(order.total_cents).toBe(2180);
    expect((await app.inject({ url: `/api/v1/products/${product.id}`, headers: auth() })).json().stock).toBe(18);
    const cancel = await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: auth(), payload: { status: 'cancelled' } });
    expect(cancel.statusCode, cancel.body).toBe(200);
  });
  it('replays idempotent requests without double-decrementing stock', async () => {
    const first = await createOrder(1, 'retry-order-001');
    expect(first.statusCode, first.body).toBe(201);
    const second = await createOrder(1, 'retry-order-001');
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.json().id).toBe(first.json().id);
    expect((await createOrder(2, 'retry-order-001')).statusCode).toBe(409);
    expect((await app.inject({ url: `/api/v1/products/${product.id}`, headers: auth() })).json().stock).toBe(19);
  });
  it('rolls back failed orders and invalid coupons', async () => {
    const tooLarge = await createOrder(100);
    expect(tooLarge.statusCode).toBe(409);
    expect(tooLarge.json().error.code).toBe('INSUFFICIENT_STOCK');
    expect((await createOrder(1, randomUUID(), { couponCode: 'MISSING' })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/v1/products/${product.id}`, headers: auth() })).json().stock).toBe(19);
    expect((await app.inject({ method: 'POST', url: '/api/v1/orders', headers: auth(),
      payload: { customerId: customer.id, items: [{ productId: product.id, quantity: 1 }] } })).statusCode).toBe(400);
  });
  it('prevents overselling under concurrent requests', async () => {
    const responses = await Promise.all([createOrder(15), createOrder(15)]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await app.inject({ url: `/api/v1/products/${product.id}`, headers: auth() })).json().stock).toBe(4);
    const order = responses.find((r) => r.statusCode === 201)!.json();
    await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: auth(), payload: { status: 'cancelled' } });
    await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: auth(), payload: { status: 'cancelled' } });
    expect((await app.inject({ url: `/api/v1/products/${product.id}`, headers: auth() })).json().stock).toBe(19);
  });
  it('preserves snapshot prices and enforces the fulfillment state machine', async () => {
    const response = await createOrder(1);
    expect(response.statusCode).toBe(201);
    const order = response.json();
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: auth(), payload: { status: 'completed' } })).statusCode).toBe(409);
    await app.inject({ method: 'PATCH', url: `/api/v1/products/${product.id}`, headers: auth(), payload: { priceCents: 1500 } });
    expect((await app.inject({ url: `/api/v1/orders/${order.id}`, headers: auth() })).json().items[0].unit_price_cents).toBe(1000);
    for (const status of ['confirmed', 'shipped', 'completed']) {
      expect((await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: auth(), payload: { status } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: auth(), payload: { status: 'cancelled' } })).statusCode).toBe(409);
    const analytics = await app.inject({ url: '/api/v1/analytics/summary', headers: auth() });
    expect(analytics.statusCode, analytics.body).toBe(200);
    expect(analytics.json().completed).toBe(1);
  });
  it('records stock changes and rejects negative inventory', async () => {
    const bad = await app.inject({ method: 'POST', url: `/api/v1/products/${product.id}/inventory`, headers: auth(), payload: { delta: -100, reason: 'Count correction' } });
    expect(bad.statusCode).toBe(409);
    const good = await app.inject({ method: 'POST', url: `/api/v1/products/${product.id}/inventory`, headers: auth(), payload: { delta: 2, reason: 'Restocked' } });
    expect(good.statusCode).toBe(200);
    const moves = await app.inject({ url: `/api/v1/inventory/movements?productId=${product.id}`, headers: auth() });
    expect(moves.json().data.some((m: any) => m.reason === 'Restocked')).toBe(true);
    const logs = await app.inject({ url: '/api/v1/audit-logs?limit=100', headers: auth() });
    expect(logs.json().data.some((l: any) => l.action === 'order.created')).toBe(true);
  });
  it('retains referenced customers and rejects duplicate order items', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/customers/${customer.id}`, headers: auth() })).statusCode).toBe(409);
    const response = await createOrder(1, randomUUID(), { items: [{ productId: product.id, quantity: 1 }, { productId: product.id, quantity: 1 }] });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('DUPLICATE_PRODUCT');
  });
  it('handles concurrent retries as a single order', async () => {
    const key = randomUUID();
    const responses = await Promise.all([createOrder(1, key), createOrder(1, key)]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(responses[0]!.json().id).toBe(responses[1]!.json().id);
    await app.inject({ method: 'PATCH', url: `/api/v1/orders/${responses[0]!.json().id}/status`, headers: auth(), payload: { status: 'cancelled' } });
  });
  it('atomically enforces a one-use coupon and restores its use on cancellation', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/coupons', headers: auth(),
      payload: { code: 'ONEUSE', percent: 25, maxUses: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() } });
    expect(created.statusCode).toBe(201);
    const responses = await Promise.all([createOrder(1, randomUUID(), { couponCode: 'ONEUSE' }), createOrder(1, randomUUID(), { couponCode: 'ONEUSE' })]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    const order = responses.find((r) => r.statusCode === 201)!.json();
    await app.inject({ method: 'PATCH', url: `/api/v1/orders/${order.id}/status`, headers: auth(), payload: { status: 'cancelled' } });
    const retry = await createOrder(1, randomUUID(), { couponCode: 'ONEUSE' });
    expect(retry.statusCode, retry.body).toBe(201);
    await app.inject({ method: 'PATCH', url: `/api/v1/orders/${retry.json().id}/status`, headers: auth(), payload: { status: 'cancelled' } });
  });
  it('rolls back a multi-line order with a missing product', async () => {
    const before = (await app.inject({ url: `/api/v1/products/${product.id}`, headers: auth() })).json().stock;
    const response = await createOrder(1, randomUUID(), { items: [
      { productId: product.id, quantity: 1 }, { productId: randomUUID(), quantity: 1 },
    ] });
    expect(response.statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/products/${product.id}`, headers: auth() })).json().stock).toBe(before);
  });
});

describe('SaaS team, subscription and session security', () => {
  it('protects the last owner', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/members/${owner.user.id}`, headers: auth() })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/members/${owner.user.id}`, headers: auth(), payload: { role: 'staff' } })).statusCode).toBe(409);
  });
  it('enforces viewer permissions and revokes removed member access', async () => {
    const add = await app.inject({ method: 'POST', url: '/api/v1/members', headers: auth(), payload: { email: 'member@test.com', role: 'viewer' } });
    expect(add.statusCode, add.body).toBe(201);
    const memberHeaders = auth(member, owner.store.id);
    expect((await app.inject({ url: '/api/v1/products', headers: memberHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/products', headers: memberHeaders,
      payload: { name: 'Forbidden', sku: 'FORBIDDEN', priceCents: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/members', headers: memberHeaders })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/members/${member.user.id}`, headers: auth() })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/products', headers: memberHeaders })).statusCode).toBe(404);
  });
  it('reports plan usage and changes plans only in sandbox', async () => {
    const subscription = await app.inject({ url: '/api/v1/subscription', headers: auth() });
    expect(subscription.json().plan).toBe('free');
    expect(subscription.json().usage.products).toBe(1);
    const change = await app.inject({ method: 'POST', url: '/api/v1/subscription/sandbox-plan', headers: auth(), payload: { plan: 'pro' } });
    expect(change.statusCode, change.body).toBe(200);
    expect(change.json().plan).toBe('pro');
    app.config.sandboxBilling = false;
    expect((await app.inject({ method: 'POST', url: '/api/v1/subscription/sandbox-plan', headers: auth(), payload: { plan: 'business' } })).statusCode).toBe(403);
    app.config.sandboxBilling = true;
  });
  it('enforces product, reactivation, member and monthly-order quotas', async () => {
    // SQL fixture insertion avoids exercising the rate limiter 150 times.
    await app.db.query(`INSERT INTO products(id,tenant_id,name,sku,price_cents,stock)
      SELECT gen_random_uuid(),$1,'Quota Product','QUOTA-'||n,100,10 FROM generate_series(1,50) n`, [other.store.id]);
    const full = await app.inject({ method: 'POST', url: '/api/v1/products', headers: auth(other),
      payload: { name: 'Overflow', sku: 'OVERFLOW', priceCents: 100 } });
    expect(full.statusCode).toBe(403); expect(full.json().error.code).toBe('PLAN_LIMIT');
    const [archived] = await app.db.query('SELECT id FROM products WHERE tenant_id=$1 ORDER BY sku LIMIT 1', [other.store.id]);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/products/${archived!.id}`, headers: auth(other) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/v1/products', headers: auth(other),
      payload: { name: 'Replacement', sku: 'REPLACEMENT', priceCents: 100, initialStock: 10 } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/products/${archived!.id}`, headers: auth(other), payload: { active: true } })).statusCode).toBe(403);
    await app.db.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer'),($1,$3,'viewer')",
      [other.store.id, owner.user.id, member.user.id]);
    expect((await app.inject({ method: 'POST', url: '/api/v1/members', headers: auth(other),
      payload: { email: 'owner@test.com', role: 'staff' } })).json().error.code).toBe('PLAN_LIMIT');
    const quotaCustomer = randomUUID();
    await app.db.query('INSERT INTO customers(id,tenant_id,name,email) VALUES($1,$2,$3,$4)',
      [quotaCustomer, other.store.id, 'Quota Customer', 'quota@test.com']);
    await app.db.query(`INSERT INTO orders(id,tenant_id,customer_id,created_by,status,currency,subtotal_cents,
      discount_cents,tax_cents,shipping_cents,total_cents,idempotency_key,request_hash)
      SELECT gen_random_uuid(),$1,$2,$3,'cancelled','USD',0,0,0,0,0,'quota-'||n,'fixture'
      FROM generate_series(1,100) n`, [other.store.id, quotaCustomer, other.user.id]);
    const [quotaProduct] = await app.db.query('SELECT id FROM products WHERE tenant_id=$1 AND active LIMIT 1', [other.store.id]);
    const blockedOrder = await app.inject({ method: 'POST', url: '/api/v1/orders',
      headers: { ...auth(other), 'idempotency-key': randomUUID() },
      payload: { customerId: quotaCustomer, items: [{ productId: quotaProduct!.id, quantity: 1 }] } });
    expect(blockedOrder.statusCode).toBe(403); expect(blockedOrder.json().error.code).toBe('PLAN_LIMIT');
  });
  it('makes suspended subscriptions read-only', async () => {
    await app.db.query("UPDATE subscriptions SET status='suspended' WHERE tenant_id=$1", [other.store.id]);
    expect((await app.inject({ url: '/api/v1/products', headers: auth(other) })).statusCode).toBe(200);
    const write = await app.inject({ method: 'PATCH', url: '/api/v1/store', headers: auth(other), payload: { name: 'Blocked change' } });
    expect(write.statusCode).toBe(403); expect(write.json().error.code).toBe('SUBSCRIPTION_INACTIVE');
    await app.db.query("UPDATE subscriptions SET status='active' WHERE tenant_id=$1", [other.store.id]);
  });
  it('archives products without removing historical order items', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/products/${product.id}`, headers: auth() })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/storefront/test-store/products' })).json().total).toBe(0);
    expect((await createOrder(1)).statusCode).toBe(404);
    const list = await app.inject({ url: '/api/v1/orders', headers: auth() });
    expect(list.json().total).toBeGreaterThan(0);
  });
  it('revokes access and refresh tokens on logout', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: auth(other) })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/auth/me', headers: auth(other) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: other.refreshToken } })).statusCode).toBe(401);
  });
  it('rate-limits auth attempts with a structured error', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', remoteAddress: '192.0.2.99',
        payload: { refreshToken: 'a'.repeat(64) } });
      statuses.push(response.statusCode);
      if (i === 10) expect(response.json().error.code).toBe('RATE_LIMITED');
    }
    expect(statuses).toEqual([...Array<number>(10).fill(401), 429]);
  });
});

describe('public customer checkout and payment gateways', () => {
  it('places customer order with Cash on Delivery from public storefront', async () => {
    // Reactivate product if archived
    await app.inject({ method: 'PATCH', url: `/api/v1/products/${product.id}`, headers: auth(), payload: { active: true } });
    const key = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/test-store/checkout',
      headers: { 'idempotency-key': key },
      payload: {
        customerName: 'Ahmed Customer',
        customerEmail: 'ahmed@customer.com',
        customerPhone: '+201012345678',
        shippingAddress: { line1: '45 Nile Corniche', city: 'Cairo', country: 'EG' },
        items: [{ productId: product.id, quantity: 2 }],
        paymentMethod: 'cod',
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.order.payment_method).toBe('cod');
    expect(body.order.payment_status).toBe('unpaid');
    expect(body.payment.method).toBe('cod');

    // Customer can track order publicly
    const track = await app.inject({ url: `/api/v1/storefront/test-store/orders/${body.order.id}` });
    expect(track.statusCode).toBe(200);
    expect(track.json().order.id).toBe(body.order.id);

    // Staff can update payment status for Cash on Delivery
    const markPaid = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${body.order.id}/payment`,
      headers: auth(),
      payload: { paymentStatus: 'paid', paymentReference: 'COD-CASH-REC-01' },
    });
    expect(markPaid.statusCode).toBe(200);
    expect(markPaid.json().payment_status).toBe('paid');
  });

  it('initiates Paymob payment and confirms order upon successful payment', async () => {
    const key = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/test-store/checkout',
      headers: { 'idempotency-key': key },
      payload: {
        customerName: 'Sara Ali',
        customerEmail: 'sara@paymob-test.com',
        customerPhone: '+201098765432',
        shippingAddress: { line1: '12 Tahrir Square', city: 'Cairo', country: 'EG' },
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'paymob',
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.order.payment_method).toBe('paymob');
    expect(body.payment.method).toBe('paymob');
    expect(body.payment.paymentUrl).toBeDefined();

    // Simulate successful Paymob card payment
    const mockPay = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/paymob/mock-pay',
      payload: { orderId: body.order.id, success: true, transactionId: 'TXN-PAYMOB-98765' },
    });
    expect(mockPay.statusCode).toBe(200);
    expect(mockPay.json().payment_status).toBe('paid');
    expect(mockPay.json().status).toBe('confirmed');
  });
});


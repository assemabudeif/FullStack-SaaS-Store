import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { randomBytes } from 'node:crypto';

const config = loadConfig();
if (config.nodeEnv === 'production') throw new Error('Demo seed is disabled in production.');
const app = await buildApp(config);
try {
  const password = process.env.SEED_PASSWORD ?? randomBytes(18).toString('base64url');
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register',
    payload: { name: 'Demo Owner', email: 'owner@example.com', password, storeName: 'Demo Store', storeSlug: 'demo-store' } });
  if (response.statusCode !== 201) throw new Error(`Seed requires a fresh database: ${response.body}`);
  const account = response.json();
  const headers = { authorization: `Bearer ${account.accessToken}`, 'x-tenant-id': account.store.id };
  const catRes = await app.inject({ method: 'POST', url: '/api/v1/categories', headers, payload: { name: 'Electronics & Gear' } });
  const categoryId = catRes.statusCode === 201 ? catRes.json().id : null;
  for (const [name, sku, priceCents, initialStock, imageUrl] of [
    ['Custom Mechanical Keyboard', 'KEYBOARD-001', 12999, 20, 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&q=80'],
    ['Ergonomic Wireless Mouse', 'MOUSE-001', 4999, 50, 'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=800&q=80'],
    ['High-Speed USB-C Multiport Hub', 'HUB-001', 6999, 15, 'https://images.unsplash.com/photo-1544652478-6653e09f18a2?w=800&q=80'],
    ['Studio ANC Headphones', 'AUDIO-001', 19999, 12, 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80'],
    ['Minimalist Desk Mat', 'DESK-001', 2999, 40, 'https://images.unsplash.com/photo-1629429408209-1f912961dbd8?w=800&q=80'],
  ] as const) {
    const product = await app.inject({ method: 'POST', url: '/api/v1/products', headers,
      payload: { name, sku, priceCents, initialStock, imageUrl, categoryId } });
    if (product.statusCode !== 201) throw new Error(product.body);
  }
  const customer = await app.inject({ method: 'POST', url: '/api/v1/customers', headers,
    payload: { name: 'Demo Customer', email: 'customer@example.com', address: { line1: '123 Demo Street', city: 'Cairo', country: 'EG' } } });
  if (customer.statusCode !== 201) throw new Error(customer.body);
  console.log(`Demo created.\nEmail: owner@example.com\nPassword: ${password}\nTenant: ${account.store.id}\nDocs: http://${config.host}:${config.port}/docs`);
} finally { await app.close(); }

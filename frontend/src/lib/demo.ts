import type { Audit, Category, Coupon, Customer, List, Member, Movement, Order, Product, Session, Store, Subscription, Summary } from '../types';
import { transitions } from './utils';

const STORE_ID = 'demo-workspace';
export const demoSession: Session = {
  mode: 'demo', user: { id: 'demo-owner', name: 'Alex Morgan', email: 'alex@studio.store' },
  stores: [{ id: STORE_ID, name: 'Studio Store', slug: 'studio-store', currency: 'USD', role: 'owner',
    tax_basis_points: 0, shipping_cents: 0, created_at: new Date().toISOString() }], tenantId: STORE_ID,
};
interface DemoData {
  version: 1; store: Store; products: Product[]; categories: Category[]; customers: Customer[];
  orders: Order[]; coupons: Coupon[]; members: Member[]; movements: Movement[]; audit: Audit[]; plan: Subscription['plan'];
}
export const limits = {
  free: { products: 50, members: 3, ordersPerMonth: 100 },
  pro: { products: 1000, members: 15, ordersPerMonth: 5000 },
  business: { products: 10000, members: 100, ordersPerMonth: 50000 },
};
function seed(): DemoData {
  const now = new Date();
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * 86400000 - hours * 3600000).toISOString();
  const categories = ['Audio & tech', 'Everyday essentials', 'Workspace', 'Accessories'].map((name, i) => ({ id: `category-${i}`, name }));
  const products: Product[] = [
    ['Studio Headphones', 'AUDIO-001', 18900, 42, 0, 'headphones'],
    ['Everyday Backpack', 'BAG-002', 8900, 28, 1, 'backpack'],
    ['Minimal Desk Lamp', 'DESK-003', 6500, 18, 2, 'lamp'],
    ['Classic Timepiece', 'WATCH-004', 14900, 7, 3, 'watch'],
    ['Wireless Keyboard', 'TECH-005', 9900, 36, 2, 'keyboard'],
    ['Insulated Bottle', 'LIFE-006', 3500, 4, 1, 'bottle'],
    ['Portable Speaker', 'AUDIO-007', 7900, 21, 0, 'speaker'],
    ['Leather Notebook', 'DESK-008', 2400, 3, 2, 'notebook'],
    ['Canvas Tote', 'BAG-009', 2900, 62, 1, 'backpack'],
    ['Desk Organizer', 'DESK-010', 4200, 16, 2, 'lamp'],
    ['Travel Camera', 'TECH-011', 24900, 12, 0, 'camera'],
    ['Everyday Sunglasses', 'STYLE-012', 5900, 0, 3, 'watch'],
  ].map(([name, sku, price, stock, category, image], i) => ({
    id: `product-${i}`, name: String(name), sku: String(sku), price_cents: Number(price), stock: Number(stock),
    category_id: categories[Number(category)].id, active: true, created_at: ago(i + 1),
    description: 'Thoughtfully designed. Made for the everyday. A considered addition to your collection.',
    image: `/images/${image}.jpg`,
  }));
  const people = ['Olivia Bennett', 'James Wilson', 'Emma Thompson', 'Noah Davis', 'Sophia Chen', 'Liam Anderson', 'Isabella Garcia', 'Ethan Brooks', 'Mia Robinson', 'Lucas Martin', 'Amelia Clark', 'Henry Lee'];
  const customers = people.map((name, i) => ({
    id: `customer-${i}`, name, email: `${name.toLowerCase().replaceAll(' ', '.')}@example.com`,
    phone: `+1 415 555 ${String(1010 + i)}`, address: { city: ['San Francisco', 'New York', 'Austin'][i % 3], country: 'US' }, created_at: ago(i * 2),
  }));
  const orders: Order[] = Array.from({ length: 64 }, (_, i) => {
    const product = products[i % products.length], quantity = i % 3 + 1;
    const second = products[(i + 4) % products.length];
    const statuses = ['completed', 'completed', 'completed', 'completed', 'shipped', 'confirmed', 'pending', 'cancelled'] as const;
    const items = [
      { id: `item-${i}-0`, product_id: product.id, name: product.name, sku: product.sku, quantity, unit_price_cents: product.price_cents },
      { id: `item-${i}-1`, product_id: second.id, name: second.name, sku: second.sku, quantity: 1, unit_price_cents: second.price_cents },
    ];
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0);
    return { id: `d${String(86400 + i)}-0000-4000-8000-000000000000`, customer_id: customers[i % customers.length].id,
      status: statuses[i % 8], currency: 'USD', created_at: ago(Math.floor(i / 2.3), i % 5),
      subtotal_cents: subtotal, discount_cents: 0, tax_cents: 0, shipping_cents: 0, total_cents: subtotal, items, shipping_address: customers[i % customers.length].address };
  });
  return {
    version: 1, store: structuredClone(demoSession.stores[0]), categories, products, customers, orders, plan: 'pro',
    coupons: [{ id: 'coupon-1', code: 'WELCOME10', percent: 10, max_uses: 100, used: 12, active: true, expires_at: new Date(now.getTime() + 90 * 86400000).toISOString() }],
    members: [
      { ...demoSession.user, role: 'owner', created_at: ago(80) },
      { id: 'member-2', name: 'Jordan Taylor', email: 'jordan@example.com', role: 'admin', created_at: ago(35) },
      { id: 'member-3', name: 'Sam Rivera', email: 'sam@example.com', role: 'staff', created_at: ago(21) },
    ],
    movements: products.map((p, i) => ({ id: `movement-${i}`, product_id: p.id, delta: p.stock, reason: 'Opening inventory', created_at: ago(i) })),
    audit: [
      { id: 'audit-1', actor_id: 'demo-owner', action: 'order.created', entity_id: orders[0].id, details: {}, created_at: ago(0, 1) },
      { id: 'audit-2', actor_id: 'member-2', action: 'inventory.adjusted', entity_id: products[1].id, details: { delta: 12 }, created_at: ago(0, 2) },
      { id: 'audit-3', actor_id: 'demo-owner', action: 'product.updated', entity_id: products[0].id, details: {}, created_at: ago(0, 4) },
      { id: 'audit-4', actor_id: 'member-3', action: 'customer.created', entity_id: customers[1].id, details: {}, created_at: ago(1) },
    ],
  };
}
let memory: DemoData | null = null;
function load(): DemoData {
  if (memory) return memory;
  try { const stored = JSON.parse(localStorage.getItem('storely-demo-v1') ?? 'null'); if (stored?.version === 1) return memory = stored; } catch { /* blocked or corrupt storage */ }
  return memory = seed();
}
function save(data: DemoData) { memory = data; try { localStorage.setItem('storely-demo-v1', JSON.stringify(data)); } catch { /* in-memory fallback */ } }
export function resetDemo() { memory = seed(); save(memory); }
function fail(message: string): never { throw new Error(message); }
function find<T extends { id: string }>(rows: T[], id: string): T { return rows.find((row) => row.id === id) ?? fail('Resource not found.'); }
function paginate<T>(rows: T[], params: URLSearchParams): List<T> {
  const page = Number(params.get('page') ?? 1), limit = Number(params.get('limit') ?? 20);
  return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
}
function usage(data: DemoData) {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  return { products: data.products.filter((p) => p.active).length, members: data.members.length,
    ordersPerMonth: data.orders.filter((o) => new Date(o.created_at) >= start).length };
}
export async function demoRequest<T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  // Work on a copy so failed mutations cannot leave partial changes behind.
  const data = structuredClone(load());
  const url = new URL(path, 'http://demo'), parts = url.pathname.split('/').filter(Boolean);
  const [resource, id, action] = parts;
  const input = (body ?? {}) as Record<string, any>;
  let result: unknown;
  let event = `${resource?.replace(/s$/, '')}.${method === 'POST' ? 'created' : method === 'DELETE' ? 'removed' : 'updated'}`;
  const now = new Date().toISOString(), newId = crypto.randomUUID();
  if (resource === 'storefront') {
    result = { store: { name: data.store.name, slug: data.store.slug, currency: data.store.currency }, ...paginate(data.products.filter((p) => p.active).map((p) => ({ ...p, in_stock: p.stock > 0 })), url.searchParams) };
  } else if (resource === 'store') {
    if (method === 'PATCH') {
      Object.assign(data.store, { name: input.name ?? data.store.name, tax_basis_points: input.taxBasisPoints ?? data.store.tax_basis_points, shipping_cents: input.shippingCents ?? data.store.shipping_cents });
    }
    result = data.store;
  } else if (resource === 'analytics') {
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    const rows = data.orders.filter((o) => (!from || o.created_at.slice(0, 10) >= from) && (!to || o.created_at.slice(0, 10) <= to));
    result = { orders: rows.length, completed: rows.filter((o) => o.status === 'completed').length, cancelled: rows.filter((o) => o.status === 'cancelled').length,
      completed_sales_cents: String(rows.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total_cents, 0)),
      open_order_value_cents: String(rows.filter((o) => ['pending', 'confirmed', 'shipped'].includes(o.status)).reduce((s, o) => s + o.total_cents, 0)),
      active_products: data.products.filter((p) => p.active).length, low_stock_products: data.products.filter((p) => p.active && p.stock <= 5).length, currency: data.store.currency } satisfies Summary;
  } else if (resource === 'subscription') {
    if (method === 'POST') {
      const current = usage(data), target = limits[input.plan as keyof typeof limits];
      if (!target) fail('Unknown plan.');
      if (Object.keys(current).some((key) => current[key as keyof typeof current] > target[key as keyof typeof target])) fail('Current usage exceeds this plan.');
      data.plan = input.plan;
    }
    result = { plan: data.plan, status: 'active', sandbox: true, usage: usage(data), limits: limits[data.plan] } satisfies Subscription;
  } else if (resource === 'products') {
    if (method === 'GET') {
      let rows = data.products;
      const search = url.searchParams.get('search')?.toLowerCase(), active = url.searchParams.get('active'), category = url.searchParams.get('categoryId');
      if (search) rows = rows.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(search));
      if (active !== null) rows = rows.filter((p) => p.active === (active === 'true'));
      if (category) rows = rows.filter((p) => p.category_id === category);
      result = id ? find(data.products, id) : paginate(rows, url.searchParams);
    } else if (action === 'inventory') {
      const product = find(data.products, id);
      if (!input.delta || product.stock + input.delta < 0) fail('Stock adjustment would be invalid.');
      product.stock += input.delta;
      data.movements.unshift({ id: newId, product_id: id, delta: input.delta, reason: input.reason, created_at: now });
      event = 'inventory.adjusted'; result = product;
    } else if (method === 'POST') {
      if (usage(data).products >= limits[data.plan].products) fail('Your product plan limit has been reached.');
      if (data.products.some((p) => p.sku === input.sku)) fail('A product with this SKU already exists.');
      const product: Product = { id: newId, name: input.name, sku: input.sku, description: input.description ?? '',
        category_id: input.categoryId ?? null, stock: input.initialStock ?? 0, price_cents: input.priceCents, active: true, created_at: now };
      data.products.unshift(product); result = product;
      if (product.stock) data.movements.unshift({ id: crypto.randomUUID(), product_id: product.id, delta: product.stock, reason: 'Initial stock', created_at: now });
    } else {
      const product = find(data.products, id);
      if (method === 'DELETE') { product.active = false; result = undefined; }
      else {
        if (input.active && !product.active && usage(data).products >= limits[data.plan].products) fail('Your product plan limit has been reached.');
        if (input.sku && data.products.some((p) => p.id !== id && p.sku === input.sku)) fail('This SKU already exists.');
        Object.assign(product, { name: input.name ?? product.name, sku: input.sku ?? product.sku,
          description: input.description ?? product.description, price_cents: input.priceCents ?? product.price_cents,
          category_id: input.categoryId === undefined ? product.category_id : input.categoryId, active: input.active ?? product.active }); result = product;
      }
    }
  } else if (resource === 'customers') {
    if (method === 'GET') result = id ? find(data.customers, id) : paginate(data.customers, url.searchParams);
    else if (method === 'DELETE') {
      if (data.orders.some((o) => o.customer_id === id)) fail('This customer has orders and cannot be deleted.');
      data.customers = data.customers.filter((c) => c.id !== id);
    } else {
      if (data.customers.some((c) => c.email === input.email && c.id !== id)) fail('A customer with this email already exists.');
      if (id) { result = Object.assign(find(data.customers, id), input); }
      else { const customer = { id: newId, ...input, phone: input.phone ?? '', address: input.address ?? {}, created_at: now } as Customer; data.customers.unshift(customer); result = customer; }
    }
  } else if (resource === 'categories') {
    if (method === 'GET') result = { data: data.categories };
    else if (method === 'DELETE') {
      if (data.products.some((p) => p.category_id === id)) fail('This category is referenced by products.');
      data.categories = data.categories.filter((c) => c.id !== id);
    } else {
      if (data.categories.some((c) => c.name === input.name && c.id !== id)) fail('This category already exists.');
      if (id) result = Object.assign(find(data.categories, id), input);
      else { const category = { id: newId, name: input.name }; data.categories.push(category); result = category; }
    }
  } else if (resource === 'orders') {
    if (method === 'GET') {
      let rows = data.orders;
      if (url.searchParams.has('status')) rows = rows.filter((o) => o.status === url.searchParams.get('status'));
      if (url.searchParams.has('customerId')) rows = rows.filter((o) => o.customer_id === url.searchParams.get('customerId'));
      result = id ? find(data.orders, id) : paginate(rows, url.searchParams);
    } else if (method === 'POST') {
      const key = headers?.['Idempotency-Key'], hash = JSON.stringify(input);
      const existing = data.orders.find((o) => o.idempotency_key === key);
      if (existing) { if (existing.request_hash !== hash) fail('This idempotency key belongs to a different order.'); return existing as T; }
      if (usage(data).ordersPerMonth >= limits[data.plan].ordersPerMonth) fail('Your monthly order limit has been reached.');
      const customer = find(data.customers, input.customerId);
      const selected = input.items as { productId: string; quantity: number }[];
      if (!selected.length || new Set(selected.map((i) => i.productId)).size !== selected.length) fail('Select unique products for this order.');
      const items = selected.map((i) => {
        const p = find(data.products, i.productId);
        if (!p.active || i.quantity < 1 || i.quantity > 1000 || p.stock < i.quantity) fail(`Not enough stock for ${p.name}.`);
        return { id: crypto.randomUUID(), product_id: p.id, name: p.name, sku: p.sku, quantity: i.quantity, unit_price_cents: p.price_cents };
      });
      let coupon: Coupon | undefined;
      if (input.couponCode) {
        coupon = data.coupons.find((c) => c.code === input.couponCode.toUpperCase() && c.active && new Date(c.expires_at).getTime() > Date.now() && c.used < c.max_uses);
        if (!coupon) fail('Coupon is invalid, expired, or exhausted.');
      }
      const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price_cents, 0);
      const discount = coupon ? Math.floor(subtotal * coupon.percent / 100) : 0;
      const tax = Math.round((subtotal - discount) * data.store.tax_basis_points / 10000);
      const order: Order = { id: newId, customer_id: customer.id, status: 'pending', currency: data.store.currency,
        created_at: now, items, subtotal_cents: subtotal, discount_cents: discount, tax_cents: tax,
        shipping_cents: data.store.shipping_cents, total_cents: subtotal - discount + tax + data.store.shipping_cents,
        shipping_address: input.shippingAddress ?? customer.address, coupon_id: coupon?.id, idempotency_key: key, request_hash: hash };
      items.forEach((i) => { find(data.products, i.product_id).stock -= i.quantity; data.movements.unshift({ id: crypto.randomUUID(), product_id: i.product_id, delta: -i.quantity, reason: 'Order placed', order_id: newId, created_at: now }); });
      if (coupon) coupon.used += 1;
      data.orders.unshift(order); result = order;
    } else {
      const order = find(data.orders, id);
      if (order.status !== input.status) {
        if (!transitions[order.status].includes(input.status)) fail(`Cannot change ${order.status} to ${input.status}.`);
        if (input.status === 'cancelled') {
          order.items?.forEach((i) => { find(data.products, i.product_id).stock += i.quantity; data.movements.unshift({ id: crypto.randomUUID(), product_id: i.product_id, delta: i.quantity, reason: 'Order cancelled', order_id: id, created_at: now }); });
          if (order.coupon_id) find(data.coupons, order.coupon_id).used -= 1;
        }
        order.status = input.status;
      }
      event = 'order.status_changed'; result = order;
    }
  } else if (resource === 'coupons') {
    if (method === 'GET') result = paginate(data.coupons, url.searchParams);
    else if (method === 'DELETE') find(data.coupons, id).active = false;
    else {
      if (data.coupons.some((c) => c.code === input.code.toUpperCase())) fail('This coupon code already exists.');
      if (new Date(input.expiresAt).getTime() <= Date.now()) fail('Expiry must be in the future.');
      const coupon = { id: newId, code: input.code.toUpperCase(), percent: input.percent, max_uses: input.maxUses, used: 0, active: true, expires_at: input.expiresAt };
      data.coupons.unshift(coupon); result = coupon;
    }
  } else if (resource === 'members') {
    if (method === 'GET') result = { data: data.members };
    else if (method === 'POST') {
      if (usage(data).members >= limits[data.plan].members) fail('Your team plan limit has been reached.');
      if (data.members.some((m) => m.email === input.email)) fail('This person is already a member.');
      const member = { id: newId, email: input.email, name: input.email.split('@')[0], role: input.role, created_at: now } as Member;
      data.members.push(member); result = member;
    } else {
      const member = find(data.members, id);
      if (member.role === 'owner' && data.members.filter((m) => m.role === 'owner').length === 1 && (method === 'DELETE' || input.role !== 'owner')) fail('The store must retain an owner.');
      if (method === 'DELETE') data.members = data.members.filter((m) => m.id !== id);
      else { member.role = input.role; result = member; }
    }
  } else if (resource === 'inventory') {
    result = paginate(data.movements.filter((m) => !url.searchParams.has('productId') || m.product_id === url.searchParams.get('productId')), url.searchParams);
  } else if (resource === 'audit-logs') { result = paginate(data.audit, url.searchParams); }
  else fail('This demo endpoint is unavailable.');
  if (method !== 'GET') {
    data.audit.unshift({ id: crypto.randomUUID(), actor_id: 'demo-owner', action: event, entity_id: id ?? newId, details: input, created_at: now });
    save(data);
  }
  return result as T;
}

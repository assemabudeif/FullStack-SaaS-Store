import type { Database } from './database.js';

// Add new numbered migrations; never edit a migration after deployment.
const migrations = [{
  version: 1,
  sql: `
CREATE TABLE users (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
  password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenants (
  id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE,
  currency text NOT NULL DEFAULT 'USD', tax_basis_points integer NOT NULL DEFAULT 0 CHECK (tax_basis_points BETWEEN 0 AND 10000),
  shipping_cents integer NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','admin','staff','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id,user_id)
);
CREATE TABLE subscriptions (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','business')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), refresh_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE categories (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE products (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), category_id uuid,
  name text NOT NULL, description text NOT NULL DEFAULT '', sku text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 0 AND 100000000),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,sku),
  FOREIGN KEY (tenant_id,category_id) REFERENCES categories(tenant_id,id)
);
CREATE INDEX products_tenant_created_idx ON products(tenant_id,created_at DESC,id);
CREATE TABLE customers (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
  email text NOT NULL, phone text NOT NULL DEFAULT '', address jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,email)
);
CREATE TABLE coupons (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), code text NOT NULL,
  percent integer NOT NULL CHECK (percent BETWEEN 1 AND 100),
  max_uses integer NOT NULL CHECK (max_uses > 0), used integer NOT NULL DEFAULT 0 CHECK(used >= 0),
  expires_at timestamptz NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code)
);
CREATE TABLE orders (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','shipped','completed','cancelled')),
  currency text NOT NULL, subtotal_cents integer NOT NULL CHECK(subtotal_cents >= 0),
  discount_cents integer NOT NULL CHECK(discount_cents >= 0), tax_cents integer NOT NULL CHECK(tax_cents >= 0),
  shipping_cents integer NOT NULL CHECK(shipping_cents >= 0), total_cents integer NOT NULL CHECK(total_cents >= 0),
  coupon_id uuid, shipping_address jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL, request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY (tenant_id,coupon_id) REFERENCES coupons(tenant_id,id)
);
CREATE INDEX orders_tenant_created_idx ON orders(tenant_id,created_at DESC,id);
CREATE TABLE order_items (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, product_id uuid NOT NULL,
  name text NOT NULL, sku text NOT NULL, quantity integer NOT NULL CHECK(quantity > 0),
  unit_price_cents integer NOT NULL CHECK(unit_price_cents >= 0),
  FOREIGN KEY (tenant_id,order_id) REFERENCES orders(tenant_id,id),
  FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE INDEX order_items_order_idx ON order_items(tenant_id,order_id);
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, product_id uuid NOT NULL,
  delta integer NOT NULL, reason text NOT NULL, order_id uuid, actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id),
  FOREIGN KEY (tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
CREATE INDEX inventory_tenant_idx ON inventory_movements(tenant_id,created_at DESC);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL, entity_id uuid, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_idx ON audit_logs(tenant_id,created_at DESC);
`,
}, {
  version: 2,
  sql: `
ALTER TABLE orders ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE inventory_movements ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cod', 'paymob'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paymob_api_key text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paymob_integration_id integer;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paymob_iframe_id integer;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paymob_hmac text;
`,
}];

export async function migrate(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // Prevent concurrent production migrators from racing.
    await tx.query('SELECT pg_advisory_xact_lock(924681)');
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = await tx.query<{ version: number }>('SELECT version FROM schema_migrations');
    for (const migration of migrations) {
      if (applied.some((row) => row.version === migration.version)) continue;
      // These migrations contain plain DDL only (no function bodies/quoted
      // semicolons). PGlite's prepared query API accepts one statement at a time.
      for (const statement of migration.sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        await tx.query(statement);
      }
      await tx.query('INSERT INTO schema_migrations(version) VALUES($1)', [migration.version]);
    }
  });
}

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
`
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
`
}, {
  version: 3,
  sql: `
CREATE TABLE product_options (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL, position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE product_option_values (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  option_id uuid NOT NULL REFERENCES product_options(id) ON DELETE CASCADE,
  value text NOT NULL, position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,option_id,value)
);
CREATE TABLE product_variants (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL, price_cents_integer_adjustment integer NOT NULL DEFAULT 0,
  stock_adjustment integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,sku),
  FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE product_variant_options (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES product_options(id),
  option_value_id uuid NOT NULL REFERENCES product_option_values(id),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,variant_id,option_id),
  FOREIGN KEY (tenant_id,variant_id) REFERENCES product_variants(tenant_id,id)
);
-- Indexes for better query performance
CREATE INDEX product_options_tenant_idx ON product_options(tenant_id);
CREATE INDEX product_option_values_tenant_idx ON product_option_values(tenant_id);
CREATE INDEX product_variants_tenant_idx ON product_variants(tenant_id);
CREATE INDEX product_variant_options_tenant_idx ON product_variant_options(tenant_id);
`
}, {
  version: 4,
  sql: `
CREATE TABLE wishlists (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  name text NOT NULL DEFAULT 'مفضلاتي',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,customer_id,is_default),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE UNIQUE INDEX wishlists_customer_default_idx ON wishlists(tenant_id, customer_id) WHERE is_default=true;
CREATE TABLE wishlist_items (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  wishlist_id uuid NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  variant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,wishlist_id,product_id,variant_id),
  FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id),
  FOREIGN KEY (tenant_id,variant_id) REFERENCES product_variants(tenant_id,id)
);
-- Indexes for better query performance
CREATE INDEX wishlists_tenant_idx ON wishlists(tenant_id);
CREATE INDEX wishlists_customer_idx ON wishlists(tenant_id,customer_id);
CREATE INDEX wishlist_items_tenant_idx ON wishlist_items(tenant_id);
CREATE INDEX wishlist_items_wishlist_idx ON wishlist_items(tenant_id,wishlist_id);
CREATE INDEX wishlist_items_product_idx ON wishlist_items(tenant_id,product_id);
`
}, {
  version: 5,
  sql: `
CREATE TABLE product_reviews (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text NOT NULL,
  comment text,
  is_verified_purchase boolean NOT NULL DEFAULT false,
  helpful_votes integer NOT NULL DEFAULT 0,
  total_votes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,product_id,customer_id) -- منع التقييم المتكرر لنفس المنتج من نفس العميل
);

CREATE TABLE review_votes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  review_id uuid NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  vote_type text NOT NULL CHECK (vote_type IN ('helpful', 'not_helpful')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,review_id,customer_id,vote_type)
);
`
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
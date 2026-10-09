# Advanced Store — SaaS Backend

A runnable, API-only Node.js application for managing multiple stores. Built with **TypeScript, Fastify, PostgreSQL, and SQL migrations**. Local development uses persistent embedded PostgreSQL (PGlite); production uses PostgreSQL through `pg`.

## Included

- Account registration creates a store and owner membership atomically.
- Short-lived JWT access tokens, hashed single-use refresh tokens, rotation and immediate logout revocation. Passwords use salted scrypt.
- Tenant selection through `X-Tenant-ID`, checked against current membership on every private request. Tenant-scoped queries and composite foreign keys prevent cross-store references.
- Owner/admin/staff/viewer permissions; team management; last-owner protection.
- Product/category CRUD with image URLs, archival, customer records and addresses, stock adjustments and an inventory movement ledger.
- Transactional orders: server-side price snapshots, stock reservation, coupons, tax, shipping, idempotent creation and fulfillment transitions.
- **Customer Storefront & Checkout**: Category filtering, search, cart drawer, coupons, customer info, delivery address, order creation without staff authentication.
- **Payment Gateways**:
  - **Cash on Delivery (COD)**: zero-setup local collection with staff "Mark as Paid" fulfillment.
  - **Paymob Gateway**: Full token auth, order registration, payment key request, iframe integration, HMAC SHA-512 webhook verification, plus an interactive built-in simulation fallback for offline local testing.
- **Modern & Creative Web UI**: High-end React 19 + Vite dashboard & customer storefront featuring dark/light modes, glassmorphism, responsive navigation, payment cards, and order tracking steppers.
- Cancellation restores stock and coupon availability exactly once.
- Free/pro/business plan limits; usage reports; **opt-in development-only sandbox plan changes**.
- Completed-sales summary, low-stock statistics, audit logs and a safe public catalog.
- OpenAPI/Swagger UI, schema validation, CORS allowlist, security headers, rate limiting, structured error envelopes, health/readiness checks and graceful shutdown.
- Integration tests for real SQL behavior, including concurrency, isolation and authorization. Docker Compose and CI included.

## Quick start (Node.js 24+)

```sh
npm install
npm run setup        # creates .env with random secrets; never overwrites it
npm run dev          # starts Fastify backend on http://127.0.0.1:3000
```

To run the React Store & Dashboard Frontend:

```sh
npm run frontend:dev # starts Vite dev server on http://localhost:5173
```

- Backend API: `http://127.0.0.1:3000`
- Interactive documentation: `http://127.0.0.1:3000/docs`
- Customer Storefront: `http://localhost:5173/store/<storeSlug>`
- Admin Dashboard: `http://localhost:5173/dashboard`

No database installation is needed for this mode. Data persists in `data/postgres`. Run only **one process** against that directory. Do not run seed/migrate alongside the local server; stop it first. Transactions and standalone queries are serialized in embedded mode.

Optional sample catalog:

```sh
# With the dev server stopped, on a fresh database:
npm run db:seed
npm run dev
```

Seed prints a generated demo password and tenant UUID, and seeds realistic high-resolution product imagery and categories.

### Docker / PostgreSQL

```sh
npm run setup
docker compose up --build
```

This runs the production-mode API and PostgreSQL 17 with a persistent volume. Sandbox billing is disabled. The DB is exposed only on loopback port `5433`; the API on loopback port `3000`.

To use a separately managed database:

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/store
```

Use your provider's TLS configuration and a least-privileged application role. Production rejects embedded DB mode, missing/placeholder JWT secrets and sandbox billing. Migrations run on startup under a database advisory lock; `npm run db:migrate` is also available. Separate migration/application credentials before deploying with a restricted database role.

## API reference

All routes below are under `/api/v1`. Consult `/docs` for request schemas. Request fields are camelCase; SQL-backed response fields are snake_case.

| Area | Routes | Access |
|---|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh` | Public, stricter rate limit |
| Account | `GET /auth/me`, `POST /auth/logout` | Bearer token |
| Store | `GET /store`, `PATCH /store` | Member / admin+ (supports Paymob credentials) |
| Team | `GET /members`, `POST /members`, `PATCH /members/:id`, `DELETE /members/:id` | Admin+ reads; owner writes |
| Categories | `GET /categories`, `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` | Member reads; admin+ writes |
| Products | `GET /products`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id` | Member reads; staff+ writes; admin+ archives (supports `imageUrl`) |
| Stock | `POST /products/:id/inventory`, `GET /inventory/movements` | Staff+ writes; member reads |
| Customers | `GET /customers`, `GET /customers/:id`, `POST /customers`, `PATCH /customers/:id`, `DELETE /customers/:id` | Member reads; staff+ writes; admin+ deletes |
| Orders | `GET /orders`, `GET /orders/:id`, `POST /orders`, `PATCH /orders/:id/status`, `PATCH /orders/:id/payment` | Member reads; staff+ writes |
| Coupons | `GET /coupons`, `POST /coupons`, `DELETE /coupons/:id` | Admin+ |
| Subscription | `GET /subscription`, `POST /subscription/sandbox-plan` | Admin+ reads; owner sandbox writes |
| Analytics | `GET /analytics/summary` | Admin+ |
| Audit | `GET /audit-logs` | Admin+ |
| Public Storefront | `GET /storefront/:slug/categories`, `GET /storefront/:slug/products`, `POST /storefront/:slug/checkout`, `GET /storefront/:slug/orders/:id` | Public (Customers) |
| Payments | `POST /payments/paymob/webhook`, `POST /payments/paymob/mock-pay` | Public / Gateway Webhooks |

Private store routes require **both** `Authorization: Bearer ...` and `X-Tenant-ID: <uuid>`. No membership yields 404 instead of exposing private store existence. Add team members by the email of an already registered account. Membership grants access; this implementation does not send invitations.

Lists support `page=1&limit=20` (maximum limit 100). Products also accept `search`, `categoryId`, and `active`; orders accept `status` and `customerId`; inventory movements accept `productId`. Analytics supports inclusive `from`/`to` dates in UTC.

### Roles

`viewer` reads catalog/customers/orders/inventory. `staff` also manages products, customers, stock and orders. `admin` also manages categories, coupons, store settings and archives, and reads team, subscriptions, analytics and audit. `owner` has all permissions plus team management and sandbox plan selection.

### Pricing and order rules

- Amounts are integer minor units; supported store currencies are USD, EUR, GBP and EGP, all using two decimal places.
- Currency is selected at registration and is immutable through this API.
- Tax is configured in basis points: `1000` = 10%. Shipping is a flat configured amount per order.
- Percentage coupon discount rounds down; tax on the discounted subtotal rounds to nearest cent. Shipping is added after tax.
- `total = subtotal - discount + tax + shipping`. The server rejects client-supplied totals.
- Maximum subtotal and total: 2,000,000,000 cents. Per-product price limit: 100,000,000 cents.
- Placing an order reserves stock immediately; cancellation releases it. There is no automatic reservation timeout.
- `pending → confirmed → shipped → completed`; cancellation is permitted only from pending/confirmed. Same-status requests are harmless retries.
- Order creation requires an idempotency key (8–128 allowed ASCII characters). A matching retry returns the existing order with status 200 and `Idempotency-Replayed: true`; a different payload with the same key returns 409. Original creation returns 201.
- Products are archived, not deleted. Referenced customers/categories cannot be deleted. Price/name/SKU snapshots preserve order history.
- Store writes are serialized by a per-store row lock in PostgreSQL. Membership/role is rechecked inside that lock, preventing queued writes from using revoked permissions. Different stores can write concurrently with PostgreSQL.
- Large analytics totals are decimal strings, avoiding unsafe JavaScript integer conversions.

### Plan limits

| Plan | Active products | Team members | Orders / UTC calendar month |
|---|---:|---:|---:|
| free | 50 | 3 | 100 |
| pro | 1,000 | 15 | 5,000 |
| business | 10,000 | 100 | 50,000 |

Archived products do not count. Owners count as members. Cancelled orders still count toward monthly order usage. Idempotent retries do not consume another order. Reactivation enforces the product quota. Downgrades are rejected if current usage exceeds the target plan. Suspended subscriptions are read-only.

To try plans locally, set `ENABLE_SANDBOX_BILLING=true`, then POST `{"plan":"pro"}` to `/subscription/sandbox-plan` as owner. **This does not charge money or create a real subscription.**

### Sessions and errors

Access tokens expire in 15 minutes; refresh sessions in 30 days. Refresh rotates to a new session and invalidates the previous access token immediately. Clients should serialize refresh attempts, replace both tokens and retry failed requests only after successful refresh. Logout revokes the current session.

Store tokens securely. This API returns tokens in JSON, not browser cookies. If using cookies in a frontend, implement HttpOnly/Secure cookies and CSRF protection at that boundary.

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock for KB-001.",
    "requestId": "req-123"
  }
}
```

Common statuses: 400 validation/business input, 401 authentication, 403 permissions/plan limits, 404 inaccessible or missing resource, 409 conflict, 429 rate limit. `X-Request-ID` correlates requests and logs. Unexpected database details are not returned.

## Development and verification

```sh
npm run typecheck  # application + tests + scripts
npm test           # SQL-backed integration suite in memory
npm run build
npm start          # compiled server; requires .env
npm run check      # all three
npm run docs:export # regenerate docs/openapi.json without touching application data
npm audit --omit=dev
```

For real PostgreSQL tests, use an **empty dedicated test database**, never a production or developer data database:

```sh
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/store_test npm test
```

The suite inserts persistent fixtures in external PostgreSQL. Recreate the dedicated DB before another run. CI tests embedded PostgreSQL and a fresh PostgreSQL 17 service.

```text
src/
  app.ts              plugin wiring, security, OpenAPI, error handling
  server.ts           startup and shutdown
  config.ts           environment validation
  db/                 connection adapters and versioned migrations
  lib/                auth/tenant/RBAC context, validation, security helpers
  modules/            auth, stores, catalog, customers, orders, analytics
scripts/              environment setup, migration, development seed
tests/                integration tests
```

## Before a real production launch

This is a working backend foundation, not a claim of a fully operated commerce service. The following are intentionally **not** simulated as production functionality:

- Payment collection, refunds, paid SaaS billing and verified payment-provider webhooks.
- Password reset/email verification, invitation delivery, MFA and customer-facing authentication.
- Product variants, images/file uploads, shopping carts, return processing, carrier shipping quotes and jurisdiction-specific tax compliance.
- Background jobs, webhook retries/outbox, observability dashboards, backups and disaster recovery.

Integrate those services as required. Completed-order sales are **not verified payment receipts**. The public API currently exposes catalog browsing only; checkout/order creation is for authenticated store staff.

Additional deployment work: enforce TLS at the proxy, establish secret rotation and database backups, apply retention/privacy policies to customer and audit data, restrict docs if needed, use shared rate-limit storage for multiple API instances, and configure trusted proxy addresses explicitly (do not blindly trust forwarded IPs). Current rate limits are in-process (120 requests/minute/IP globally, 10/minute/IP for sensitive auth routes). Use a production migration role, a restricted runtime role and external monitoring.

Do not change deployed migration 1; add numbered migrations. The current migration splitter handles plain DDL only; use explicit statement arrays if future migrations include stored functions or quoted semicolons.

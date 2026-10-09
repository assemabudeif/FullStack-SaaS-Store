export type Role = 'owner' | 'admin' | 'staff' | 'viewer';
export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'completed' | 'cancelled';
export type PaymentMethod = 'cod' | 'paymob';
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';

export interface Store {
  id: string;
  name: string;
  slug: string;
  currency: string;
  role: Role;
  tax_basis_points: number;
  shipping_cents: number;
  created_at: string;
  paymob_api_key?: string;
  paymob_integration_id?: number;
  paymob_iframe_id?: number;
  paymob_hmac?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Session {
  mode: 'demo' | 'live';
  user: User;
  stores: Store[];
  tenantId: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string;
  price_cents: number;
  stock: number;
  active: boolean;
  category_id: string | null;
  created_at: string;
  image?: string;
  image_url?: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: Address;
  created_at: string;
}

export interface OrderItem {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  quantity: number;
  unit_price_cents: number;
}

export interface Order {
  id: string;
  customer_id: string;
  status: OrderStatus;
  currency: string;
  created_at: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  shipping_cents: number;
  total_cents: number;
  items?: OrderItem[];
  shipping_address: Address;
  coupon_id?: string;
  idempotency_key?: string;
  request_hash?: string;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  payment_reference?: string;
  customer_email?: string;
  customer_phone?: string;
}

export interface Coupon {
  id: string;
  code: string;
  percent: number;
  max_uses: number;
  used: number;
  active: boolean;
  expires_at: string;
}

export interface Member extends User {
  role: Role;
  created_at: string;
}

export interface Movement {
  id: string;
  product_id: string;
  delta: number;
  reason: string;
  created_at: string;
  order_id?: string;
}

export interface Audit {
  id: string;
  actor_id: string;
  action: string;
  entity_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Subscription {
  plan: 'free' | 'pro' | 'business';
  status: 'active' | 'suspended';
  sandbox: boolean;
  usage: { products: number; members: number; ordersPerMonth: number };
  limits: { products: number; members: number; ordersPerMonth: number };
}

export interface Summary {
  orders: number;
  completed: number;
  cancelled: number;
  completed_sales_cents: string;
  open_order_value_cents: string;
  active_products: number;
  low_stock_products: number;
  currency: string;
}

export interface List<T> {
  data: T[];
  total?: number;
  page?: number;
  limit?: number;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

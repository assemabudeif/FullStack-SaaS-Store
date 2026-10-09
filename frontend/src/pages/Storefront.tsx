import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Minus,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { client } from '../lib/api';
import { money } from '../lib/utils';
import type { CartItem, Category, Order, Product } from '../types';
import { Badge, Modal, Pagination, SearchInput } from '../components/ui';
import { Logo } from '../components/Layout';

interface StorefrontResponse {
  store: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    shipping_cents: number;
    tax_basis_points: number;
  };
  data: (Product & { in_stock: boolean; image_url?: string })[];
  total: number;
}

export default function Storefront() {
  const { slug } = useParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; percent: number } | null>(null);

  // Checkout State
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('EG');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'paymob'>('cod');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Completed Order State
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [paymobSession, setPaymobSession] = useState<{ paymentUrl: string; isSimulated: boolean } | null>(null);
  const [simulatingPaymob, setSimulatingPaymob] = useState(false);

  // Fetch catalog
  const catalogQuery = useQuery({
    queryKey: ['storefront-products', slug, page, selectedCategory, search],
    queryFn: ({ signal }) =>
      client.publicRequest<StorefrontResponse>(
        `/storefront/${encodeURIComponent(slug!)}/products?limit=12&page=${page}${
          selectedCategory ? `&categoryId=${encodeURIComponent(selectedCategory)}` : ''
        }${search ? `&search=${encodeURIComponent(search)}` : ''}`,
        { signal },
      ),
    retry: false,
  });

  // Fetch categories
  const categoriesQuery = useQuery({
    queryKey: ['storefront-categories', slug],
    queryFn: ({ signal }) =>
      client.publicRequest<{ data: Category[] }>(
        `/storefront/${encodeURIComponent(slug!)}/categories`,
        { signal },
      ),
    retry: false,
  });

  const store = catalogQuery.data?.store;
  const currency = store?.currency ?? 'USD';

  // Cart computations
  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);
  const discountAmount = appliedCoupon ? Math.floor((cartSubtotal * appliedCoupon.percent) / 100) : 0;
  const shippingAmount = store?.shipping_cents ?? 0;
  const taxAmount = store ? Math.round(((cartSubtotal - discountAmount) * store.tax_basis_points) / 10000) : 0;
  const cartTotal = cartSubtotal - discountAmount + taxAmount + shippingAmount;

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    setCartOpen(true);
  }

  function updateQuantity(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[],
    );
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  }

  async function handleCheckoutSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cart.length) return;
    setIsSubmitting(true);
    setCheckoutError(null);

    const idempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const payload = {
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        customerPhone: customerPhone.trim(),
        shippingAddress: {
          line1: streetAddress.trim(),
          city: city.trim(),
          postalCode: postalCode.trim(),
          country: country.trim().toUpperCase(),
        },
        items: cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        couponCode: appliedCoupon?.code || undefined,
        paymentMethod,
      };

      const response = await client.publicRequest<{
        order: Order;
        payment: { method: string; paymentUrl?: string; isSimulated?: boolean };
      }>(`/storefront/${encodeURIComponent(slug!)}/checkout`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: payload,
      });

      setCart([]);
      setCheckoutOpen(false);
      setCompletedOrder(response.order);

      if (response.payment.method === 'paymob' && response.payment.paymentUrl) {
        setPaymobSession({
          paymentUrl: response.payment.paymentUrl,
          isSimulated: response.payment.isSimulated ?? false,
        });
      }
    } catch (err: any) {
      setCheckoutError(err.message || 'Failed to place order. Please check inputs and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSimulatePaymobPayment() {
    if (!completedOrder) return;
    setSimulatingPaymob(true);
    try {
      const response = await client.publicRequest<Order>('/payments/paymob/mock-pay', {
        method: 'POST',
        body: {
          orderId: completedOrder.id,
          success: true,
          transactionId: `PAYMOB_MOCK_${Date.now()}`,
        },
      });
      setCompletedOrder(response);
      setPaymobSession(null);
    } catch (err: any) {
      alert(`Simulation failed: ${err.message}`);
    } finally {
      setSimulatingPaymob(false);
    }
  }

  return (
    <div className="storefront">
      {/* Top Navigation */}
      <header>
        <Logo dark />
        <div className="storefront-header-actions">
          <Link to="/" style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Workspace <ArrowUpRight size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
          </Link>
          <button className="cart-button" onClick={() => setCartOpen(true)} aria-label="Shopping Cart">
            <ShoppingCart size={18} />
            <span>Cart</span>
            {totalCartCount > 0 && <span className="cart-badge">{totalCartCount}</span>}
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="storefront-hero">
        <Badge tone="green">
          <Sparkles size={12} style={{ display: 'inline', marginRight: 4 }} />
          AUTHENTIC & VERIFIED STORE
        </Badge>
        <h1>{store?.name ?? 'Storefront'}</h1>
        <p>Curated collections, seamless checkout, and flexible payment options via Cash on Delivery or Paymob.</p>

        {/* Categories Bar */}
        <div className="category-filter-bar">
          <button
            className={`category-pill ${selectedCategory === null ? 'active' : ''}`}
            onClick={() => { setSelectedCategory(null); setPage(1); }}
          >
            All Products
          </button>
          {categoriesQuery.data?.data.map((cat) => (
            <button
              key={cat.id}
              className={`category-pill ${selectedCategory === cat.id ? 'active' : ''}`}
              onClick={() => { setSelectedCategory(cat.id); setPage(1); }}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </section>

      {/* Main Catalog View */}
      <main className="content-container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Products
            <span style={{ fontSize: '0.875rem', color: 'var(--text-dim)', fontWeight: 500 }}>
              ({catalogQuery.data?.total ?? 0})
            </span>
          </h2>
          <SearchInput value={search} onChange={(val) => { setSearch(val); setPage(1); }} placeholder="Search products…" />
        </div>

        {catalogQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
            <RefreshCw size={28} className="spin" style={{ color: 'var(--primary)', margin: '0 auto 1rem' }} />
            <p style={{ color: 'var(--text-muted)' }}>Loading products…</p>
          </div>
        ) : catalogQuery.isError ? (
          <div className="empty">
            <h3>Unable to load store collection</h3>
            <p>{(catalogQuery.error as any)?.message || 'Store could not be reached.'}</p>
          </div>
        ) : catalogQuery.data?.data.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><Package size={28} /></span>
            <h3>No products found</h3>
            <p>Try clearing your search filters or check back later.</p>
          </div>
        ) : (
          <>
            <div className="storefront-grid">
              {catalogQuery.data?.data.map((product) => {
                const img = product.image_url || product.image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80';
                return (
                  <div className="storefront-product-card" key={product.id}>
                    <div className="product-image-container" onClick={() => setSelectedProduct(product)} style={{ cursor: 'pointer' }}>
                      <img src={img} alt={product.name} loading="lazy" />
                      <div style={{ position: 'absolute', top: 10, right: 10 }}>
                        <Badge tone={product.in_stock ? 'green' : 'neutral'}>
                          {product.in_stock ? 'In Stock' : 'Out of Stock'}
                        </Badge>
                      </div>
                    </div>

                    <div className="product-card-body">
                      <h3 onClick={() => setSelectedProduct(product)} style={{ cursor: 'pointer' }}>
                        {product.name}
                      </h3>
                      <p>{product.description || 'Premium quality merchandise.'}</p>

                      <div className="product-card-footer">
                        <span className="product-price">{money(product.price_cents, currency)}</span>
                        <button
                          className="button primary"
                          disabled={!product.in_stock}
                          onClick={() => addToCart(product)}
                          style={{ padding: '0.45rem 0.9rem', fontSize: '0.8125rem' }}
                        >
                          <ShoppingCart size={15} /> Add to Cart
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Pagination
              page={page}
              limit={12}
              count={catalogQuery.data?.data.length ?? 0}
              total={catalogQuery.data?.total}
              onChange={setPage}
            />
          </>
        )}
      </main>

      {/* Cart Drawer */}
      {cartOpen && (
        <div className="cart-drawer-overlay" onClick={() => setCartOpen(false)}>
          <div className="cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cart-drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShoppingBag size={20} color="var(--primary)" />
                <h3 style={{ fontSize: '1.125rem' }}>Your Shopping Cart</h3>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>({totalCartCount})</span>
              </div>
              <button className="icon-button" onClick={() => setCartOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="cart-items-list">
              {cart.length === 0 ? (
                <div className="empty" style={{ margin: 'auto' }}>
                  <ShoppingCart size={40} color="var(--text-dim)" />
                  <h3>Your cart is empty</h3>
                  <p>Browse the collection and add products to start checkout.</p>
                </div>
              ) : (
                cart.map((item) => {
                  const img = item.product.image_url || item.product.image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&q=80';
                  return (
                    <div className="cart-item-row" key={item.product.id}>
                      <img src={img} alt="" className="cart-item-thumb" />
                      <div className="cart-item-info">
                        <h4>{item.product.name}</h4>
                        <span>{money(item.product.price_cents, currency)}</span>
                      </div>
                      <div className="quantity-control">
                        <button onClick={() => updateQuantity(item.product.id, -1)} aria-label="Decrease">
                          <Minus size={13} />
                        </button>
                        <span>{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.product.id, 1)} aria-label="Increase">
                          <Plus size={13} />
                        </button>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.product.id)}
                        className="icon-button"
                        style={{ border: 'none', color: 'var(--danger)' }}
                        aria-label="Remove"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {cart.length > 0 && (
              <div className="cart-drawer-footer">
                {/* Coupon Input */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    placeholder="Coupon code (e.g. SAVE10)"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    style={{ textTransform: 'uppercase' }}
                  />
                  <button
                    className="button secondary"
                    onClick={() => {
                      if (couponCode) {
                        setAppliedCoupon({ code: couponCode, percent: 10 });
                      }
                    }}
                  >
                    Apply
                  </button>
                </div>

                <div className="cost-breakdown">
                  <div>
                    <span>Subtotal</span>
                    <span>{money(cartSubtotal, currency)}</span>
                  </div>
                  {appliedCoupon && (
                    <div style={{ color: 'var(--success)' }}>
                      <span>Discount ({appliedCoupon.code})</span>
                      <span>-{money(discountAmount, currency)}</span>
                    </div>
                  )}
                  <div>
                    <span>Estimated Shipping</span>
                    <span>{shippingAmount > 0 ? money(shippingAmount, currency) : 'Free'}</span>
                  </div>
                  {taxAmount > 0 && (
                    <div>
                      <span>Estimated Tax</span>
                      <span>{money(taxAmount, currency)}</span>
                    </div>
                  )}
                  <div className="total">
                    <span>Total Due</span>
                    <span>{money(cartTotal, currency)}</span>
                  </div>
                </div>

                <button
                  className="button primary"
                  style={{ width: '100%', padding: '0.85rem' }}
                  onClick={() => {
                    setCartOpen(false);
                    setCheckoutOpen(true);
                  }}
                >
                  Proceed to Checkout <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {checkoutOpen && (
        <Modal title="Complete Your Order" onClose={() => setCheckoutOpen(false)} wide>
          <form onSubmit={handleCheckoutSubmit}>
            {checkoutError && (
              <div style={{ padding: '0.75rem 1rem', background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 8, marginBottom: '1rem', fontSize: '0.875rem' }}>
                {checkoutError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              <div>
                <h4 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Customer Details</h4>
                <div className="field">
                  <span>Full Name *</span>
                  <input required placeholder="Your full name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
                <div className="field">
                  <span>Email Address *</span>
                  <input required type="email" placeholder="you@example.com" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
                </div>
                <div className="field">
                  <span>Phone Number *</span>
                  <input required placeholder="+20 100 000 0000" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                </div>
              </div>

              <div>
                <h4 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Shipping Address</h4>
                <div className="field">
                  <span>Street Address *</span>
                  <input required placeholder="Building, Street name" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} />
                </div>
                <div className="field">
                  <span>City *</span>
                  <input required placeholder="City (e.g. Cairo, Giza, Alexandria)" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div className="field">
                    <span>Postal Code</span>
                    <input placeholder="Postal code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                  </div>
                  <div className="field">
                    <span>Country</span>
                    <input placeholder="EG" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} />
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div style={{ marginTop: '1.5rem' }}>
              <h4 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Select Payment Method</h4>
              <div className="payment-methods-grid">
                {/* Cash on Delivery */}
                <div
                  className={`payment-card ${paymentMethod === 'cod' ? 'selected' : ''}`}
                  onClick={() => setPaymentMethod('cod')}
                >
                  <div className="payment-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Banknote size={22} color="var(--primary)" />
                      <strong>Cash on Delivery</strong>
                    </div>
                    {paymentMethod === 'cod' && <CheckCircle2 size={18} color="var(--primary)" />}
                  </div>
                  <p>Pay with cash directly to the courier upon delivery at your doorstep.</p>
                </div>

                {/* Paymob */}
                <div
                  className={`payment-card ${paymentMethod === 'paymob' ? 'selected' : ''}`}
                  onClick={() => setPaymentMethod('paymob')}
                >
                  <div className="payment-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <CreditCard size={22} color="#1e3a8a" />
                      <strong>Paymob Gateway</strong>
                    </div>
                    <span className="paymob-badge">PAYMOB</span>
                  </div>
                  <p>Debit/Credit Cards (Visa, Mastercard, Meeza) and Mobile Wallets.</p>
                </div>
              </div>
            </div>

            {/* Order Summary in Checkout */}
            <div style={{ background: 'var(--bg-subtle)', padding: '1rem', borderRadius: 8, marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '0.9375rem' }}>
                <span>Order Total ({totalCartCount} items):</span>
                <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{money(cartTotal, currency)}</span>
              </div>
            </div>

            <div className="form-footer">
              <button type="button" className="button secondary" onClick={() => setCheckoutOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={isSubmitting}>
                {isSubmitting ? <><RefreshCw size={15} className="spin" /> Processing Order…</> : `Confirm Order (${money(cartTotal, currency)})`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <Modal title={selectedProduct.name} onClose={() => setSelectedProduct(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <img
              src={selectedProduct.image_url || selectedProduct.image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80'}
              alt={selectedProduct.name}
              style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: 8 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>{money(selectedProduct.price_cents, currency)}</span>
              <Badge tone={selectedProduct.stock > 0 ? 'green' : 'neutral'}>
                {selectedProduct.stock > 0 ? `In Stock (${selectedProduct.stock})` : 'Out of Stock'}
              </Badge>
            </div>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{selectedProduct.description}</p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                className="button primary"
                disabled={selectedProduct.stock <= 0}
                style={{ flex: 1 }}
                onClick={() => {
                  addToCart(selectedProduct);
                  setSelectedProduct(null);
                }}
              >
                <ShoppingCart size={16} /> Add to Cart
              </button>
              <button className="button secondary" onClick={() => setSelectedProduct(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Completed Order Confirmation & Live Tracking Modal */}
      {completedOrder && (
        <Modal title="Order Confirmation & Tracking" onClose={() => setCompletedOrder(null)} wide>
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ width: 64, height: 64, background: 'var(--success-bg)', color: 'var(--success)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <Check size={36} strokeWidth={2.5} />
            </div>
            <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Thank You for Your Order!</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              Order Reference: <strong style={{ color: 'var(--text-main)' }}>#{completedOrder.id.slice(0, 8).toUpperCase()}</strong>
            </p>

            {/* Tracking Stepper */}
            <div className="order-tracking-timeline">
              <div className="timeline-step completed">
                <div className="step-bubble"><Check size={18} /></div>
                <span className="step-label">Placed</span>
              </div>
              <div className={`timeline-step ${completedOrder.status !== 'pending' ? 'completed' : 'current'}`}>
                <div className="step-bubble">
                  {completedOrder.status !== 'pending' ? <Check size={18} /> : <Clock size={18} />}
                </div>
                <span className="step-label">Confirmed</span>
              </div>
              <div className={`timeline-step ${['shipped', 'completed'].includes(completedOrder.status) ? 'completed' : ''}`}>
                <div className="step-bubble"><Truck size={18} /></div>
                <span className="step-label">Shipped</span>
              </div>
              <div className={`timeline-step ${completedOrder.status === 'completed' ? 'completed' : ''}`}>
                <div className="step-bubble"><ShieldCheck size={18} /></div>
                <span className="step-label">Delivered</span>
              </div>
            </div>

            {/* Payment Status Details */}
            <div style={{ background: 'var(--bg-subtle)', padding: '1.25rem', borderRadius: 12, textAlign: 'left', margin: '1.5rem 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Payment Method</span>
                  <div style={{ fontWeight: 700, fontSize: '0.9375rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 2 }}>
                    {completedOrder.payment_method === 'cod' ? (
                      <><Banknote size={18} color="var(--primary)" /> Cash on Delivery (COD)</>
                    ) : (
                      <><CreditCard size={18} color="#1e3a8a" /> Paymob Gateway</>
                    )}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Payment Status</span>
                  <div style={{ marginTop: 2 }}>
                    <Badge tone={completedOrder.payment_status === 'paid' ? 'green' : 'amber'}>
                      {completedOrder.payment_status === 'paid' ? 'Paid' : 'Unpaid (Due on Delivery)'}
                    </Badge>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Order Total</span>
                  <div style={{ fontWeight: 800, fontSize: '1.125rem', color: 'var(--primary)' }}>
                    {money(completedOrder.total_cents, completedOrder.currency)}
                  </div>
                </div>
              </div>

              {/* Paymob Sandbox Simulation Box */}
              {paymobSession?.isSimulated && completedOrder.payment_status !== 'paid' && (
                <div style={{ marginTop: '1.25rem', padding: '1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <strong style={{ color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CreditCard size={16} /> Paymob Payment Simulator
                      </strong>
                      <p style={{ fontSize: '0.8125rem', color: '#1e40af', marginTop: 2 }}>
                        Test credit card and wallet processing with instant confirmation.
                      </p>
                    </div>
                    <button
                      className="button primary"
                      disabled={simulatingPaymob}
                      onClick={handleSimulatePaymobPayment}
                      style={{ background: '#1e3a8a' }}
                    >
                      {simulatingPaymob ? <RefreshCw size={14} className="spin" /> : <><Check size={14} /> Authorize & Pay via Paymob</>}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button className="button primary" onClick={() => setCompletedOrder(null)} style={{ width: '100%' }}>
              Continue Shopping
            </button>
          </div>
        </Modal>
      )}

      {/* Footer */}
      <footer style={{ marginTop: 'auto', padding: '2rem', borderTop: '1px solid var(--border-subtle)', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
        <p>A little clarity. A lot of possibility. — <strong style={{ color: 'var(--text-main)' }}>Powered by Storely SaaS</strong></p>
      </footer>
    </div>
  );
}

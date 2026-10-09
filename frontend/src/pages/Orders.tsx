import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronRight, Package, Plus, ShoppingBag, Trash2, Truck } from 'lucide-react';
import { useAction, useAllApi, useApi, usePermissions, useStore, useToast } from '../lib/hooks';
import type { Customer, List, Order, OrderStatus, Product } from '../types';
import { date, downloadCsv, initials, money, shortId, transitions } from '../lib/utils';
import { Badge, Button, Empty, Field, FormFooter, Modal, PageHeader, Pagination, Panel, QueryState, SearchInput } from '../components/ui';

export default function Orders() {
  const [params, setParams] = useSearchParams(), [create, setCreate] = useState(params.has('new')), [detail, setDetail] = useState<string | null>(null), [status, setStatus] = useState(''), [page, setPage] = useState(1), [search, setSearch] = useState('');
  const permissions = usePermissions();
  useEffect(() => { if (params.has('new')) setCreate(true); }, [params]);
  const query = useApi<List<Order>>(`/orders?page=${page}&limit=10${status ? `&status=${status}` : ''}`), customers = useApi<List<Customer>>('/customers?limit=100');
  const rows = query.data?.data.filter((o) => !search || `${shortId(o.id)} ${customers.data?.data.find((c) => c.id === o.customer_id)?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  function closeCreate() { setCreate(false); if (params.has('new')) { params.delete('new'); setParams(params, { replace: true }); } }
  return <><PageHeader eyebrow="FROM FIRST CLICK TO FINAL DELIVERY" title="Orders" description="Every order tells a story. Keep each one moving." actions={<><Button variant="secondary" disabled={!rows.length} onClick={() => downloadCsv('orders-page', rows.map((o) => ({ order: o.id, date: o.created_at, status: o.status, totalCents: o.total_cents, currency: o.currency })))}><ArrowDownToLine size={16} />Export page</Button>{permissions.write ? <Button onClick={() => setCreate(true)}><Plus size={17} />Create order</Button> : null}</>} />
    <Panel><div className="status-tabs" role="group" aria-label="Order status filter">{['', 'pending', 'confirmed', 'shipped', 'completed', 'cancelled'].map((s) => <button key={s} className={status === s ? 'active' : ''} onClick={() => { setStatus(s); setPage(1); setSearch(''); }}>{s || 'All orders'}{!s && query.data?.total !== undefined && !status ? <span>{query.data.total}</span> : null}</button>)}</div>
      <div className="list-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Search this page by order or customer…" /><span className="toolbar-label">Newest first <ChevronRight size={13} /></span></div>
      <QueryState query={query}>{!rows.length ? <Empty title="A little quiet, for now." description="New orders will appear here. Try another status or clear your search." /> : <div className="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Status</th><th>Payment</th><th>Total</th><th /></tr></thead><tbody>{rows.map((o) => {
        const c = customers.data?.data.find((c) => c.id === o.customer_id);
        return <tr key={o.id}><td><button className="order-id" onClick={() => setDetail(o.id)}>{shortId(o.id)}</button></td><td><div className="person-cell"><span className="avatar">{initials(c?.name ?? 'Customer')}</span><div><strong>{c?.name ?? shortId(o.customer_id)}</strong><span className="cell-sub">{c?.email ?? 'View order for customer details'}</span></div></div></td><td>{date(o.created_at, true)}</td><td><Badge tone={o.status}>{o.status}</Badge></td><td><Badge tone={o.payment_status === 'paid' ? 'green' : 'amber'}>{o.payment_method === 'paymob' ? 'Paymob' : 'COD'} · {o.payment_status ?? 'unpaid'}</Badge></td><td className="amount-cell">{money(o.total_cents, o.currency)}</td><td><button className="icon-button" aria-label={`View order ${shortId(o.id)}`} onClick={() => setDetail(o.id)}><ArrowUpRight size={17} /></button></td></tr>;
      })}</tbody></table></div>}<Pagination page={page} limit={10} total={query.data?.total} count={query.data?.data.length ?? 0} onChange={setPage} /></QueryState>
    </Panel><div className="page-footnote"><Check size={14} /> Stock is reserved at creation. Cancellations return it, exactly once.</div>
    {create && permissions.write ? <CreateOrder onClose={closeCreate} onCreated={(id) => { closeCreate(); setDetail(id); }} /> : null}{detail ? <OrderDetail id={detail} onClose={() => setDetail(null)} /> : null}
  </>;
}
export function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useApi<Order>(`/orders/${id}`), order = query.data, permissions = usePermissions(), action = useAction('Order status updated.');
  const customer = useApi<Customer>(`/customers/${order?.customer_id}`, !!order);
  const names: Record<OrderStatus, string> = { pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled' };
  return <Modal title={`Order ${shortId(id)}`} description={order ? `Created ${date(order.created_at, true)} · ${order.currency}` : 'Loading the details…'} wide onClose={onClose}><QueryState query={query}>{order ? <>
    <div className="order-detail-status"><Badge tone={order.status}>{order.status}</Badge><Badge tone={order.payment_status === 'paid' ? 'green' : 'amber'}>{order.payment_method === 'paymob' ? 'Paymob' : 'Cash on Delivery'} · {order.payment_status ?? 'unpaid'}</Badge></div>
    <div className="fulfillment-track">{(['pending', 'confirmed', 'shipped', 'completed'] as OrderStatus[]).map((s, i) => <div key={s} className={order.status !== 'cancelled' && ['pending', 'confirmed', 'shipped', 'completed'].indexOf(order.status) >= i ? 'done' : ''}><span>{s === 'shipped' ? <Truck size={15} /> : s === 'completed' ? <Check size={15} /> : <Package size={15} />}</span><strong>{names[s]}</strong></div>)}</div>
    <div className="detail-columns"><div><h3 className="section-label">THE COLLECTION</h3>{order.items?.map((item) => <div className="order-line" key={item.id}><span className="item-icon"><ShoppingBag size={20} /></span><div><strong>{item.name}</strong><span>{item.sku} · Qty {item.quantity}</span></div><strong>{money(item.unit_price_cents * item.quantity, order.currency)}</strong></div>)}
      <div className="detail-customer"><h3 className="section-label">CUSTOMER & SHIPPING</h3><strong>{customer.data?.name ?? shortId(order.customer_id)}</strong><p>{customer.data?.email}</p>{Object.keys(order.shipping_address).length ? <p>{Object.values(order.shipping_address).filter(Boolean).join(', ')}</p> : <p>No shipping address supplied.</p>}</div>
      <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--bg-subtle)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Payment Method</span>
          <div style={{ fontWeight: 600 }}>{order.payment_method === 'paymob' ? 'Paymob Gateway' : 'Cash on Delivery (COD)'}</div>
        </div>
        {permissions.write && order.payment_status !== 'paid' && (
          <Button variant="secondary" disabled={action.isPending} onClick={() => {
            action.mutate({ path: `/orders/${id}/payment`, method: 'PATCH', body: { paymentStatus: 'paid' } }, { onSuccess: () => void query.refetch() });
          }}><Check size={14} /> Mark as Paid</Button>
        )}
      </div>
    </div>
      <div className="order-summary"><h3>Order summary</h3>{[['Subtotal', order.subtotal_cents], ['Discount', -order.discount_cents], ['Tax', order.tax_cents], ['Shipping', order.shipping_cents]].map(([label, cents]) => <div key={label}><span>{label}</span><strong>{money(cents, order.currency)}</strong></div>)}<div className="summary-total"><span>Total</span><strong>{money(order.total_cents, order.currency)}</strong></div><p>Prices and product details are preserved as order-time snapshots.</p></div>
    </div>
    {permissions.write && transitions[order.status].length ? <div className="form-footer">{transitions[order.status].map((status) => <Button key={status} variant={status === 'cancelled' ? 'danger' : 'primary'} disabled={action.isPending} onClick={() => {
      if (status === 'cancelled' && !window.confirm('Cancel this order and restore its stock?')) return;
      action.mutate({ path: `/orders/${id}/status`, method: 'PATCH', body: { status } });
    }}>{status === 'cancelled' ? 'Cancel order' : status === 'confirmed' ? 'Confirm order' : status === 'shipped' ? 'Mark as shipped' : 'Complete order'}{status !== 'cancelled' ? <ArrowUpRight size={15} /> : null}</Button>)}</div> : null}
  </> : null}</QueryState></Modal>;
}
function CreateOrder({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const store = useStore(), action = useAction<Order>('A new order is on its way.'), toast = useToast();
  const [lines, setLines] = useState([{ key: crypto.randomUUID(), productId: '', quantity: 1 }]), [productSearch, setProductSearch] = useState(''), [customerId, setCustomerId] = useState('');
  const products = useAllApi<Product>(`/products?active=true${productSearch ? `&search=${encodeURIComponent(productSearch)}` : ''}`), customers = useAllApi<Customer>('/customers');
  const collection = products.data?.pages.flatMap((p) => p.data) ?? [], people = customers.data?.pages.flatMap((p) => p.data) ?? [];
  const retained = useRef<Map<string, Product>>(new Map()); collection.forEach((p) => retained.current.set(p.id, p));
  const subtotal = lines.reduce((sum, l) => sum + (retained.current.get(l.productId)?.price_cents ?? 0) * l.quantity, 0);
  const identity = useRef<{ signature: string; key: string } | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerId || lines.some((l) => !l.productId)) { toast('Choose a customer and a product for every line.', 'error'); return; }
    const form = new FormData(event.currentTarget), coupon = String(form.get('coupon') ?? '').trim();
    const body = { customerId, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })), ...(coupon ? { couponCode: coupon } : {}) };
    const signature = JSON.stringify(body);
    if (identity.current?.signature !== signature) identity.current = { signature, key: crypto.randomUUID() };
    action.mutate({ path: '/orders', body, headers: { 'Idempotency-Key': identity.current.key } }, { onSuccess: (order) => onCreated(order.id) });
  }
  return <Modal title="Start something good." description="Create an order. We’ll take care of pricing and stock." onClose={onClose} wide><form onSubmit={submit} className="form-body"><Field label="Customer"><select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Choose a customer</option>{people.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}</select></Field>{customers.hasNextPage ? <Button variant="ghost" type="button" disabled={customers.isFetchingNextPage} onClick={() => void customers.fetchNextPage()}>Load more customers</Button> : null}{customers.error ? <p className="inline-error">{customers.error.message}</p> : null}
    <div className="order-builder-label"><h3>Order items</h3><SearchInput value={productSearch} onChange={setProductSearch} placeholder="Find products by name or SKU…" /></div>
    {lines.map((line, index) => {
      const selected = retained.current.get(line.productId), options = selected && !collection.some((p) => p.id === selected.id) ? [selected, ...collection] : collection;
      return <div className="order-builder-line" key={line.key}><span className="line-number">{index + 1}</span><div className="builder-product"><select aria-label={`Product ${index + 1}`} required value={line.productId} onChange={(e) => setLines((items) => items.map((l) => l.key === line.key ? { ...l, productId: e.target.value } : l))}><option value="">Choose a product</option>{options.map((p) => <option value={p.id} key={p.id} disabled={p.stock === 0 || lines.some((l) => l.key !== line.key && l.productId === p.id)}>{p.name} · {money(p.price_cents, store.currency)} · {p.stock} in stock</option>)}</select>{selected ? <span>{selected.sku} · {selected.stock} available</span> : null}</div><input aria-label={`Quantity ${index + 1}`} type="number" min={1} max={Math.min(selected?.stock ?? 1000, 1000)} step={1} required value={line.quantity} onChange={(e) => setLines((items) => items.map((l) => l.key === line.key ? { ...l, quantity: Number(e.target.value) } : l))} /><button type="button" className="icon-button" aria-label={`Remove item ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((items) => items.filter((l) => l.key !== line.key))}><Trash2 size={16} /></button></div>;
    })}<div className="builder-actions"><Button type="button" variant="ghost" disabled={lines.length >= 100} onClick={() => setLines((items) => [...items, { key: crypto.randomUUID(), productId: '', quantity: 1 }])}><Plus size={15} />Add another item</Button>{products.hasNextPage ? <Button type="button" variant="ghost" disabled={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()}>Load more products</Button> : null}</div>{products.error ? <p className="inline-error">{products.error.message}</p> : null}
    <div className="builder-summary"><Field label="Coupon code (optional)"><input name="coupon" placeholder="WELCOME10" maxLength={40} pattern="[A-Za-z0-9_-]+" /></Field><div><span>Estimated subtotal</span><strong>{money(subtotal, store.currency)}</strong><small>Before coupon, tax & shipping. Final totals are confirmed by the server. Uses the customer’s saved shipping address.</small></div></div><FormFooter pending={action.isPending} onClose={onClose} label="Create order" /></form></Modal>;
}

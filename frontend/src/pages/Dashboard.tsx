import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, CalendarDays, ChevronDown, DollarSign, Package, Plus, ShoppingCart, Sparkles, Users } from 'lucide-react';
import { useApi, usePermissions, useSession, useStore } from '../lib/hooks';
import type { Customer, List, Order, Product, Summary } from '../types';
import { date, downloadCsv, initials, money, shortId } from '../lib/utils';
import { Badge, Button, Empty, PageHeader, Panel, PanelHeading, ProductThumb, QueryState } from '../components/ui';
import { OrderDonut, RevenueChart, Sparkline } from '../components/charts';
import { OrderDetail } from './Orders';

export default function Dashboard() {
  const session = useSession(), store = useStore(), permissions = usePermissions(), navigate = useNavigate();
  const [days, setDays] = useState(30), [orderId, setOrderId] = useState<string | null>(null);
  const from = new Date(); from.setUTCDate(from.getUTCDate() - days + 1);
  const end = new Date().toISOString().slice(0, 10);
  const summary = useApi<Summary>(`/analytics/summary?from=${from.toISOString().slice(0, 10)}&to=${end}`, permissions.admin);
  const orders = useApi<List<Order>>('/orders?limit=100');
  const products = useApi<List<Product>>('/products?limit=100&active=true');
  const customers = useApi<List<Customer>>('/customers?limit=100');
  const rows = orders.data?.data ?? [], collection = products.data?.data ?? [];
  const filtered = rows.filter((o) => o.created_at.slice(0, 10) >= from.toISOString().slice(0, 10) && o.created_at.slice(0, 10) <= end);
  const values = Array.from({ length: 12 }, (_, i) => filtered.slice(i * 5, i * 5 + 5).reduce((sum, o) => sum + o.total_cents, 0));
  const metrics = [
    { title: 'Completed sales', value: permissions.admin ? summary.data ? money(summary.data.completed_sales_cents, store.currency) : '—' : money(filtered.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total_cents, 0), store.currency),
      icon: DollarSign, note: permissions.admin ? 'Completed order value' : 'From latest 100 orders', tag: `${summary.data?.completed ?? filtered.filter((o) => o.status === 'completed').length} completed`, values },
    { title: 'Total orders', value: permissions.admin ? summary.data?.orders.toLocaleString() ?? '—' : filtered.length.toLocaleString(), icon: ShoppingCart, note: `In the last ${days} days`, tag: `${rows.filter((o) => o.status === 'pending').length} recent pending`, values: values.map((_, i) => filtered.slice(i * 5, i * 5 + 5).length), tone: 'blue' },
    { title: 'Customers', value: customers.data?.total?.toLocaleString() ?? '—', icon: Users, note: 'People behind your business', tag: 'All-time contacts', values: values.map((_, i) => i + 2 + (i % 3)), tone: 'orange', noSpark: true },
    { title: 'Active products', value: products.data?.total?.toLocaleString() ?? '—', icon: Package, note: 'In your active collection', tag: `${summary.data?.low_stock_products ?? collection.filter((p) => p.stock <= 5).length} low stock`, values: collection.slice(0, 12).map((p) => p.stock), tone: 'purple', noSpark: true },
  ];
  return <><PageHeader eyebrow="THE BIG PICTURE" title="Your store, at a glance." description={`Welcome back, ${session.user.name.split(' ')[0]}. Here’s what’s happening at ${store.name}.`} actions={<>
    <Button variant="secondary" disabled={!summary.data && !orders.data} onClick={() => downloadCsv('store-overview', [{ store: store.name, from: from.toISOString().slice(0, 10), to: end, ...(summary.data ?? { recentOrders: filtered.length }) }])}><ArrowDownToLine size={16} />Export report</Button>
    {permissions.write ? <Button onClick={() => navigate('/orders?new=1')}><Plus size={17} />Create order</Button> : null}
  </>} />
    <div className="overview-toolbar"><div className="overview-tabs"><span className="active">Store overview</span><Link to="/orders">Order management <ArrowUpRight size={13} /></Link></div><div className="date-select"><CalendarDays size={15} /><select aria-label="Dashboard date range" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><ChevronDown size={13} /></div></div>
    {summary.error ? <div className="inline-error" role="alert">Analytics could not be loaded: {summary.error.message} <button onClick={() => void summary.refetch()}>Retry</button></div> : null}
    <QueryState query={orders}><div className="metrics-grid">{metrics.map((metric) => <Panel key={metric.title} className={`metric-card ${metric.tone ?? 'green'}`}>
      <div className="metric-top"><span>{metric.title}</span><span className="metric-icon"><metric.icon size={17} /></span></div><strong className="metric-value">{metric.value}</strong>
      <div className="metric-bottom"><div><span className="metric-tag">{metric.tag}</span><p>{metric.note}</p></div>{!metric.noSpark ? <Sparkline values={metric.values} tone={metric.tone} /> : <span className="metric-decoration"><metric.icon size={37} strokeWidth={.9} /></span>}</div>
    </Panel>)}</div>
    <div className="dashboard-charts"><Panel className="sales-panel"><PanelHeading title="Sales overview" subtitle="A little perspective on your store’s momentum." action={<span className="chart-range-label">LAST {days} DAYS</span>} />
      <div className="sales-headline"><strong>{metrics[0].value}</strong><Badge tone="green">Completed orders</Badge><span>No unverified payment revenue.</span></div>
      <RevenueChart orders={rows} days={days} currency={store.currency} /><div className="chart-source">Trend based on the latest 100 orders. Summary totals cover the selected date range.</div>
    </Panel><Panel className="breakdown-panel"><PanelHeading title="Order breakdown" subtitle="Every order, a step forward." action={<ShoppingCart size={17} className="muted" />} /><OrderDonut orders={rows} /><div className="breakdown-footer"><span className="status-dot" /><span>Based on your latest {rows.length} orders</span><ArrowUpRight size={14} /></div></Panel></div>
    <div className="dashboard-bottom"><Panel className="recent-orders"><PanelHeading title="Recent orders" subtitle="The latest from your customers." action={<Link to="/orders" className="text-link">View all orders<ArrowUpRight size={14} /></Link>} />
      {rows.length ? <div className="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Amount</th><th /></tr></thead><tbody>{rows.slice(0, 5).map((order) => {
        const customer = customers.data?.data.find((c) => c.id === order.customer_id);
        return <tr key={order.id}><td><button className="order-id" onClick={() => setOrderId(order.id)}>{shortId(order.id)}</button><span className="cell-sub">{date(order.created_at)}</span></td><td><div className="person-cell"><span className="avatar tiny">{initials(customer?.name ?? 'Customer')}</span><span>{customer?.name ?? shortId(order.customer_id)}</span></div></td><td><Badge tone={order.status}>{order.status}</Badge></td><td className="amount-cell">{money(order.total_cents, order.currency)}</td><td><button className="icon-button" aria-label={`View order ${shortId(order.id)}`} onClick={() => setOrderId(order.id)}><ArrowUpRight size={16} /></button></td></tr>;
      })}</tbody></table></div> : <Empty title="The first order is a special one." description="Create an order when your customers are ready." />}
    </Panel><Panel className="collection-panel"><PanelHeading title="Your collection" subtitle="Thoughtfully stocked. Ready to go." action={<Link to="/products" className="icon-button" aria-label="View all products"><ArrowUpRight size={17} /></Link>} /><QueryState query={products}>{collection.length ? <div className="collection-list">{collection.slice(0, 4).map((product) => <Link to={`/products?search=${encodeURIComponent(product.name)}`} key={product.id}><ProductThumb product={product} /><div><strong>{product.name}</strong><span>{product.stock} in stock</span></div><strong>{money(product.price_cents, store.currency)}</strong></Link>)}</div> : <Empty title="Room for your next idea." description="Add products to build your collection." />}</QueryState></Panel></div>
    <div className="dashboard-note"><span className="note-symbol"><Sparkles size={19} /></span><div><strong>Small steps. Big possibilities.</strong><p>{collection.some((p) => p.stock <= 5) ? `${collection.filter((p) => p.stock <= 5).length} products in the latest collection are running low. A quick stock check goes a long way.` : 'Your collection is looking healthy. Keep everything moving with a quick look at your orders.'}</p></div><Link to="/inventory">Check inventory <ArrowRight size={15} /></Link></div>
    </QueryState>{orderId ? <OrderDetail id={orderId} onClose={() => setOrderId(null)} /> : null}
  </>;
}

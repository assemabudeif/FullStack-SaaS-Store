import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowUpRight, Bell, BookOpen, Boxes, ChevronDown, ChevronRight, CircleHelp, Command, CreditCard, ExternalLink, LayoutDashboard, LogOut, Menu, Moon, Package, Search, Settings2, ShoppingBag, ShoppingCart, Sparkles, Sun, Tag, TicketPercent, Users, UsersRound, X } from 'lucide-react';
import { useApi, usePermissions, useSession, useStore, useToast } from '../lib/hooks';
import { client } from '../lib/api';
import type { Audit, List, Product, Subscription } from '../types';
import { date, humanAction, initials } from '../lib/utils';
import { Badge, Modal, SearchInput } from './ui';

export const navigation = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, section: 'WORKSPACE' },
  { path: '/orders', label: 'Orders', icon: ShoppingCart },
  { path: '/products', label: 'Products', icon: Package },
  { path: '/categories', label: 'Categories', icon: Tag },
  { path: '/inventory', label: 'Inventory', icon: Boxes },
  { path: '/customers', label: 'Customers', icon: Users },
  { path: '/coupons', label: 'Discounts', icon: TicketPercent, admin: true },
  { path: '/team', label: 'Team members', icon: UsersRound, section: 'ORGANIZATION', admin: true },
  { path: '/subscription', label: 'Plan & usage', icon: CreditCard, admin: true },
  { path: '/audit', label: 'Activity log', icon: Activity, admin: true },
  { path: '/settings', label: 'Store settings', icon: Settings2, admin: true },
];
export function Logo({ dark = false }: { dark?: boolean }) {
  return <Link to="/" className={`logo ${dark ? 'on-light' : ''}`} aria-label="Storely home"><span><ShoppingBag size={23} strokeWidth={1.8} /></span>storely<span className="logo-period">.</span></Link>;
}
export function Layout() {
  const session = useSession(), store = useStore(), permissions = usePermissions(), location = useLocation(), navigate = useNavigate(), toast = useToast();
  const [mobile, setMobile] = useState(false), [palette, setPalette] = useState(false), [help, setHelp] = useState(false), [notifications, setNotifications] = useState(false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('storely-theme') === 'dark'; } catch { return false; } });
  const subscription = useApi<Subscription>('/subscription', permissions.admin);
  const activity = useApi<List<Audit>>('/audit-logs?limit=5', notifications && permissions.admin);
  const active = navigation.find((item) => item.path === location.pathname);
  useEffect(() => { setMobile(false); setNotifications(false); }, [location.pathname]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('storely-theme', dark ? 'dark' : 'light'); } catch { /* storage blocked */ }
  }, [dark]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); setPalette((value) => !value); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    {mobile ? <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobile(false)} /> : null}
    <aside className={`sidebar ${mobile ? 'is-open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-brand"><Logo /><button className="mobile-close icon-button" aria-label="Close menu" onClick={() => setMobile(false)}><X size={20} /></button></div>
      <div className="workspace-picker"><span className="workspace-avatar">{initials(store.name)}</span><div><span>YOUR WORKSPACE</span><select aria-label="Select store" value={session.tenantId} onChange={(e) => { client.selectStore(e.target.value); navigate('/'); }}>
        {session.stores.map((s) => <option value={s.id} key={s.id}>{s.id === store.id ? store.name : s.name}</option>)}
      </select></div><ChevronDown size={14} /></div>
      <nav>{navigation.filter((item) => !item.admin || permissions.admin).map((item) => <div key={item.path}>
        {item.section ? <p className="nav-section">{item.section}</p> : null}
        <NavLink to={item.path} end={item.path === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{item.path === '/' ? <span className="nav-active-dot" /> : null}</NavLink>
      </div>)}</nav>
      <div className="sidebar-bottom">
        {permissions.admin ? <div className="plan-callout"><span className="plan-symbol"><Sparkles size={17} /></span><h3>A little room to grow.</h3><p>Your {subscription.data?.plan ?? 'current'} workspace, built for what’s next.</p><Link to="/subscription">Explore your plan <ArrowUpRight size={15} /></Link></div> : null}
        <button className="nav-item help-button" onClick={() => setHelp(true)}><CircleHelp size={19} /><span>Help & getting started</span><ArrowUpRight size={15} /></button>
        <div className="sidebar-profile"><span className="avatar">{initials(session.user.name)}</span><div><strong>{session.user.name}</strong><span>{permissions.role === 'owner' ? 'Store owner' : permissions.role}</span></div><button className="icon-button" aria-label={session.mode === 'demo' ? 'Sign in to a real store' : 'Sign out'} onClick={() => {
          if (session.mode === 'demo') navigate('/login'); else void client.signOut().then(() => { toast('Signed out securely.'); navigate('/login'); });
        }}><LogOut size={17} /></button></div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="breadcrumb"><button className="icon-button hamburger" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{active?.label ?? 'Overview'}</strong></div>
        <div className="topbar-actions"><button className="command-search" onClick={() => setPalette(true)}><Search size={17} /><span>Search anything…</span><kbd>⌘ K</kbd></button>
          <button className="icon-button" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          <div className="notification-wrap"><button className={`icon-button ${notifications ? 'selected' : ''}`} aria-label="Show recent activity" aria-expanded={notifications} onClick={() => setNotifications(!notifications)}><Bell size={19} /><span className="notification-indicator" /></button>
            {notifications ? <div className="notification-popover"><div className="popover-title"><h3>Workspace activity</h3><Badge tone="green">Live</Badge></div>
              {!permissions.admin ? <p>Your role does not have access to the audit log.</p> : activity.isPending ? <p>Loading activity…</p> : activity.error ? <p>{activity.error.message}</p> : activity.data?.data.length ? activity.data.data.map((a) => <div className="notification-row" key={a.id}><span className="activity-icon"><Activity size={15} /></span><div><strong>{humanAction(a.action)}</strong><span>{date(a.created_at, true)}</span></div></div>) : <p>No activity yet.</p>}
              {permissions.admin ? <Link to="/audit">View all activity <ArrowUpRight size={14} /></Link> : null}
            </div> : null}
          </div><span className="topbar-divider" /><span className="avatar small">{initials(session.user.name)}</span>
        </div>
      </header>
      {session.mode === 'demo' ? <div className="demo-banner"><span><span className="demo-indicator" /><strong>Demo workspace</strong><span className="demo-description">A little preview. All changes stay in your browser.</span></span><Link to="/login">Connect your store <ArrowUpRight size={14} /></Link></div> : null}
      <main id="main-content" className="content" key={`${session.mode}-${session.tenantId}`}><Outlet /></main>
      <footer className="app-footer"><span>Made for the way you do business.</span><span><span className="status-dot" />{session.mode === 'demo' ? 'Interactive demo' : 'Connected workspace'} <span className="footer-separator">·</span> Storely © {new Date().getFullYear()}</span></footer>
    </div>
    {palette ? <CommandPalette onClose={() => setPalette(false)} /> : null}
    {help ? <Modal title="A place for everything." description="A quick guide to your commerce workspace." onClose={() => setHelp(false)}>
      <div className="help-grid"><div><Package /><h3>Build your collection</h3><p>Add categories and products, set prices, and use inventory adjustments to track every stock change.</p></div><div><ShoppingCart /><h3>From order to doorstep</h3><p>Create orders for customers, apply coupons, then confirm, ship, and complete. Cancellation restores inventory.</p></div><div><UsersRound /><h3>Bring your people</h3><p>Add registered accounts to your team. Roles keep sensitive settings and actions in the right hands.</p></div><div><BookOpen /><h3>Know your workspace</h3><p>View completed sales, plan usage, and audit history. Sandbox plans never collect payments.</p></div></div>
      <div className="help-note">Demo records are local samples. Live payments, customer checkout, and email invitations are not yet integrated.</div><a className="button secondary docs-link" href="/docs" target="_blank" rel="noreferrer">Open API documentation <ExternalLink size={15} /></a>
    </Modal> : null}
  </div>;
}
function CommandPalette({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState(''), navigate = useNavigate(), permissions = usePermissions();
  const products = useApi<List<Product>>('/products?limit=100&active=true');
  const go = (path: string) => { navigate(path); onClose(); };
  const nav = navigation.filter((item) => (!item.admin || permissions.admin) && item.label.toLowerCase().includes(search.toLowerCase()));
  const matches = products.data?.data.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 4) ?? [];
  return <Modal title="Find your next move." onClose={onClose}><SearchInput value={search} onChange={setSearch} placeholder="Search pages and products…" /><div className="command-list"><p className="eyebrow">WORKSPACE</p>
    {nav.map((n) => <button key={n.path} onClick={() => go(n.path)}><n.icon size={18} /><span>{n.label}</span><ChevronRight size={14} /></button>)}
    {matches.length ? <><p className="eyebrow">PRODUCTS · LATEST 100</p>{matches.map((p) => <button key={p.id} onClick={() => go(`/products?search=${encodeURIComponent(p.name)}`)}><Package size={17} /><span>{p.name}</span><ChevronRight size={14} /></button>)}</> : null}
    {!nav.length && !matches.length ? <p>No matches. Try a product name or “orders”.</p> : null}
  </div><div className="command-footer"><Command size={14} /><span>Quick navigation, less clicking.</span><kbd>esc</kbd> to close</div></Modal>;
}

import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ToastProvider, usePermissions } from './lib/hooks';
import { Empty } from './components/ui';
import Dashboard from './pages/Dashboard';

const Products = lazy(() => import('./pages/Products'));
const Orders = lazy(() => import('./pages/Orders'));
const Customers = lazy(() => import('./pages/Customers'));
const Categories = lazy(() => import('./pages/Categories'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Coupons = lazy(() => import('./pages/Coupons'));
const Team = lazy(() => import('./pages/Team'));
const Subscription = lazy(() => import('./pages/Subscription'));
const Settings = lazy(() => import('./pages/Settings'));
const Audit = lazy(() => import('./pages/Audit'));
const Auth = lazy(() => import('./pages/Auth'));
const Storefront = lazy(() => import('./pages/Storefront'));
const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
function Admin({ children }: { children: ReactNode }) {
  const permissions = usePermissions();
  return permissions.admin ? children : <Empty title="A little more access is needed." description="This view is reserved for store owners and administrators." action={<Link to="/" className="button secondary">Back to overview</Link>} />;
}
export default function App() {
  return <QueryClientProvider client={queryClient}><ToastProvider><BrowserRouter><Suspense fallback={<div className="route-loading" role="status"><span className="loading-mark" />Opening your workspace…</div>}><Routes>
    <Route path="/login" element={<Auth />} /><Route path="/shop/:slug" element={<Storefront />} />
    <Route element={<Layout />}><Route index element={<Dashboard />} /><Route path="products" element={<Products />} /><Route path="orders" element={<Orders />} /><Route path="customers" element={<Customers />} /><Route path="categories" element={<Categories />} /><Route path="inventory" element={<Inventory />} />
      <Route path="coupons" element={<Admin><Coupons /></Admin>} /><Route path="team" element={<Admin><Team /></Admin>} /><Route path="subscription" element={<Admin><Subscription /></Admin>} /><Route path="settings" element={<Admin><Settings /></Admin>} /><Route path="audit" element={<Admin><Audit /></Admin>} />
      <Route path="*" element={<Empty title="That page took a different turn." description="Let’s get you back to your workspace." action={<Link to="/" className="button primary">Back to overview</Link>} />} />
    </Route>
  </Routes></Suspense></BrowserRouter></ToastProvider></QueryClientProvider>;
}

import { useState, type FormEvent } from 'react';
import { CreditCard, ExternalLink, Globe2, Save, ShieldCheck, Store as StoreIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAction, useSession, useStore, useToast } from '../lib/hooks';
import { toCents } from '../lib/utils';
import { resetDemo } from '../lib/demo';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Field, PageHeader, Panel, PanelHeading } from '../components/ui';

export default function Settings() {
  const store = useStore(), session = useSession(), action = useAction('Your store settings are saved.'), toast = useToast(), queryClient = useQueryClient();
  const [tab, setTab] = useState('store');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    try {
      const payload: Record<string, any> = {};
      if (tab === 'store') payload.name = f.get('name');
      if (tab === 'pricing') {
        payload.taxBasisPoints = toCents(String(f.get('tax')));
        payload.shippingCents = toCents(String(f.get('shipping')));
      }
      if (tab === 'payments') {
        if (f.get('paymobApiKey')) payload.paymobApiKey = String(f.get('paymobApiKey')).trim();
        if (f.get('paymobIntegrationId')) payload.paymobIntegrationId = Number(f.get('paymobIntegrationId'));
        if (f.get('paymobIframeId')) payload.paymobIframeId = Number(f.get('paymobIframeId'));
        if (f.get('paymobHmac')) payload.paymobHmac = String(f.get('paymobHmac')).trim();
      }
      action.mutate({ path: '/store', method: 'PATCH', body: payload }, {
        onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['store'] }); },
      });
    } catch (error) { toast((error as Error).message, 'error'); }
  }
  return <><PageHeader eyebrow="MAKE IT YOURS" title="Store settings" description="The small details that make your workspace feel like home." /><div className="settings-layout"><div className="settings-nav">{[['store', 'Store details', StoreIcon], ['pricing', 'Tax & shipping', Globe2], ['payments', 'Payment Gateways', CreditCard], ['account', 'Account & security', ShieldCheck]].map(([key, label, Icon]) => {
    const Component = Icon as typeof StoreIcon;
    return <button key={String(key)} className={tab === key ? 'active' : ''} onClick={() => setTab(String(key))}><Component size={17} /><span>{String(label)}</span></button>;
  })}</div><div className="settings-panels">{tab === 'account' ? <Panel className="settings-panel"><PanelHeading title="A workspace that’s yours." subtitle="Your current identity and session." /><div className="form-body"><Field label="Name"><input value={session.user.name} readOnly /></Field><Field label="Email"><input value={session.user.email} readOnly /></Field><div className="help-note">Account profile editing, password reset, email verification and MFA are not available in the current backend. Live sessions use short-lived access tokens and rotating refresh tokens.</div>{session.mode === 'demo' ? <div className="reset-demo"><h3>Start the demo fresh.</h3><p>Restore sample products, orders and settings. This never touches a real store.</p><Button variant="secondary" onClick={() => {
    if (!window.confirm('Reset all demo changes in this browser?')) return;
    resetDemo(); void queryClient.invalidateQueries({ queryKey: ['store-data', 'demo'] }); toast('Demo restored. A fresh start.');
  }}>Reset demo workspace</Button></div> : null}</div></Panel> : <form onSubmit={submit} key={`${store.id}-${tab}`}><Panel className="settings-panel"><PanelHeading title={tab === 'store' ? 'The place you call your store.' : tab === 'payments' ? 'Payment Gateways (COD & Paymob)' : 'Clear pricing, from the start.'} subtitle={tab === 'store' ? 'Your name, your URL, your workspace.' : tab === 'payments' ? 'Configure Cash on Delivery and Paymob credentials.' : 'These settings apply to new orders only.'} /><div className="form-body">{tab === 'store' ? <><Field label="Store name"><input name="name" required maxLength={100} defaultValue={store.name} /></Field><Field label="Store URL" hint="Your unique store slug is permanent in the current API."><div className="input-prefix"><span>/shop/</span><input value={store.slug} readOnly /></div></Field><div className="form-grid"><Field label="Currency" hint="Selected at registration. Immutable."><input value={store.currency} readOnly /></Field><Field label="Store role"><input value={store.role} readOnly className="capitalize" /></Field></div><div className="storefront-card"><Globe2 size={24} /><div><strong>A window into your collection.</strong><p>Your active products have a public catalog.</p></div><Link to={`/shop/${store.slug}`} className="button secondary compact" target="_blank">View catalog <ExternalLink size={14} /></Link></div></> : tab === 'payments' ? <><div style={{ padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 8, marginBottom: '1rem' }}><strong>Cash on Delivery (COD)</strong><p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Always enabled by default. Couriers collect payment in cash upon delivery.</p></div><h3 style={{ fontSize: '1rem', margin: '1rem 0 0.5rem' }}>Paymob Accept API Configuration</h3><p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Obtain these credentials from your Paymob Dashboard under Settings & Integrations.</p><Field label="Paymob API Key" hint="Your secret API Key from Paymob"><input name="paymobApiKey" placeholder="ZXlKaGJHY2lPaUpJVXpVe..." defaultValue={store.paymob_api_key ?? ''} /></Field><div className="form-grid"><Field label="Paymob Integration ID" hint="Card or Wallet integration ID"><input name="paymobIntegrationId" type="number" placeholder="42456" defaultValue={store.paymob_integration_id ?? ''} /></Field><Field label="Paymob Iframe ID" hint="Display iframe ID"><input name="paymobIframeId" type="number" placeholder="798934" defaultValue={store.paymob_iframe_id ?? ''} /></Field></div><Field label="Paymob HMAC Secret" hint="Used to cryptographically sign webhooks"><input name="paymobHmac" placeholder="HMAC Secret Key" defaultValue={store.paymob_hmac ?? ''} /></Field><div className="help-note">If Paymob credentials are not filled, checkout runs in development simulation mode so you can test payment flows without live merchant approval.</div></> : <><div className="form-grid"><Field label="Tax rate (%)" hint="Applied to the discounted subtotal."><input name="tax" type="number" min={0} max={100} step=".01" required defaultValue={(store.tax_basis_points / 100).toFixed(2)} /></Field><Field label={`Flat shipping (${store.currency})`} hint="Added after discount and tax."><input name="shipping" inputMode="decimal" required pattern="\d+(\.\d{1,2})?" defaultValue={(store.shipping_cents / 100).toFixed(2)} /></Field></div><div className="help-note">Tax is a simple store-wide rate, not a jurisdiction-specific tax engine. Consult the requirements for your store before using it commercially.</div><div className="pricing-example"><span>Order calculation</span><strong>Subtotal − discount + tax + shipping</strong><p>All amounts are computed and validated by the server.</p></div></>}</div><div className="settings-save"><span><Badge tone="green">Server validated</Badge></span><Button type="submit" disabled={action.isPending}><Save size={16} />{action.isPending ? 'Saving…' : 'Save changes'}</Button></div></Panel></form>}</div></div></>;
}

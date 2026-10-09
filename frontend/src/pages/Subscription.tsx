import { Check, CreditCard, Leaf, Rocket, ShieldCheck, Sparkles } from 'lucide-react';
import { useAction, useApi, usePermissions } from '../lib/hooks';
import type { Subscription as SubscriptionType } from '../types';
import { limits } from '../lib/demo';
import { Badge, Button, PageHeader, Panel, PanelHeading, QueryState } from '../components/ui';

export default function Subscription() {
  const query = useApi<SubscriptionType>('/subscription'), permissions = usePermissions(), action = useAction('Sandbox plan changed. No payment was collected.'), subscription = query.data;
  const plans = [
    { key: 'free', name: 'A good beginning.', label: 'Free', description: 'A little room to bring your idea to life.', icon: Leaf },
    { key: 'pro', name: 'Room to grow.', label: 'Pro', description: 'More space for your next big chapter.', icon: Sparkles },
    { key: 'business', name: 'Think a little bigger.', label: 'Business', description: 'A workspace for a thriving operation.', icon: Rocket },
  ] as const;
  return <><PageHeader eyebrow="BUILT FOR YOUR NEXT CHAPTER" title="Plan & usage" description="A workspace that grows at your pace. No surprises." /><QueryState query={query}>{subscription ? <>
    <div className="subscription-status"><span className="intro-icon"><CreditCard size={25} /></span><div><span className="eyebrow">YOUR CURRENT PLAN</span><h2>{subscription.plan[0].toUpperCase() + subscription.plan.slice(1)} workspace <Badge tone="green">{subscription.status}</Badge></h2></div><span className="sandbox-label"><ShieldCheck size={16} />{subscription.sandbox ? 'Sandbox · no charges' : 'Live billing not connected'}</span></div>
    <Panel className="usage-panel"><PanelHeading title="A little perspective on your usage." subtitle="Limits are enforced server-side, including concurrent requests." /><div className="usage-grid">{[['products', 'Active products'], ['members', 'Team members'], ['ordersPerMonth', 'Orders this month']].map(([key, label]) => {
      const k = key as keyof SubscriptionType['usage'], used = subscription.usage[k], max = subscription.limits[k];
      return <div key={key}><div className="usage-label"><strong>{label}</strong><span>{used.toLocaleString()} <small>/ {max.toLocaleString()}</small></span></div><div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={Math.min(used, max)} aria-valuemin={0} aria-valuemax={max}><span style={{ width: `${Math.min(used / max * 100, 100)}%` }} /></div><p>{Math.max(max - used, 0).toLocaleString()} remaining{key === 'ordersPerMonth' ? ' this UTC calendar month' : ''}</p></div>;
    })}</div></Panel>
    <div className="plan-grid">{plans.map((plan) => <article key={plan.key} className={`panel pricing-card ${plan.key === subscription.plan ? 'current' : ''}`}><div className="pricing-top"><span className="pricing-icon"><plan.icon size={23} /></span>{plan.key === subscription.plan ? <Badge tone="green">Your plan</Badge> : <Badge>{plan.label}</Badge>}</div><h2>{plan.name}</h2><p>{plan.description}</p><div className="plan-name">{plan.label}<span>{subscription.sandbox ? 'Sandbox tier' : 'Capacity tier'}</span></div><ul>{[`${limits[plan.key].products.toLocaleString()} active products`, `${limits[plan.key].members} team members`, `${limits[plan.key].ordersPerMonth.toLocaleString()} orders per month`, 'Transactional inventory & orders', 'Reports and activity history'].map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul><Button variant={plan.key === subscription.plan ? 'secondary' : 'primary'} disabled={plan.key === subscription.plan || !subscription.sandbox || !permissions.owner || action.isPending} onClick={() => action.mutate({ path: '/subscription/sandbox-plan', body: { plan: plan.key } })}>{plan.key === subscription.plan ? 'Your current plan' : !subscription.sandbox ? 'Billing not connected' : !permissions.owner ? 'Owner access required' : `Try ${plan.label} in sandbox`}</Button></article>)}</div>
    <div className="billing-note"><ShieldCheck size={20} /><div><strong>Clarity, not fine print.</strong><p>Plan changes here are sandbox-only and never charge a card. A payment provider must be integrated before paid subscriptions are available. Cancelling an order does not reduce monthly usage.</p></div></div>
  </> : null}</QueryState></>;
}

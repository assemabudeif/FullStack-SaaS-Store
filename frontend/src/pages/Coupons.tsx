import { useState, type FormEvent } from 'react';
import { Copy, Plus, TicketPercent, Trash2 } from 'lucide-react';
import { useAction, useApi, useToast } from '../lib/hooks';
import type { Coupon, List } from '../types';
import { date } from '../lib/utils';
import { Badge, Button, Confirm, Empty, Field, FormFooter, Modal, PageHeader, Pagination, Panel, QueryState } from '../components/ui';

export default function Coupons() {
  const [page, setPage] = useState(1), [create, setCreate] = useState(false), [remove, setRemove] = useState<Coupon | null>(null);
  const query = useApi<List<Coupon>>(`/coupons?page=${page}&limit=12`), action = useAction('Coupon disabled.'), toast = useToast();
  return <><PageHeader eyebrow="A LITTLE SOMETHING EXTRA" title="Discounts" description="Thoughtful offers for the people who choose your store." actions={<Button onClick={() => setCreate(true)}><Plus size={17} />Create coupon</Button>} /><QueryState query={query}>{query.data?.data.length ? <div className="coupon-grid">{query.data.data.map((c) => {
    const expired = new Date(c.expires_at).getTime() <= Date.now(), exhausted = c.used >= c.max_uses;
    return <article className={`panel coupon-card ${!c.active || expired ? 'inactive' : ''}`} key={c.id}><div className="coupon-top"><span className="coupon-symbol"><TicketPercent size={24} /></span><Badge tone={!c.active || expired || exhausted ? 'neutral' : 'green'}>{!c.active ? 'Disabled' : expired ? 'Expired' : exhausted ? 'Exhausted' : 'Active'}</Badge></div><div className="coupon-discount"><strong>{c.percent}<span>%</span></strong><div>off your<br />next good thing.</div></div><div className="coupon-code"><code>{c.code}</code><button className="icon-button" aria-label={`Copy coupon ${c.code}`} onClick={() => void navigator.clipboard.writeText(c.code).then(() => toast('Coupon code copied.')).catch(() => toast('Clipboard unavailable. Copy the displayed code.', 'error'))}><Copy size={15} /></button></div><div className="coupon-usage"><span>{c.used} of {c.max_uses} uses</span><span>{Math.round(c.used / c.max_uses * 100)}%</span></div><div className="progress-track"><span style={{ width: `${Math.min(c.used / c.max_uses * 100, 100)}%` }} /></div><div className="coupon-footer"><span>Expires {date(c.expires_at)}</span>{c.active ? <button className="icon-button" aria-label={`Disable ${c.code}`} onClick={() => setRemove(c)}><Trash2 size={15} /></button> : null}</div></article>;
  })}</div> : <Panel><Empty title="A thoughtful offer starts here." description="Create a percentage coupon with an expiry and usage limit." /></Panel>}<Pagination page={page} limit={12} total={query.data?.total} count={query.data?.data.length ?? 0} onChange={setPage} /></QueryState><div className="page-footnote"><TicketPercent size={14} /> Coupons apply before tax. Cancelled orders return the coupon’s available use.</div>
    {create ? <CouponForm onClose={() => setCreate(false)} /> : null}{remove ? <Confirm title={`Disable ${remove.code}?`} description="The coupon will no longer work for new orders. Existing discounts remain unchanged." onClose={() => setRemove(null)} pending={action.isPending} onConfirm={() => action.mutate({ path: `/coupons/${remove.id}`, method: 'DELETE' }, { onSuccess: () => setRemove(null) })} /> : null}</>;
}
function CouponForm({ onClose }: { onClose: () => void }) {
  const action = useAction('Your new offer is ready.'), toast = useToast();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget), expiry = new Date(String(f.get('expiry')));
    if (expiry.getTime() <= Date.now()) { toast('Choose an expiry in the future.', 'error'); return; }
    action.mutate({ path: '/coupons', body: { code: String(f.get('code')).toUpperCase(), percent: Number(f.get('percent')), maxUses: Number(f.get('uses')), expiresAt: expiry.toISOString() } }, { onSuccess: onClose });
  }
  return <Modal title="Make a little offer." description="Give your customers a reason to come back." onClose={onClose}><form className="form-body" onSubmit={submit}><Field label="Coupon code"><input name="code" className="uppercase" required maxLength={40} pattern="[A-Za-z0-9_-]+" placeholder="WELCOME10" /></Field><div className="form-grid"><Field label="Discount (%)"><input name="percent" type="number" min={1} max={100} step={1} defaultValue={10} required /></Field><Field label="Maximum uses"><input name="uses" type="number" min={1} max={1000000} step={1} defaultValue={100} required /></Field></div><Field label="Expires at" hint="Local time, converted to UTC for the API."><input name="expiry" type="datetime-local" required /></Field><FormFooter pending={action.isPending} onClose={onClose} label="Create coupon" /></form></Modal>;
}

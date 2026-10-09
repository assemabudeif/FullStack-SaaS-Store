import { useId, useState } from 'react';
import type { Order } from '../types';
import { money } from '../lib/utils';

export function Sparkline({ values, tone = 'green' }: { values: number[]; tone?: string }) {
  const id = useId().replaceAll(':', '');
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const points = values.map((v, i) => `${i / Math.max(values.length - 1, 1) * 120},${35 - (v - min) / Math.max(max - min, 1) * 28}`);
  return <svg className={`sparkline ${tone}`} viewBox="0 0 120 40" aria-hidden="true"><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".2" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs><path d={`M0 40 L${points.join(' L')} L120 40 Z`} fill={`url(#${id})`} /><polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function RevenueChart({ orders, days, currency }: { orders: Order[]; days: number; currency: string }) {
  const id = useId().replaceAll(':', ''), [hover, setHover] = useState<number | null>(null);
  const buckets = Array.from({ length: days }, (_, i) => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - days + 1 + i);
    return { key: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), value: 0 };
  });
  orders.filter((o) => o.status === 'completed').forEach((o) => { const bucket = buckets.find((b) => b.key === o.created_at.slice(0, 10)); if (bucket) bucket.value += o.total_cents; });
  const max = Math.max(...buckets.map((b) => b.value), 10000) * 1.2;
  const x = (i: number) => 60 + i / (days - 1) * 660, y = (v: number) => 225 - v / max * 180;
  // A moving average smooths the visual but the hover tooltip shows exact daily values.
  const smoothed = buckets.map((_, i) => buckets.slice(Math.max(0, i - 1), Math.min(days, i + 2)).reduce((s, b) => s + b.value, 0) / (Math.min(days, i + 2) - Math.max(0, i - 1)));
  const coords = smoothed.map((v, i) => [x(i), y(v)]);
  let line = `M${coords[0].join(' ')}`;
  for (let i = 1; i < coords.length; i++) {
    const previous = coords[i - 1], next = coords[i], mid = (previous[0] + next[0]) / 2;
    line += ` C${mid} ${previous[1]},${mid} ${next[1]},${next[0]} ${next[1]}`;
  }
  return <div className="revenue-chart"><svg viewBox="0 0 750 265" role="img" aria-label={`Completed order value by day over ${days} days. Chart uses a three-day moving average. Exact daily values are shown below.`} onMouseLeave={() => setHover(null)}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#138e78" stopOpacity=".19" /><stop offset="100%" stopColor="#138e78" stopOpacity="0" /></linearGradient></defs>
    {[0, 1, 2, 3, 4].map((i) => <g key={i}><line x1={60} y1={45 + i * 45} x2={720} y2={45 + i * 45} stroke="var(--border)" strokeDasharray="4 5" /><text x={45} y={50 + i * 45} textAnchor="end" className="chart-label">{money(max * (4 - i) / 4, currency).replace(/\.00$/, '')}</text></g>)}
    <path d={`${line} L720 225 L60 225 Z`} fill={`url(#${id})`} /><path d={line} fill="none" stroke="#12836d" strokeWidth="2.8" strokeLinecap="round" />
    {[0, Math.floor(days / 5), Math.floor(days * 2 / 5), Math.floor(days * 3 / 5), Math.floor(days * 4 / 5), days - 1].map((i) => <text key={i} x={x(i)} y={255} textAnchor="middle" className="chart-label">{buckets[i].label}</text>)}
    {buckets.map((_, i) => <rect key={i} x={x(i) - 660 / days / 2} y={30} width={660 / days} height={200} fill="transparent" onMouseEnter={() => setHover(i)} />)}
    {hover !== null ? <g pointerEvents="none"><line x1={x(hover)} x2={x(hover)} y1={35} y2={225} stroke="#138e78" strokeDasharray="4 4" /><circle cx={x(hover)} cy={y(smoothed[hover])} r={5} fill="#12836d" stroke="var(--panel)" strokeWidth={3} /></g> : null}
  </svg><div className="chart-hover" aria-live="polite">{hover === null ? <><span className="chart-legend-dot" />Completed order value <span className="chart-hover-note">Hover to explore · 3-day trend</span></> : <><span className="chart-legend-dot" /><strong>{buckets[hover].label}</strong><span>{money(buckets[hover].value, currency)}</span><span className="chart-hover-note">Exact daily value</span></>}</div>
  <details className="chart-accessible"><summary>View daily values</summary><div>{buckets.map((b) => <span key={b.key}>{b.label}: {money(b.value, currency)}</span>)}</div></details></div>;
}
export function OrderDonut({ orders }: { orders: Order[] }) {
  const segments = [
    { name: 'Completed', status: 'completed', color: '#12836d' },
    { name: 'In progress', status: 'open', color: '#8ac7b1' },
    { name: 'Cancelled', status: 'cancelled', color: '#f0bf76' },
  ].map((s) => ({ ...s, count: orders.filter((o) => s.status === 'open' ? ['pending', 'confirmed', 'shipped'].includes(o.status) : o.status === s.status).length }));
  let offset = 0;
  return <div className="order-donut"><div className="donut-visual"><svg viewBox="0 0 160 160" role="img" aria-label={segments.map((s) => `${s.name}: ${s.count}`).join(', ')}><circle cx="80" cy="80" r="62" fill="none" stroke="var(--border)" strokeWidth="17" />
    {segments.map((s) => {
      const length = orders.length ? s.count / orders.length * 389.56 : 0, currentOffset = offset; offset += length;
      return <circle key={s.name} cx="80" cy="80" r="62" fill="none" stroke={s.color} strokeWidth="17" strokeDasharray={`${Math.max(length - 4, 0)} ${389.56 - Math.max(length - 4, 0)}`} strokeDashoffset={-currentOffset} transform="rotate(-90 80 80)" strokeLinecap="butt" />;
    })}</svg><div className="donut-center"><strong>{orders.length}</strong><span>recent orders</span></div></div><div className="donut-legend">{segments.map((s) => <div key={s.name}><span><i style={{ background: s.color }} />{s.name}</span><strong>{orders.length ? Math.round(s.count / orders.length * 100) : 0}% <small>{s.count}</small></strong></div>)}</div></div>;
}

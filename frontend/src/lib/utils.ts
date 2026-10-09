import type { OrderStatus } from '../types';
export function money(cents: number | string, currency = 'USD') {
  // Format aggregate decimal strings without first converting them to an unsafe integer.
  if (typeof cents === 'string' && /^\d+$/.test(cents) && BigInt(cents) > BigInt(Number.MAX_SAFE_INTEGER)) {
    const integer = BigInt(cents);
    return `${currency} ${(integer / 100n).toLocaleString('en-US')}.${String(integer % 100n).padStart(2, '0')}`;
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents) / 100);
}
export function toCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a positive amount with up to two decimal places.');
  const [integer, fraction = ''] = value.split('.');
  const result = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > 100000000n) throw new Error('Amount exceeds the supported limit.');
  return Number(result);
}
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
export const shortId = (id: string) => `#${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
export const date = (value: string, withTime = false) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
}).format(new Date(value));
export const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'], shipped: ['completed'], completed: [], cancelled: [],
};
export function csvText(rows: Record<string, unknown>[]) {
  const headers = Object.keys(rows[0] ?? {});
  const escape = (v: unknown) => {
    let text = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // Spreadsheet formula-injection protection.
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [headers.map(escape).join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\r\n');
}
export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', csvText(rows)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = `${name}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const humanAction = (action: string) => action.replaceAll('.', ' ').replaceAll('_', ' ');

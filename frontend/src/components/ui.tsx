import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ChevronRight, PackageOpen, RefreshCw, Search, X } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Product } from '../types';

export function Button({ children, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button {...props} className={`button ${variant} ${className}`}>{children}</button>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}><span />{children}</span>; }
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}<h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>;
}
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{children}</section>; }
export function PanelHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>{action}</div>;
}
export function Modal({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const onCancel = (e: Event) => { e.preventDefault(); close.current(); };
    dialog.addEventListener('cancel', onCancel);
    return () => { dialog.removeEventListener('cancel', onCancel); dialog.close(); };
  }, []);
  return createPortal(<dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby={titleId}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-content"><header className="modal-heading"><div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></header>{children}</div>
  </dialog>, document.body);
}
export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
export function FormFooter({ pending, onClose, label = 'Save changes' }: { pending: boolean; onClose: () => void; label?: string }) {
  return <div className="form-footer"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button disabled={pending} type="submit">{pending ? <><RefreshCw size={15} className="spin" /> Saving…</> : label}</Button></div>;
}
export function Empty({ title = 'A fresh start.', description = 'Your records will appear here when you add them.', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><PackageOpen size={28} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function QueryState({ query, children }: { query: Pick<UseQueryResult, 'isPending' | 'error' | 'refetch'>; children: ReactNode }) {
  if (query.isPending) return <div className="loading-state" role="status" aria-label="Loading data"><div className="skeleton title" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
  if (query.error) return <div className="empty error-state" role="alert"><h3>We couldn’t load this view.</h3><p>{query.error.message}</p><Button variant="secondary" onClick={() => void query.refetch()}><RefreshCw size={15} /> Try again</Button></div>;
  return children;
}
export function Pagination({ page, limit, total, count, onChange }: { page: number; limit: number; total?: number; count: number; onChange: (page: number) => void }) {
  const start = count ? (page - 1) * limit + 1 : 0, end = (page - 1) * limit + count;
  return <div className="pagination"><span>Showing <strong>{start}–{end}</strong>{total !== undefined ? <> of <strong>{total}</strong></> : null} results</span><div>
    <button aria-label="Previous page" disabled={page === 1} onClick={() => onChange(page - 1)}><ArrowLeft size={15} /></button><span className="page-number">{page}</span>
    <button aria-label="Next page" disabled={total !== undefined ? end >= total : count < limit} onClick={() => onChange(page + 1)}><ArrowRight size={15} /></button>
  </div></div>;
}
export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="search-input"><Search size={17} /><input aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />{value ? <button aria-label="Clear search" onClick={() => onChange('')}><X size={14} /></button> : null}</div>;
}
export function ProductThumb({ product, large = false }: { product: Pick<Product, 'name'> & { image?: string; image_url?: string }; large?: boolean }) {
  const src = product.image_url || product.image;
  return <span className={`product-thumb ${large ? 'large' : ''}`}>{src ? <img src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <PackageOpen size={large ? 38 : 20} />}</span>;
}
export function RowLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-link" onClick={onClick}>{children}<ChevronRight size={14} /></button>; }
export function Confirm({ title, description, onClose, onConfirm, pending }: { title: string; description: string; onClose: () => void; onConfirm: () => void; pending: boolean }) {
  return <Modal title={title} description={description} onClose={onClose}><div className="form-footer"><Button variant="secondary" onClick={onClose}>Keep it</Button><Button variant="danger" disabled={pending} onClick={onConfirm}>{pending ? 'Working…' : 'Confirm'}</Button></div></Modal>;
}

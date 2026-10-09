import { demoRequest, demoSession } from './demo';
import type { Session, Store, User } from '../types';
interface RequestOptions { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; }
export class RequestError extends Error {
  constructor(message: string, public status = 0, public code = 'NETWORK_ERROR') { super(message); }
}
const base = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '');
async function network<T>(path: string, options: RequestOptions = {}, token?: string, tenant?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET', signal: options.signal,
      headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(tenant ? { 'X-Tenant-ID': tenant } : {}), ...options.headers },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new RequestError('Cannot reach the API. Start the backend and check your connection.');
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(payload?.error?.message ?? 'The API is unavailable. Please try again.', response.status, payload?.error?.code);
  return payload as T;
}
function readSession(): Session {
  try {
    const saved = JSON.parse(sessionStorage.getItem('storely-session-v1') ?? 'null');
    if (saved?.mode === 'live' && saved.accessToken && saved.refreshToken && saved.user && Array.isArray(saved.stores) && saved.tenantId) return saved;
  } catch { /* storage unavailable */ }
  return demoSession;
}
export class StoreClient {
  private session = readSession();
  private listeners = new Set<() => void>();
  private refreshing: Promise<void> | null = null;
  getSnapshot = () => this.session;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private setSession(session: Session) {
    this.session = session;
    try { if (session.mode === 'live') sessionStorage.setItem('storely-session-v1', JSON.stringify(session)); else sessionStorage.removeItem('storely-session-v1'); } catch { /* memory-only */ }
    this.listeners.forEach((listener) => listener());
  }
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const original = this.session;
    if (original.mode === 'demo') return demoRequest(path, options.method, options.body, options.headers);
    try { return await network<T>(path, options, original.accessToken, original.tenantId); }
    catch (error) {
      if (!(error instanceof RequestError) || error.status !== 401) throw error;
      if (this.session.mode !== 'live' || this.session.user.id !== original.user.id || this.session.tenantId !== original.tenantId) throw new RequestError('Workspace changed. Please try again.');
      if (this.session.accessToken === original.accessToken) {
        if (!this.refreshing) {
          this.refreshing = network<{ accessToken: string; refreshToken: string }>('/auth/refresh', { method: 'POST', body: { refreshToken: original.refreshToken } })
            .then((tokens) => {
              if (this.session.mode === 'live' && this.session.refreshToken === original.refreshToken) this.setSession({ ...this.session, ...tokens });
            }).catch((cause) => {
              if (this.session.mode === 'live' && this.session.refreshToken === original.refreshToken) this.setSession(demoSession);
              throw cause;
            }).finally(() => { this.refreshing = null; });
        }
        await this.refreshing;
      }
      if (this.session.mode !== 'live' || this.session.tenantId !== original.tenantId) throw new RequestError('Your session expired. Sign in again.', 401);
      return network<T>(path, options, this.session.accessToken, this.session.tenantId);
    }
  }
  async authenticate(kind: 'login' | 'register', body: Record<string, unknown>) {
    const tokens = await network<{ accessToken: string; refreshToken: string; user: User }>(`/auth/${kind}`, { method: 'POST', body });
    const profile = await network<{ user: User; stores: Store[] }>('/auth/me', {}, tokens.accessToken);
    if (!profile.stores.length) throw new RequestError('This account does not belong to a store.');
    this.setSession({ mode: 'live', ...tokens, user: profile.user, stores: profile.stores, tenantId: profile.stores[0].id });
  }
  selectStore(id: string) {
    if (!this.session.stores.some((store) => store.id === id)) throw new Error('Unknown workspace.');
    this.setSession({ ...this.session, tenantId: id });
  }
  async signOut() {
    try { if (this.session.mode === 'live') await this.request('/auth/logout', { method: 'POST' }); }
    finally { this.setSession(demoSession); }
  }
  useDemo() { this.setSession(demoSession); }
  publicRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (path.startsWith('/storefront/studio-store/')) return demoRequest<T>(path, options.method, options.body);
    return network<T>(path, options);
  }
}
export const client = new StoreClient();
